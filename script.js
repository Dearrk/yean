// ======================================================================
// YEAN — OSM Geospatial Data Extractor
// ======================================================================

// ===== CONFIGURATION =====
const CONFIG = {
    map: {
        center: [20, 0],
        zoom: 3,
        minZoom: 2,
        maxZoom: 19,
        tileUrl: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        tileAttribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>',
    },
    overpass: {
        endpoint: 'https://overpass-api.de/api/interpreter',
        timeout: 120,
        maxAreaKm2: 100,
    },
    polygon: {
        color: '#3b82f6',
        fillColor: '#3b82f6',
        fillOpacity: 0.12,
        weight: 2.5,
        dashArray: '6, 8',
    },
};

// ===== DATA CATEGORIES =====
const CATEGORIES = [
    {
        id: 'buildings',
        name: 'Buildings',
        icon: '🏗️',
        iconClass: 'buildings',
        description: 'All building footprints',
        overpassTags: ['building'],
    },
    {
        id: 'roads',
        name: 'Road Networks',
        icon: '🛣️',
        iconClass: 'roads',
        description: 'Streets, paths, and roadways',
        overpassTags: ['highway'],
    },
    {
        id: 'water',
        name: 'Water Bodies',
        icon: '💧',
        iconClass: 'water',
        description: 'Rivers, lakes, and streams',
        overpassTags: ['natural=water', 'waterway'],
    },
    {
        id: 'landuse',
        name: 'Land Use',
        icon: '🌿',
        iconClass: 'landuse',
        description: 'Residential, commercial, forest areas',
        overpassTags: ['landuse'],
    },
];

// ===== APP STATE =====
const state = {
    drawMode: false,
    drawnPolygon: null,
    drawnLayer: null,
    polygonCoords: null,
    selectedCategories: new Set(),
    panelOpen: false,
};

// ===== DOM ELEMENTS =====
const $ = (sel) => document.querySelector(sel);
const el = {
    map: $('#map'),
    drawBtn: $('#drawBtn'),
    clearBtn: $('#clearBtn'),
    drawInstructions: $('#drawInstructions'),
    cancelDraw: $('#cancelDraw'),
    confirmPopup: $('#confirmPopup'),
    confirmAreaInfo: $('#confirmAreaInfo'),
    confirmBtn: $('#confirmBtn'),
    cancelBtn: $('#cancelBtn'),
    sidePanel: $('#sidePanel'),
    closePanelBtn: $('#closePanelBtn'),
    panelOverlay: $('#panelOverlay'),
    areaValue: $('#areaValue'),
    vertexCount: $('#vertexCount'),
    selectAll: $('#selectAll'),
    categoryList: $('#categoryList'),
    downloadBtn: $('#downloadBtn'),
    loadingOverlay: $('#loadingOverlay'),
    loadingTitle: $('#loadingTitle'),
    loadingText: $('#loadingText'),
    progressFill: $('#progressFill'),
    progressLabel: $('#progressLabel'),
    toastContainer: $('#toastContainer'),
    latValue: $('#latValue'),
    lngValue: $('#lngValue'),
};

// ======================================================================
// MAP INITIALIZATION
// ======================================================================
const map = L.map('map', {
    center: CONFIG.map.center,
    zoom: CONFIG.map.zoom,
    minZoom: CONFIG.map.minZoom,
    maxZoom: CONFIG.map.maxZoom,
    zoomControl: true,
    attributionControl: true,
});

L.tileLayer(CONFIG.map.tileUrl, {
    attribution: CONFIG.map.tileAttribution,
    subdomains: 'abcd',
    maxZoom: CONFIG.map.maxZoom,
}).addTo(map);

// Feature group for drawn items
const drawnItems = new L.FeatureGroup();
map.addLayer(drawnItems);

// ===== Coordinate display =====
map.on('mousemove', (e) => {
    el.latValue.textContent = e.latlng.lat.toFixed(4) + '°';
    el.lngValue.textContent = e.latlng.lng.toFixed(4) + '°';
});

// ======================================================================
// DRAWING TOOLS
// ======================================================================
let drawHandler = null;

function startDrawMode() {
    state.drawMode = true;
    el.drawBtn.classList.add('active');
    el.drawInstructions.classList.remove('hidden');

    // Remove any existing polygon
    clearDrawing();

    // Create draw handler
    drawHandler = new L.Draw.Polygon(map, {
        shapeOptions: {
            color: CONFIG.polygon.color,
            fillColor: CONFIG.polygon.fillColor,
            fillOpacity: CONFIG.polygon.fillOpacity,
            weight: CONFIG.polygon.weight,
            dashArray: CONFIG.polygon.dashArray,
        },
        allowIntersection: false,
        showArea: true,
    });
    drawHandler.enable();
}

function stopDrawMode() {
    state.drawMode = false;
    el.drawBtn.classList.remove('active');
    el.drawInstructions.classList.add('hidden');

    if (drawHandler) {
        drawHandler.disable();
        drawHandler = null;
    }
}

function clearDrawing() {
    drawnItems.clearLayers();
    state.drawnPolygon = null;
    state.drawnLayer = null;
    state.polygonCoords = null;
    el.confirmPopup.classList.add('hidden');
    el.clearBtn.classList.add('hidden');
}

// Leaflet.draw event: polygon created
map.on(L.Draw.Event.CREATED, (e) => {
    const layer = e.layer;
    drawnItems.addLayer(layer);

    // Store polygon data
    state.drawnLayer = layer;
    state.drawnPolygon = layer.getLatLngs()[0];
    state.polygonCoords = state.drawnPolygon.map(ll => [ll.lat, ll.lng]);

    // Apply final style (solid, not dashed)
    layer.setStyle({
        color: CONFIG.polygon.color,
        fillColor: CONFIG.polygon.fillColor,
        fillOpacity: 0.15,
        weight: 2,
        dashArray: null,
    });

    // Stop draw mode
    stopDrawMode();

    // Show confirm popup & clear button
    const areaKm2 = calculateArea(state.polygonCoords);
    el.confirmAreaInfo.textContent = `Area: ${formatArea(areaKm2)}`;
    el.confirmPopup.classList.remove('hidden');
    el.clearBtn.classList.remove('hidden');
});

// ===== Draw button click =====
el.drawBtn.addEventListener('click', () => {
    if (state.drawMode) {
        stopDrawMode();
    } else {
        startDrawMode();
    }
});

// ===== Cancel draw =====
el.cancelDraw.addEventListener('click', () => {
    stopDrawMode();
});

// ===== ESC key =====
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (state.drawMode) {
            stopDrawMode();
        } else if (state.panelOpen) {
            closePanel();
        }
    }
});

// ===== Clear button =====
el.clearBtn.addEventListener('click', () => {
    clearDrawing();
    showToast('Drawing cleared', 'info');
});

// ===== Confirm button =====
el.confirmBtn.addEventListener('click', () => {
    const areaKm2 = calculateArea(state.polygonCoords);

    if (areaKm2 > CONFIG.overpass.maxAreaKm2) {
        showToast(`Area too large (${formatArea(areaKm2)}). Maximum is ${CONFIG.overpass.maxAreaKm2} km². Please draw a smaller area.`, 'warning');
        return;
    }

    el.confirmPopup.classList.add('hidden');
    openPanel();
});

// ===== Discard button =====
el.cancelBtn.addEventListener('click', () => {
    clearDrawing();
    showToast('Selection discarded', 'info');
});

// ======================================================================
// SIDE PANEL
// ======================================================================
function openPanel() {
    state.panelOpen = true;
    el.sidePanel.classList.add('open');
    el.panelOverlay.classList.remove('hidden');
    setTimeout(() => el.panelOverlay.classList.add('visible'), 10);

    // Update stats
    const areaKm2 = calculateArea(state.polygonCoords);
    el.areaValue.textContent = formatArea(areaKm2);
    el.vertexCount.textContent = state.polygonCoords.length;

    updateDownloadButton();
}

function closePanel() {
    state.panelOpen = false;
    el.sidePanel.classList.remove('open');
    el.panelOverlay.classList.remove('visible');
    setTimeout(() => el.panelOverlay.classList.add('hidden'), 350);
}

el.closePanelBtn.addEventListener('click', closePanel);
el.panelOverlay.addEventListener('click', closePanel);

// ===== Build Category UI =====
function buildCategoryList() {
    el.categoryList.innerHTML = '';

    CATEGORIES.forEach((cat) => {
        const item = document.createElement('div');
        item.className = 'category-item';
        item.dataset.id = cat.id;

        item.innerHTML = `
            <label class="custom-checkbox">
                <input type="checkbox" data-category="${cat.id}">
                <span class="checkbox-mark">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="20 6 9 17 4 12"/>
                    </svg>
                </span>
            </label>
            <div class="category-icon ${cat.iconClass}">${cat.icon}</div>
            <div class="category-info">
                <div class="category-name">${cat.name}</div>
                <div class="category-desc">${cat.description}</div>
            </div>
        `;

        // Click entire item to toggle checkbox
        item.addEventListener('click', (e) => {
            if (e.target.type === 'checkbox') return;
            const cb = item.querySelector('input[type="checkbox"]');
            cb.checked = !cb.checked;
            cb.dispatchEvent(new Event('change'));
        });

        const cb = item.querySelector('input[type="checkbox"]');
        cb.addEventListener('change', () => {
            if (cb.checked) {
                state.selectedCategories.add(cat.id);
                item.classList.add('selected');
            } else {
                state.selectedCategories.delete(cat.id);
                item.classList.remove('selected');
            }
            updateSelectAll();
            updateDownloadButton();
        });

        el.categoryList.appendChild(item);
    });
}

// ===== Select All =====
el.selectAll.addEventListener('change', () => {
    const checked = el.selectAll.checked;
    const checkboxes = el.categoryList.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach((cb) => {
        cb.checked = checked;
        cb.dispatchEvent(new Event('change'));
    });
});

function updateSelectAll() {
    const total = CATEGORIES.length;
    const selected = state.selectedCategories.size;
    el.selectAll.checked = selected === total;
}

function updateDownloadButton() {
    el.downloadBtn.disabled = state.selectedCategories.size === 0;
}

// Initialize category list
buildCategoryList();

// ======================================================================
// OVERPASS API & DATA FETCHING
// ======================================================================
function buildOverpassQuery(tags, polyCoords) {
    const polyStr = polyCoords.map(c => `${c[0]} ${c[1]}`).join(' ');

    let filters = '';
    tags.forEach((tag) => {
        if (tag.includes('=')) {
            const [key, val] = tag.split('=');
            filters += `  way["${key}"="${val}"](poly:"${polyStr}");\n`;
            filters += `  relation["${key}"="${val}"](poly:"${polyStr}");\n`;
        } else {
            filters += `  way["${tag}"](poly:"${polyStr}");\n`;
            filters += `  relation["${tag}"](poly:"${polyStr}");\n`;
            // Also include nodes for POI-like tags
            if (tag === 'building') {
                filters += `  node["${tag}"](poly:"${polyStr}");\n`;
            }
        }
    });

    return `[out:json][timeout:${CONFIG.overpass.timeout}];
(
${filters});
out body;
>;
out skel qt;`;
}

async function fetchOverpassData(query) {
    const response = await fetch(CONFIG.overpass.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
    });

    if (!response.ok) {
        throw new Error(`Overpass API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
}

// ======================================================================
// DOWNLOAD HANDLER
// ======================================================================
el.downloadBtn.addEventListener('click', async () => {
    if (state.selectedCategories.size === 0 || !state.polygonCoords) return;

    const selectedCats = CATEGORIES.filter(c => state.selectedCategories.has(c.id));
    const totalSteps = selectedCats.length;
    let completedSteps = 0;

    showLoading('Fetching Data', 'Preparing queries...');
    updateProgress(0, totalSteps);

    try {
        const zip = new JSZip();

        for (const cat of selectedCats) {
            updateLoadingText(`Querying ${cat.name}...`);

            const query = buildOverpassQuery(cat.overpassTags, state.polygonCoords);
            const osmData = await fetchOverpassData(query);
            const geojson = osmtogeojson(osmData);

            if (geojson.features.length === 0) {
                showToast(`No ${cat.name} data found in selected area`, 'warning');
                completedSteps++;
                updateProgress(completedSteps, totalSteps);
                continue;
            }

            updateLoadingText(`Processing ${cat.name} (${geojson.features.length} features)...`);

            // Separate features by geometry type
            const points = geojson.features.filter(f =>
                f.geometry && f.geometry.type === 'Point'
            );
            const lines = geojson.features.filter(f =>
                f.geometry && (f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString')
            );
            const polygons = geojson.features.filter(f =>
                f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
            );

            const catFolder = zip.folder(cat.id);

            // Generate shapefiles for each geometry type
            if (points.length > 0) {
                const shpData = generateShapefile(points, 1); // Point
                const subFolder = catFolder.folder(`${cat.id}_points`);
                subFolder.file(`${cat.id}_points.shp`, shpData.shp);
                subFolder.file(`${cat.id}_points.shx`, shpData.shx);
                subFolder.file(`${cat.id}_points.dbf`, shpData.dbf);
                subFolder.file(`${cat.id}_points.prj`, shpData.prj);
            }

            if (lines.length > 0) {
                const shpData = generateShapefile(lines, 3); // PolyLine
                const subFolder = catFolder.folder(`${cat.id}_lines`);
                subFolder.file(`${cat.id}_lines.shp`, shpData.shp);
                subFolder.file(`${cat.id}_lines.shx`, shpData.shx);
                subFolder.file(`${cat.id}_lines.dbf`, shpData.dbf);
                subFolder.file(`${cat.id}_lines.prj`, shpData.prj);
            }

            if (polygons.length > 0) {
                const shpData = generateShapefile(polygons, 5); // Polygon
                const subFolder = catFolder.folder(`${cat.id}_polygons`);
                subFolder.file(`${cat.id}_polygons.shp`, shpData.shp);
                subFolder.file(`${cat.id}_polygons.shx`, shpData.shx);
                subFolder.file(`${cat.id}_polygons.dbf`, shpData.dbf);
                subFolder.file(`${cat.id}_polygons.prj`, shpData.prj);
            }

            // Also save GeoJSON for convenience
            catFolder.file(`${cat.id}.geojson`, JSON.stringify(geojson, null, 2));

            completedSteps++;
            updateProgress(completedSteps, totalSteps);
        }

        updateLoadingText('Creating ZIP archive...');
        const blob = await zip.generateAsync({ type: 'blob' });
        saveAs(blob, 'yean_osm_export.zip');

        hideLoading();
        showToast('Download complete! Shapefiles exported successfully.', 'success');
    } catch (error) {
        console.error('Export error:', error);
        hideLoading();
        showToast(`Export failed: ${error.message}`, 'error');
    }
});

// ======================================================================
// SHAPEFILE GENERATOR
// ======================================================================

/**
 * Generate shapefile components for a set of GeoJSON features
 * @param {Array} features - GeoJSON features (must all have same geometry type)
 * @param {number} shapeType - 1=Point, 3=PolyLine, 5=Polygon
 * @returns {{ shp: ArrayBuffer, shx: ArrayBuffer, dbf: ArrayBuffer, prj: string }}
 */
function generateShapefile(features, shapeType) {
    // Extract properties for DBF
    const fields = [
        { name: 'name', type: 'C', length: 80 },
        { name: 'osm_id', type: 'C', length: 20 },
        { name: 'type', type: 'C', length: 50 },
    ];

    const records = features.map((f) => {
        const props = f.properties || {};
        return {
            geometry: f.geometry,
            attributes: {
                name: (props.name || props.tags?.name || '').substring(0, 80),
                osm_id: String(props.id || props['@id'] || '').substring(0, 20),
                type: (props.type || getMainTag(props) || '').substring(0, 50),
            },
        };
    });

    const shp = writeShp(records, shapeType);
    const shx = writeShx(records, shapeType);
    const dbf = writeDbf(records, fields);
    const prj = getWGS84Prj();

    return { shp, shx, dbf, prj };
}

function getMainTag(props) {
    const tags = props.tags || props;
    const keys = ['building', 'highway', 'landuse', 'natural', 'waterway', 'amenity'];
    for (const k of keys) {
        if (tags[k]) return `${k}=${tags[k]}`;
    }
    return '';
}

function getWGS84Prj() {
    return 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';
}

// ===== Write SHP =====
function writeShp(records, shapeType) {
    // Calculate total file size
    let contentSize = 0;
    const recordBuffers = [];

    records.forEach((rec) => {
        const buf = writeShapeRecord(rec.geometry, shapeType);
        recordBuffers.push(buf);
        contentSize += 8 + buf.byteLength; // 8 = record header
    });

    const fileLength = (100 + contentSize) / 2; // in 16-bit words
    const buffer = new ArrayBuffer(100 + contentSize);
    const view = new DataView(buffer);

    // File header
    const bbox = calculateBoundingBox(records.map(r => r.geometry));
    writeShpHeader(view, fileLength, shapeType, bbox);

    // Records
    let offset = 100;
    recordBuffers.forEach((recBuf, i) => {
        const contentLength = recBuf.byteLength / 2;
        view.setInt32(offset, i + 1, false); // record number, big-endian
        view.setInt32(offset + 4, contentLength, false); // content length, big-endian
        offset += 8;

        const recArray = new Uint8Array(recBuf);
        const targetArray = new Uint8Array(buffer, offset, recBuf.byteLength);
        targetArray.set(recArray);
        offset += recBuf.byteLength;
    });

    return buffer;
}

function writeShapeRecord(geometry, shapeType) {
    if (shapeType === 1) return writePointRecord(geometry);
    if (shapeType === 3) return writePolyLineRecord(geometry);
    if (shapeType === 5) return writePolygonRecord(geometry);
    throw new Error(`Unsupported shape type: ${shapeType}`);
}

function writePointRecord(geometry) {
    const buffer = new ArrayBuffer(20);
    const view = new DataView(buffer);
    view.setInt32(0, 1, true); // shape type
    view.setFloat64(4, geometry.coordinates[0], true); // X (lng)
    view.setFloat64(12, geometry.coordinates[1], true); // Y (lat)
    return buffer;
}

function writePolyLineRecord(geometry) {
    let parts, allPoints;

    if (geometry.type === 'LineString') {
        parts = [0];
        allPoints = geometry.coordinates;
    } else {
        // MultiLineString
        parts = [];
        allPoints = [];
        geometry.coordinates.forEach((line) => {
            parts.push(allPoints.length);
            allPoints.push(...line);
        });
    }

    const numParts = parts.length;
    const numPoints = allPoints.length;
    const size = 4 + 32 + 4 + 4 + numParts * 4 + numPoints * 16;
    const buffer = new ArrayBuffer(size);
    const view = new DataView(buffer);

    const bbox = getBBoxFromCoords(allPoints);

    let off = 0;
    view.setInt32(off, 3, true); off += 4; // shape type
    view.setFloat64(off, bbox[0], true); off += 8; // xmin
    view.setFloat64(off, bbox[1], true); off += 8; // ymin
    view.setFloat64(off, bbox[2], true); off += 8; // xmax
    view.setFloat64(off, bbox[3], true); off += 8; // ymax
    view.setInt32(off, numParts, true); off += 4;
    view.setInt32(off, numPoints, true); off += 4;

    parts.forEach((p) => { view.setInt32(off, p, true); off += 4; });
    allPoints.forEach((pt) => {
        view.setFloat64(off, pt[0], true); off += 8; // X
        view.setFloat64(off, pt[1], true); off += 8; // Y
    });

    return buffer;
}

function writePolygonRecord(geometry) {
    let parts, allPoints;

    if (geometry.type === 'Polygon') {
        parts = [];
        allPoints = [];
        geometry.coordinates.forEach((ring) => {
            parts.push(allPoints.length);
            allPoints.push(...ring);
        });
    } else {
        // MultiPolygon
        parts = [];
        allPoints = [];
        geometry.coordinates.forEach((polygon) => {
            polygon.forEach((ring) => {
                parts.push(allPoints.length);
                allPoints.push(...ring);
            });
        });
    }

    const numParts = parts.length;
    const numPoints = allPoints.length;
    const size = 4 + 32 + 4 + 4 + numParts * 4 + numPoints * 16;
    const buffer = new ArrayBuffer(size);
    const view = new DataView(buffer);

    const bbox = getBBoxFromCoords(allPoints);

    let off = 0;
    view.setInt32(off, 5, true); off += 4; // shape type
    view.setFloat64(off, bbox[0], true); off += 8;
    view.setFloat64(off, bbox[1], true); off += 8;
    view.setFloat64(off, bbox[2], true); off += 8;
    view.setFloat64(off, bbox[3], true); off += 8;
    view.setInt32(off, numParts, true); off += 4;
    view.setInt32(off, numPoints, true); off += 4;

    parts.forEach((p) => { view.setInt32(off, p, true); off += 4; });
    allPoints.forEach((pt) => {
        view.setFloat64(off, pt[0], true); off += 8;
        view.setFloat64(off, pt[1], true); off += 8;
    });

    return buffer;
}

// ===== Write SHX =====
function writeShx(records, shapeType) {
    const numRecords = records.length;
    const buffer = new ArrayBuffer(100 + numRecords * 8);
    const view = new DataView(buffer);

    // We need to recalculate record sizes
    let shpOffset = 50; // in 16-bit words (100 bytes / 2)
    const bbox = calculateBoundingBox(records.map(r => r.geometry));

    const fileLength = (100 + numRecords * 8) / 2;
    writeShpHeader(view, fileLength, shapeType, bbox);

    let offset = 100;
    records.forEach((rec) => {
        const recBuf = writeShapeRecord(rec.geometry, shapeType);
        const contentLength = recBuf.byteLength / 2;

        view.setInt32(offset, shpOffset, false); // offset, big-endian
        view.setInt32(offset + 4, contentLength, false); // content length, big-endian
        offset += 8;

        shpOffset += 4 + contentLength; // 4 = record header (8 bytes / 2)
    });

    return buffer;
}

// ===== Write SHP/SHX file header =====
function writeShpHeader(view, fileLength, shapeType, bbox) {
    view.setInt32(0, 9994, false); // file code, big-endian
    // bytes 4-23 unused
    view.setInt32(24, fileLength, false); // file length, big-endian
    view.setInt32(28, 1000, true); // version, little-endian
    view.setInt32(32, shapeType, true); // shape type, little-endian

    // Bounding box
    view.setFloat64(36, bbox[0], true); // xmin
    view.setFloat64(44, bbox[1], true); // ymin
    view.setFloat64(52, bbox[2], true); // xmax
    view.setFloat64(60, bbox[3], true); // ymax
    // Z and M ranges remain 0
}

// ===== Write DBF =====
function writeDbf(records, fields) {
    const numRecords = records.length;
    const numFields = fields.length;
    const headerSize = 32 + numFields * 32 + 1;
    const recordSize = 1 + fields.reduce((a, f) => a + f.length, 0);
    const fileSize = headerSize + numRecords * recordSize + 1; // +1 for EOF

    const buffer = new ArrayBuffer(fileSize);
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);

    // Header
    view.setUint8(0, 0x03); // version
    const now = new Date();
    view.setUint8(1, now.getFullYear() - 1900); // year
    view.setUint8(2, now.getMonth() + 1); // month
    view.setUint8(3, now.getDate()); // day
    view.setInt32(4, numRecords, true); // number of records
    view.setInt16(8, headerSize, true); // header size
    view.setInt16(10, recordSize, true); // record size

    // Field descriptors
    let off = 32;
    fields.forEach((field) => {
        const nameBytes = new TextEncoder().encode(field.name.padEnd(11, '\0').substring(0, 11));
        bytes.set(nameBytes, off);
        view.setUint8(off + 11, field.type.charCodeAt(0)); // field type
        view.setUint8(off + 16, field.length); // field length
        off += 32;
    });

    // Header terminator
    view.setUint8(off, 0x0D);
    off++;

    // Records
    records.forEach((rec) => {
        view.setUint8(off, 0x20); // deletion flag (space = valid)
        off++;

        fields.forEach((field) => {
            const val = (rec.attributes[field.name] || '').toString().padEnd(field.length, ' ').substring(0, field.length);
            const valBytes = new TextEncoder().encode(val);
            bytes.set(valBytes, off);
            off += field.length;
        });
    });

    // EOF
    view.setUint8(off, 0x1A);

    return buffer;
}

// ======================================================================
// GEOMETRY UTILITIES
// ======================================================================
function getBBoxFromCoords(coords) {
    let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
    coords.forEach((c) => {
        if (c[0] < xmin) xmin = c[0];
        if (c[1] < ymin) ymin = c[1];
        if (c[0] > xmax) xmax = c[0];
        if (c[1] > ymax) ymax = c[1];
    });
    return [xmin, ymin, xmax, ymax];
}

function calculateBoundingBox(geometries) {
    let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;

    geometries.forEach((geom) => {
        const coords = extractAllCoords(geom);
        coords.forEach((c) => {
            if (c[0] < xmin) xmin = c[0];
            if (c[1] < ymin) ymin = c[1];
            if (c[0] > xmax) xmax = c[0];
            if (c[1] > ymax) ymax = c[1];
        });
    });

    return [xmin, ymin, xmax, ymax];
}

function extractAllCoords(geometry) {
    if (!geometry || !geometry.coordinates) return [];

    switch (geometry.type) {
        case 'Point':
            return [geometry.coordinates];
        case 'LineString':
            return geometry.coordinates;
        case 'Polygon':
            return geometry.coordinates.flat();
        case 'MultiLineString':
            return geometry.coordinates.flat();
        case 'MultiPolygon':
            return geometry.coordinates.flat(2);
        default:
            return [];
    }
}

/**
 * Calculate polygon area in km² using Shoelace formula on spherical coordinates
 */
function calculateArea(latlngs) {
    if (!latlngs || latlngs.length < 3) return 0;

    const toRad = (deg) => (deg * Math.PI) / 180;
    const R = 6371; // Earth radius in km

    let area = 0;
    const n = latlngs.length;

    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const lat1 = toRad(latlngs[i][0]);
        const lat2 = toRad(latlngs[j][0]);
        const dLng = toRad(latlngs[j][1] - latlngs[i][1]);
        area += dLng * (2 + Math.sin(lat1) + Math.sin(lat2));
    }

    area = Math.abs((area * R * R) / 2);
    return area;
}

function formatArea(areaKm2) {
    if (areaKm2 < 1) {
        return `${(areaKm2 * 1000000).toFixed(0)} m²`;
    } else if (areaKm2 < 100) {
        return `${areaKm2.toFixed(2)} km²`;
    } else {
        return `${areaKm2.toFixed(0)} km²`;
    }
}

// ======================================================================
// UI HELPERS
// ======================================================================
function showLoading(title, text) {
    el.loadingTitle.textContent = title;
    el.loadingText.textContent = text;
    el.progressFill.style.width = '0%';
    el.progressLabel.textContent = '0 / 0';
    el.loadingOverlay.classList.remove('hidden');
}

function updateLoadingText(text) {
    el.loadingText.textContent = text;
}

function updateProgress(current, total) {
    const pct = total > 0 ? (current / total) * 100 : 0;
    el.progressFill.style.width = `${pct}%`;
    el.progressLabel.textContent = `${current} / ${total}`;
}

function hideLoading() {
    el.loadingOverlay.classList.add('hidden');
}

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icons = {
        success: '✅',
        error: '❌',
        warning: '⚠️',
        info: 'ℹ️',
    };

    toast.innerHTML = `
        <span class="toast-icon">${icons[type] || icons.info}</span>
        <span>${message}</span>
    `;

    el.toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('toast-exit');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// ======================================================================
// INITIALIZATION
// ======================================================================
showToast('Welcome to Yean! Click the pen icon to draw a polygon on the map.', 'info');
