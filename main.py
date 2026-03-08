"""
Yean GIS Export — DXF → DWG Conversion Server
===============================================
A FastAPI backend that converts DXF files to DWG format.

Conversion methods (tried in order):
  1. ODA File Converter CLI  (best quality, industry standard)
  2. LibreDWG dwgwrite CLI   (open-source fallback)
  3. ezdxf repack + rename   (emergency fallback — NOT a true DWG)

Usage:
  pip install -r requirements.txt
  python main.py

Endpoints:
  POST /convert/dxf-to-dwg  — Upload DXF, get DWG back
  GET  /status/{job_id}      — Poll async job status
  GET  /download/{job_id}    — Download completed DWG
  GET  /health               — Server health check
"""

import os
import uuid
import shutil
import subprocess
import tempfile
import time
import asyncio
from pathlib import Path
from enum import Enum

from fastapi import FastAPI, UploadFile, File, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware

# ══════════════════════════════════════════════════════════════════════
# CONFIG
# ══════════════════════════════════════════════════════════════════════

UPLOAD_DIR = Path(tempfile.gettempdir()) / "yean_conversions"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# ODA File Converter paths (adjust for your system)
ODA_PATHS = [
    r"C:\Program Files\ODA\ODAFileConverter\ODAFileConverter.exe",
    r"C:\Program Files (x86)\ODA\ODAFileConverter\ODAFileConverter.exe",
    "/usr/bin/ODAFileConverter",
    "/usr/local/bin/ODAFileConverter",
    shutil.which("ODAFileConverter") or "",
]

# LibreDWG dwgwrite paths
LIBREDWG_PATHS = [
    shutil.which("dwgwrite") or "",
    "/usr/bin/dwgwrite",
    "/usr/local/bin/dwgwrite",
]

# AutoCAD version for ODA conversion
ACAD_VERSION = "ACAD2018"  # R2018 format — widely compatible
DWG_VERSION = "DWG"        # output format

# Job cleanup: delete files older than this (seconds)
JOB_TTL = 3600  # 1 hour


# ══════════════════════════════════════════════════════════════════════
# JOB STATE
# ══════════════════════════════════════════════════════════════════════

class JobStatus(str, Enum):
    QUEUED = "queued"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


# In-memory job store (use Redis/DB in production)
jobs: dict[str, dict] = {}


# ══════════════════════════════════════════════════════════════════════
# CONVERTER DETECTION
# ══════════════════════════════════════════════════════════════════════

def find_oda_converter() -> str | None:
    """Find ODA File Converter on the system."""
    for p in ODA_PATHS:
        if p and os.path.isfile(p):
            return p
    return None


def find_libredwg() -> str | None:
    """Find LibreDWG dwgwrite on the system."""
    for p in LIBREDWG_PATHS:
        if p and os.path.isfile(p):
            return p
    return None


def get_converter_info() -> dict:
    """Return info about available converters."""
    oda = find_oda_converter()
    ldwg = find_libredwg()
    return {
        "oda_file_converter": oda or "not found",
        "libredwg_dwgwrite": ldwg or "not found",
        "ezdxf_fallback": "available (repack only, not true DWG)",
        "recommended": "ODA File Converter" if oda else ("LibreDWG" if ldwg else "ezdxf fallback"),
    }


# ══════════════════════════════════════════════════════════════════════
# CONVERSION FUNCTIONS
# ══════════════════════════════════════════════════════════════════════

def convert_with_oda(input_dxf: Path, output_dir: Path, output_name: str) -> Path:
    """
    Convert DXF → DWG using ODA File Converter CLI.
    
    ODA syntax:
      ODAFileConverter "InputFolder" "OutputFolder" "ACAD_VER" "DWG" "0" "1" "*.dxf"
    
    Arguments:
      - InputFolder:  folder containing the .dxf
      - OutputFolder: folder to write the .dwg
      - ACAD_VER:     e.g. ACAD2018, ACAD2013, ACAD2010
      - DWG:          output format (DWG or DXF)
      - 0:            recurse subfolders (0=no)
      - 1:            audit (1=audit and fix)
    """
    oda_path = find_oda_converter()
    if not oda_path:
        raise RuntimeError("ODA File Converter not found")

    input_dir = input_dxf.parent
    
    cmd = [
        oda_path,
        str(input_dir),
        str(output_dir),
        ACAD_VERSION,
        DWG_VERSION,
        "0",  # Don't recurse
        "1",  # Audit
        input_dxf.name,
    ]

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=60,
    )

    if result.returncode != 0:
        raise RuntimeError(f"ODA conversion failed: {result.stderr or result.stdout}")

    # ODA outputs same name but .dwg extension
    expected_output = output_dir / input_dxf.with_suffix(".dwg").name
    if not expected_output.exists():
        # Try finding any .dwg in output dir
        dwg_files = list(output_dir.glob("*.dwg"))
        if dwg_files:
            expected_output = dwg_files[0]
        else:
            raise RuntimeError("ODA conversion produced no output file")

    # Rename to desired output name
    final_path = output_dir / f"{output_name}.dwg"
    if expected_output != final_path:
        shutil.move(str(expected_output), str(final_path))

    return final_path


def convert_with_libredwg(input_dxf: Path, output_dir: Path, output_name: str) -> Path:
    """
    Convert DXF → DWG using LibreDWG's dwgwrite tool.
    
    dwgwrite -o output.dwg input.dxf
    """
    dwgwrite = find_libredwg()
    if not dwgwrite:
        raise RuntimeError("LibreDWG dwgwrite not found")

    output_path = output_dir / f"{output_name}.dwg"

    cmd = [dwgwrite, "-o", str(output_path), str(input_dxf)]

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=60,
    )

    if result.returncode != 0:
        raise RuntimeError(f"LibreDWG conversion failed: {result.stderr or result.stdout}")

    if not output_path.exists():
        raise RuntimeError("LibreDWG conversion produced no output file")

    return output_path


def convert_with_ezdxf_fallback(input_dxf: Path, output_dir: Path, output_name: str) -> Path:
    """
    Fallback: Use ezdxf to read, validate, and rewrite the DXF,
    then save with .dwg extension.
    
    ⚠ WARNING: This is NOT a true DWG conversion.
    The output is a DXF file renamed to .dwg. Most modern CAD
    software (AutoCAD 2018+, BricsCAD) can still open it, but
    it's not a native binary DWG file.
    """
    try:
        import ezdxf

        doc = ezdxf.readfile(str(input_dxf))
        # Validate and fix
        auditor = doc.audit()
        
        # Save as DXF (ezdxf cannot write true DWG)
        output_dxf = output_dir / f"{output_name}_validated.dxf"
        doc.saveas(str(output_dxf))

        # Rename to .dwg (AutoCAD can still open DXF content in .dwg extension)
        output_dwg = output_dir / f"{output_name}.dwg"
        shutil.copy2(str(output_dxf), str(output_dwg))
        output_dxf.unlink()

        return output_dwg

    except Exception as e:
        raise RuntimeError(f"ezdxf fallback failed: {e}")


def convert_dxf_to_dwg(input_dxf: Path, output_dir: Path, output_name: str = "drawing") -> tuple[Path, str]:
    """
    Try all available converters in order of quality.
    Returns (output_path, converter_used).
    """
    # Method 1: ODA File Converter (best)
    if find_oda_converter():
        try:
            path = convert_with_oda(input_dxf, output_dir, output_name)
            return path, "ODA File Converter"
        except Exception as e:
            print(f"[WARN] ODA conversion failed: {e}")

    # Method 2: LibreDWG
    if find_libredwg():
        try:
            path = convert_with_libredwg(input_dxf, output_dir, output_name)
            return path, "LibreDWG"
        except Exception as e:
            print(f"[WARN] LibreDWG conversion failed: {e}")

    # Method 3: ezdxf fallback (not true DWG)
    try:
        path = convert_with_ezdxf_fallback(input_dxf, output_dir, output_name)
        return path, "ezdxf (fallback — validated DXF renamed to .dwg)"
    except Exception as e:
        raise RuntimeError(f"All conversion methods failed. Last error: {e}")


# ══════════════════════════════════════════════════════════════════════
# BACKGROUND WORKER
# ══════════════════════════════════════════════════════════════════════

async def process_conversion(job_id: str):
    """Background task that performs the actual DXF → DWG conversion."""
    job = jobs.get(job_id)
    if not job:
        return

    job["status"] = JobStatus.PROCESSING
    job["message"] = "Converting DXF to DWG..."

    try:
        input_dxf = Path(job["input_path"])
        output_dir = input_dxf.parent / "output"
        output_dir.mkdir(exist_ok=True)

        # Run conversion in thread pool (it's CPU-bound)
        loop = asyncio.get_event_loop()
        output_path, converter = await loop.run_in_executor(
            None,
            convert_dxf_to_dwg,
            input_dxf,
            output_dir,
            job.get("output_name", "drawing"),
        )

        job["status"] = JobStatus.COMPLETED
        job["output_path"] = str(output_path)
        job["converter"] = converter
        job["message"] = f"Conversion complete using {converter}"
        job["completed_at"] = time.time()

    except Exception as e:
        job["status"] = JobStatus.FAILED
        job["message"] = str(e)
        job["completed_at"] = time.time()


# ══════════════════════════════════════════════════════════════════════
# CLEANUP
# ══════════════════════════════════════════════════════════════════════

def cleanup_old_jobs():
    """Remove expired jobs and their files."""
    now = time.time()
    expired = [
        jid for jid, j in jobs.items()
        if j.get("completed_at") and now - j["completed_at"] > JOB_TTL
    ]
    for jid in expired:
        job = jobs.pop(jid, None)
        if job:
            job_dir = Path(job["input_path"]).parent
            if job_dir.exists():
                shutil.rmtree(str(job_dir), ignore_errors=True)


# ══════════════════════════════════════════════════════════════════════
# FASTAPI APP
# ══════════════════════════════════════════════════════════════════════

app = FastAPI(
    title="Yean GIS Converter",
    description="DXF → DWG conversion service for the Yean geospatial platform",
    version="1.0.0",
)

# CORS — allow the frontend to call us
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    """Health check + converter availability."""
    cleanup_old_jobs()
    return {
        "status": "ok",
        "converters": get_converter_info(),
        "active_jobs": len(jobs),
    }


@app.post("/convert/dxf-to-dwg")
async def convert_dxf_to_dwg_endpoint(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    output_name: str = "drawing",
):
    """
    Upload a DXF file and start async DWG conversion.
    
    Returns a job_id to poll /status/{job_id}.
    When complete, download from /download/{job_id}.
    """
    # Validate
    if not file.filename:
        raise HTTPException(400, "No filename provided")

    ext = Path(file.filename).suffix.lower()
    if ext not in (".dxf",):
        raise HTTPException(400, f"Invalid file type: {ext}. Only .dxf accepted.")

    if file.size and file.size > 100 * 1024 * 1024:  # 100MB limit
        raise HTTPException(413, "File too large. Maximum 100MB.")

    # Create job directory
    job_id = str(uuid.uuid4())
    job_dir = UPLOAD_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    # Sanitize filename
    safe_name = f"input_{job_id[:8]}.dxf"
    input_path = job_dir / safe_name

    # Save uploaded file
    try:
        content = await file.read()
        with open(input_path, "wb") as f:
            f.write(content)
    except Exception as e:
        shutil.rmtree(str(job_dir), ignore_errors=True)
        raise HTTPException(500, f"Failed to save file: {e}")

    # Register job
    jobs[job_id] = {
        "status": JobStatus.QUEUED,
        "input_path": str(input_path),
        "output_name": output_name,
        "message": "Job queued for conversion",
        "created_at": time.time(),
        "completed_at": None,
        "output_path": None,
        "converter": None,
        "file_size": len(content),
    }

    # Start background conversion
    background_tasks.add_task(process_conversion, job_id)

    return JSONResponse(
        status_code=202,
        content={
            "job_id": job_id,
            "status": "queued",
            "message": "Conversion job queued. Poll /status/{job_id} for progress.",
        },
    )


@app.get("/status/{job_id}")
async def get_job_status(job_id: str):
    """Poll the status of a conversion job."""
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")

    response = {
        "job_id": job_id,
        "status": job["status"],
        "message": job["message"],
    }

    if job["status"] == JobStatus.COMPLETED:
        response["download_url"] = f"/download/{job_id}"
        response["converter"] = job["converter"]

    return response


@app.get("/download/{job_id}")
async def download_dwg(job_id: str):
    """Download the converted DWG file."""
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")

    if job["status"] != JobStatus.COMPLETED:
        raise HTTPException(400, f"Job is not complete. Current status: {job['status']}")

    output_path = job.get("output_path")
    if not output_path or not os.path.isfile(output_path):
        raise HTTPException(500, "Output file not found")

    filename = f"{job['output_name']}.dwg"

    return FileResponse(
        path=output_path,
        filename=filename,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
    )


# ══════════════════════════════════════════════════════════════════════
# SYNCHRONOUS ENDPOINT (for smaller files / simpler workflow)
# ══════════════════════════════════════════════════════════════════════

@app.post("/convert/dxf-to-dwg/sync")
async def convert_sync(
    file: UploadFile = File(...),
    output_name: str = "drawing",
):
    """
    Synchronous DXF → DWG conversion.
    Waits for conversion to finish and returns the DWG file directly.
    Best for smaller files (<10MB).
    """
    if not file.filename:
        raise HTTPException(400, "No filename provided")

    ext = Path(file.filename).suffix.lower()
    if ext not in (".dxf",):
        raise HTTPException(400, f"Invalid file type: {ext}. Only .dxf accepted.")

    # Create temp directory
    job_id = str(uuid.uuid4())
    job_dir = UPLOAD_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    output_dir = job_dir / "output"
    output_dir.mkdir(exist_ok=True)

    try:
        # Save input
        safe_name = f"input_{job_id[:8]}.dxf"
        input_path = job_dir / safe_name
        content = await file.read()
        with open(input_path, "wb") as f:
            f.write(content)

        # Convert
        loop = asyncio.get_event_loop()
        output_path, converter = await loop.run_in_executor(
            None,
            convert_dxf_to_dwg,
            input_path,
            output_dir,
            output_name,
        )

        filename = f"{output_name}.dwg"
        return FileResponse(
            path=str(output_path),
            filename=filename,
            media_type="application/octet-stream",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "X-Converter-Used": converter,
            },
        )

    except Exception as e:
        shutil.rmtree(str(job_dir), ignore_errors=True)
        raise HTTPException(500, f"Conversion failed: {e}")


# ══════════════════════════════════════════════════════════════════════
# ENTRY POINT
# ══════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import uvicorn

    # Simple ASCII banner to avoid Windows console encoding issues
    print("=" * 54)
    print(" Yean GIS Converter - DXF -> DWG Server")
    print("=" * 54)
    print()

    info = get_converter_info()
    print(f"  ODA File Converter : {info['oda_file_converter']}")
    print(f"  LibreDWG dwgwrite  : {info['libredwg_dwgwrite']}")
    print(f"  ezdxf fallback     : {info['ezdxf_fallback']}")
    print(f"  Recommended        : {info['recommended']}")
    print()
    print("  Listening on http://localhost:8081")
    print()

    uvicorn.run(app, host="0.0.0.0", port=8081, log_level="info")
