// ======================================================================
// YEAN — OSM Geospatial Data Extractor
// ======================================================================

// ===== CONFIGURATION =====
const CONFIG = {
    map: {
        center: [20.5937, 78.9629],
        zoom: 5,
        minZoom: 2,
        maxZoom: 19,
        tileUrl: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        tileAttribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>',
    },
    overpass: {
        endpoint: 'https://overpass-api.de/api/interpreter',
        timeout: 120,
        maxAreaKm2: 1500,
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
];

// ===== APP STATE =====
const state = {
    drawMode: false,
    drawShape: 'polygon',
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
    uploadBtn: $('#uploadBtn'),
    fileInput: $('#fileInput'),
    downloadDwgBtn: $('#downloadDwgBtn'),
    falseHeight: $('#falseHeight'),
    includeContours: $('#includeContours'),
    contourInterval: $('#contourInterval'),
    contourIntervalRow: $('#contourIntervalRow'),
    utmZoneBadge: $('#utmZoneBadge'),
    // New UI elements
    drawShapeMenu: $('#drawShapeMenu'),
    catalogBtn: $('#catalogBtn'),
    searchForm: $('#searchForm'),
    searchInput: $('#searchInput'),
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

function startDrawMode(shape = 'polygon') {
    state.drawMode = true;
    state.drawShape = shape;
    el.drawBtn.classList.add('active');
    el.drawInstructions.classList.remove('hidden');

    // Remove any existing polygon
    clearDrawing();

    const shapeOptions = {
        color: CONFIG.polygon.color,
        fillColor: CONFIG.polygon.fillColor,
        fillOpacity: CONFIG.polygon.fillOpacity,
        weight: CONFIG.polygon.weight,
        dashArray: CONFIG.polygon.dashArray,
    };

    // Create draw handler based on selected shape
    if (shape === 'rectangle') {
        drawHandler = new L.Draw.Rectangle(map, {
            shapeOptions,
            showArea: true,
        });
    } else if (shape === 'circle') {
        drawHandler = new L.Draw.Circle(map, {
            shapeOptions,
            showArea: true,
        });
    } else {
        drawHandler = new L.Draw.Polygon(map, {
            shapeOptions,
            allowIntersection: false,
            showArea: true,
        });
    }

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
    if (el.catalogBtn) {
        el.catalogBtn.classList.add('hidden');
    }
}

// Leaflet.draw event: polygon/shape created
map.on(L.Draw.Event.CREATED, (e) => {
    const layer = e.layer;
    drawnItems.addLayer(layer);

    // Store polygon data, normalizing all shapes to polygon coordinates
    state.drawnLayer = layer;

    let coords = [];
    if (layer instanceof L.Circle) {
        const center = layer.getLatLng();
        const radius = layer.getRadius(); // meters
        coords = circleToPolygonCoords(center, radius, 64);
    } else {
        const latLngs = layer.getLatLngs();
        const ring = Array.isArray(latLngs[0]) ? latLngs[0] : latLngs;
        coords = ring.map(ll => [ll.lat, ll.lng]);
    }

    state.drawnPolygon = coords;
    state.polygonCoords = coords;

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

    // Show confirm popup, clear button, and catalog button
    const areaKm2 = calculateArea(state.polygonCoords);
    el.confirmAreaInfo.textContent = `Area: ${formatArea(areaKm2)}`;
    el.confirmPopup.classList.remove('hidden');
    el.clearBtn.classList.remove('hidden');
    if (el.catalogBtn) {
        el.catalogBtn.classList.remove('hidden');
    }
});

// ===== Draw button click / shape menu toggle =====
el.drawBtn.addEventListener('click', () => {
    if (!el.drawShapeMenu) {
        if (state.drawMode) {
            stopDrawMode();
        } else {
            startDrawMode('polygon');
        }
        return;
    }

    if (el.drawShapeMenu.classList.contains('hidden')) {
        el.drawShapeMenu.classList.remove('hidden');
    } else {
        el.drawShapeMenu.classList.add('hidden');
        if (state.drawMode) {
            stopDrawMode();
        }
    }
});

// Shape selection from menu
if (el.drawShapeMenu) {
    el.drawShapeMenu.addEventListener('click', (event) => {
        const target = event.target.closest('.draw-shape-option');
        if (!target) return;
        const shape = target.dataset.shape || 'polygon';
        el.drawShapeMenu.classList.add('hidden');
        startDrawMode(shape);
    });
}

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

    // Update UTM zone badge
    if (state.polygonCoords && state.polygonCoords.length > 0 && el.utmZoneBadge) {
        const cLat = state.polygonCoords.reduce((s, c) => s + c[0], 0) / state.polygonCoords.length;
        const cLng = state.polygonCoords.reduce((s, c) => s + c[1], 0) / state.polygonCoords.length;
        const z = Math.floor((cLng + 180) / 6) + 1;
        const h = cLat >= 0 ? 'N' : 'S';
        el.utmZoneBadge.textContent = `UTM ${z}${h}`;
    }

    updateDownloadButton();

    if (el.catalogBtn && state.polygonCoords && state.polygonCoords.length > 0) {
        el.catalogBtn.classList.remove('hidden');
    }
}

function closePanel() {
    state.panelOpen = false;
    el.sidePanel.classList.remove('open');
    el.panelOverlay.classList.remove('visible');
    setTimeout(() => el.panelOverlay.classList.add('hidden'), 350);
}

el.closePanelBtn.addEventListener('click', closePanel);
el.panelOverlay.addEventListener('click', closePanel);

// ===== Catalog button =====
if (el.catalogBtn) {
    el.catalogBtn.addEventListener('click', () => {
        if (!state.polygonCoords) {
            showToast('Draw and confirm an area to view the catalog.', 'warning');
            return;
        }
        showToast('Catalog will list available datasets for the selected area (coming soon).', 'info');
    });
}

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
    const disabled = state.selectedCategories.size === 0;
    el.downloadBtn.disabled = disabled;
    el.downloadDwgBtn.disabled = disabled;
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

// Approximate a circle as polygon coordinates (lat, lng pairs)
function circleToPolygonCoords(center, radiusMeters, sides = 64) {
    const coords = [];
    const earthRadius = 6378137; // meters
    const lat = (center.lat * Math.PI) / 180;
    const lng = (center.lng * Math.PI) / 180;
    const angularDistance = radiusMeters / earthRadius;

    for (let i = 0; i < sides; i++) {
        const bearing = (2 * Math.PI * i) / sides;
        const lat2 = Math.asin(
            Math.sin(lat) * Math.cos(angularDistance) +
            Math.cos(lat) * Math.sin(angularDistance) * Math.cos(bearing),
        );
        const lng2 =
            lng +
            Math.atan2(
                Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat),
                Math.cos(angularDistance) - Math.sin(lat) * Math.sin(lat2),
            );

        coords.push([
            (lat2 * 180) / Math.PI,
            (((lng2 * 180) / Math.PI + 540) % 360) - 180, // normalize
        ]);
    }

    return coords;
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
// FILE UPLOAD — SHAPEFILE & KML PARSING
// ======================================================================

// ===== Upload button click =====
el.uploadBtn.addEventListener('click', () => {
    el.fileInput.value = ''; // reset
    el.fileInput.click();
});

el.fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const ext = file.name.split('.').pop().toLowerCase();
    showLoading('Processing File', `Reading ${file.name}...`);

    try {
        if (ext === 'kml' || ext === 'kmz') {
            await processKMLFile(file, ext);
        } else if (ext === 'zip') {
            await processZipFile(file);
        } else if (ext === 'shp') {
            await processShpFile(file);
        } else {
            throw new Error(`Unsupported file format: .${ext}`);
        }
    } catch (err) {
        console.error('File upload error:', err);
        hideLoading();
        showToast(`Failed to read file: ${err.message}`, 'error');
    }
});

// ===== Process KML / KMZ file =====
async function processKMLFile(file, ext) {
    let text;

    if (ext === 'kmz') {
        // KMZ is a ZIP containing a .kml file
        const arrayBuffer = await file.arrayBuffer();
        const zip = await JSZip.loadAsync(arrayBuffer);
        const kmlFile = Object.keys(zip.files).find(name => name.endsWith('.kml'));
        if (!kmlFile) throw new Error('No .kml file found inside .kmz archive');
        text = await zip.files[kmlFile].async('string');
    } else {
        text = await file.text();
    }

    const geojson = parseKML(text);
    handleUploadedGeoJSON(geojson, file.name);
}

// ===== Parse KML to GeoJSON =====
function parseKML(text) {
    const parser = new DOMParser();
    const xml = parser.parseFromString(text, 'text/xml');
    const features = [];

    const placemarks = xml.querySelectorAll('Placemark');
    placemarks.forEach((pm) => {
        const name = pm.querySelector('name')?.textContent || '';

        // Find Polygon elements
        const polygons = pm.querySelectorAll('Polygon');
        polygons.forEach((poly) => {
            const outerCoords = poly.querySelector('outerBoundaryIs LinearRing coordinates');
            if (!outerCoords) return;

            const outerRing = parseKMLCoordinates(outerCoords.textContent);
            const innerRings = Array.from(
                poly.querySelectorAll('innerBoundaryIs LinearRing coordinates')
            ).map((el) => parseKMLCoordinates(el.textContent));

            features.push({
                type: 'Feature',
                properties: { name },
                geometry: {
                    type: 'Polygon',
                    coordinates: [outerRing, ...innerRings],
                },
            });
        });

        // Find MultiGeometry > Polygon
        const multiGeos = pm.querySelectorAll('MultiGeometry');
        multiGeos.forEach((mg) => {
            const mgPolygons = mg.querySelectorAll('Polygon');
            const polyCoords = [];
            mgPolygons.forEach((poly) => {
                const outerCoords = poly.querySelector('outerBoundaryIs LinearRing coordinates');
                if (!outerCoords) return;
                const outerRing = parseKMLCoordinates(outerCoords.textContent);
                polyCoords.push([outerRing]);
            });
            if (polyCoords.length > 0) {
                features.push({
                    type: 'Feature',
                    properties: { name },
                    geometry: {
                        type: 'MultiPolygon',
                        coordinates: polyCoords,
                    },
                });
            }
        });

        // Find LineString (also useful for boundaries)
        if (features.length === 0) {
            const lineStrings = pm.querySelectorAll('LineString');
            lineStrings.forEach((ls) => {
                const coordsEl = ls.querySelector('coordinates');
                if (!coordsEl) return;
                const coords = parseKMLCoordinates(coordsEl.textContent);
                // Close the ring to form a polygon if possible
                if (coords.length >= 3) {
                    const closed = [...coords];
                    if (closed[0][0] !== closed[closed.length - 1][0] ||
                        closed[0][1] !== closed[closed.length - 1][1]) {
                        closed.push([...closed[0]]);
                    }
                    features.push({
                        type: 'Feature',
                        properties: { name },
                        geometry: { type: 'Polygon', coordinates: [closed] },
                    });
                }
            });
        }
    });

    return { type: 'FeatureCollection', features };
}

function parseKMLCoordinates(text) {
    return text
        .trim()
        .split(/\s+/)
        .map((tuple) => {
            const parts = tuple.split(',').map(Number);
            return [parts[0], parts[1]]; // [lng, lat] — GeoJSON order
        })
        .filter((c) => !isNaN(c[0]) && !isNaN(c[1]));
}

// ===== Process ZIP file (containing Shapefile) =====
async function processZipFile(file) {
    const arrayBuffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);

    // Find .shp file inside the ZIP
    const shpFileName = Object.keys(zip.files).find((name) =>
        name.toLowerCase().endsWith('.shp')
    );

    if (!shpFileName) {
        throw new Error('No .shp file found in the ZIP archive');
    }

    const shpBuffer = await zip.files[shpFileName].async('arraybuffer');
    const geojson = readShpBinary(shpBuffer);
    handleUploadedGeoJSON(geojson, file.name);
}

// ===== Process standalone .shp file =====
async function processShpFile(file) {
    const arrayBuffer = await file.arrayBuffer();
    const geojson = readShpBinary(arrayBuffer);
    handleUploadedGeoJSON(geojson, file.name);
}

// ===== SHP Binary Reader =====
function readShpBinary(arrayBuffer) {
    const view = new DataView(arrayBuffer);
    const features = [];

    // Validate file code
    const fileCode = view.getInt32(0, false); // big-endian
    if (fileCode !== 9994) throw new Error('Invalid Shapefile: bad file code');

    const fileLength = view.getInt32(24, false) * 2; // in bytes
    const shapeType = view.getInt32(32, true); // little-endian

    // Read records
    let offset = 100; // skip header
    while (offset < fileLength && offset < arrayBuffer.byteLength - 8) {
        const recordNum = view.getInt32(offset, false);
        const contentLength = view.getInt32(offset + 4, false) * 2; // in bytes
        offset += 8; // skip record header

        if (contentLength <= 0 || offset + contentLength > arrayBuffer.byteLength) break;

        const recShapeType = view.getInt32(offset, true);

        let geometry = null;

        if (recShapeType === 0) {
            // Null shape — skip
        } else if (recShapeType === 1 || recShapeType === 11 || recShapeType === 21) {
            // Point, PointZ, PointM
            geometry = {
                type: 'Point',
                coordinates: [
                    view.getFloat64(offset + 4, true),
                    view.getFloat64(offset + 12, true),
                ],
            };
        } else if (recShapeType === 3 || recShapeType === 13 || recShapeType === 23) {
            // PolyLine, PolyLineZ, PolyLineM
            geometry = readPolyShape(view, offset, 'LineString', 'MultiLineString');
        } else if (recShapeType === 5 || recShapeType === 15 || recShapeType === 25) {
            // Polygon, PolygonZ, PolygonM
            geometry = readPolyShape(view, offset, 'Polygon', 'MultiPolygon');
        }

        if (geometry) {
            features.push({ type: 'Feature', properties: {}, geometry });
        }

        offset += contentLength;
    }

    return { type: 'FeatureCollection', features };
}

function readPolyShape(view, offset, singleType, multiType) {
    let off = offset + 4; // skip shape type
    // Bounding box: xmin, ymin, xmax, ymax (skip)
    off += 32;

    const numParts = view.getInt32(off, true); off += 4;
    const numPoints = view.getInt32(off, true); off += 4;

    const parts = [];
    for (let i = 0; i < numParts; i++) {
        parts.push(view.getInt32(off, true));
        off += 4;
    }

    const points = [];
    for (let i = 0; i < numPoints; i++) {
        const x = view.getFloat64(off, true);
        const y = view.getFloat64(off + 8, true);
        points.push([x, y]);
        off += 16;
    }

    // Split into rings/parts
    const rings = [];
    for (let i = 0; i < numParts; i++) {
        const start = parts[i];
        const end = i < numParts - 1 ? parts[i + 1] : numPoints;
        rings.push(points.slice(start, end));
    }

    if (singleType === 'LineString') {
        return rings.length === 1
            ? { type: 'LineString', coordinates: rings[0] }
            : { type: 'MultiLineString', coordinates: rings };
    } else {
        // Polygon — each part is a ring (first = outer, rest = holes)
        return rings.length === 1
            ? { type: 'Polygon', coordinates: rings }
            : { type: 'Polygon', coordinates: rings };
    }
}

// ===== Handle uploaded GeoJSON and display on map =====
function handleUploadedGeoJSON(geojson, fileName) {
    if (!geojson || !geojson.features || geojson.features.length === 0) {
        hideLoading();
        showToast('No features found in the uploaded file', 'warning');
        return;
    }

    // Find first polygon/multipolygon feature for boundary
    const polyFeature = geojson.features.find((f) =>
        f.geometry &&
        (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
    );

    if (!polyFeature) {
        hideLoading();
        showToast('No polygon boundaries found in the file. Only Polygon geometries can be used as boundaries.', 'warning');
        return;
    }

    // Clear any existing drawing
    clearDrawing();

    // Convert GeoJSON polygon to Leaflet layer
    const geoJsonLayer = L.geoJSON(polyFeature, {
        style: {
            color: CONFIG.polygon.color,
            fillColor: CONFIG.polygon.fillColor,
            fillOpacity: 0.15,
            weight: 2,
        },
    });

    // Add to drawn items
    geoJsonLayer.eachLayer((layer) => {
        drawnItems.addLayer(layer);
        state.drawnLayer = layer;
    });

    // Extract polygon coordinates for Overpass query (lat, lng format)
    let coords;
    if (polyFeature.geometry.type === 'Polygon') {
        // Outer ring, convert [lng, lat] -> [lat, lng]
        coords = polyFeature.geometry.coordinates[0].map((c) => [c[1], c[0]]);
    } else {
        // MultiPolygon — use first polygon's outer ring
        coords = polyFeature.geometry.coordinates[0][0].map((c) => [c[1], c[0]]);
    }

    state.drawnPolygon = coords;
    state.polygonCoords = coords;

    // Fit map to boundary
    const bounds = geoJsonLayer.getBounds();
    map.fitBounds(bounds, { padding: [50, 50] });

    // Show confirm popup
    const areaKm2 = calculateArea(state.polygonCoords);
    el.confirmAreaInfo.textContent = `Area: ${formatArea(areaKm2)} · from ${fileName}`;
    el.confirmPopup.classList.remove('hidden');
    el.clearBtn.classList.remove('hidden');

    hideLoading();

    const featureCount = geojson.features.filter(
        (f) => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
    ).length;

    showToast(
        `Loaded boundary from ${fileName} (${featureCount} polygon${featureCount > 1 ? 's' : ''} found, using first)`,
        'success'
    );
}

// ======================================================================
// EXPORT SETTINGS — UI BINDINGS
// ======================================================================

// Toggle contour interval row when checkbox changes
el.includeContours.addEventListener('change', () => {
    el.contourIntervalRow.classList.toggle('hidden', !el.includeContours.checked);
});

// ======================================================================
// WGS84 → UTM COORDINATE TRANSFORMATION
// ======================================================================

function getUTMZone(lng) {
    return Math.floor((lng + 180) / 6) + 1;
}

function getUTMHemisphere(lat) {
    return lat >= 0 ? 'N' : 'S';
}

function wgs84ToUTM(lat, lng) {
    const zone = getUTMZone(lng);
    const cm = (zone - 1) * 6 - 180 + 3;
    const a = 6378137.0;
    const f = 1 / 298.257223563;
    const k0 = 0.9996;
    const e = Math.sqrt(2 * f - f * f);
    const e2 = e * e;
    const ep2 = e2 / (1 - e2);
    const lr = lat * Math.PI / 180;
    const lnr = lng * Math.PI / 180;
    const l0r = cm * Math.PI / 180;
    const sL = Math.sin(lr), cL = Math.cos(lr), tL = Math.tan(lr);
    const N = a / Math.sqrt(1 - e2 * sL * sL);
    const T = tL * tL;
    const C = ep2 * cL * cL;
    const A = cL * (lnr - l0r);
    const M = a * (
        (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256) * lr -
        (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 * e2 * e2 / 1024) * Math.sin(2 * lr) +
        (15 * e2 * e2 / 256 + 45 * e2 * e2 * e2 / 1024) * Math.sin(4 * lr) -
        (35 * e2 * e2 * e2 / 3072) * Math.sin(6 * lr)
    );
    const easting = k0 * N * (
        A + (1 - T + C) * A * A * A / 6 +
        (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A * A * A * A * A / 120
    ) + 500000;
    let northing = k0 * (
        M + N * tL * (
            A * A / 2 +
            (5 - T + 9 * C + 4 * C * C) * A * A * A * A / 24 +
            (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A * A * A * A * A * A / 720
        )
    );
    if (lat < 0) northing += 10000000;
    return { easting, northing, zone };
}

function coordToUTM(coord) {
    const { easting, northing } = wgs84ToUTM(coord[1], coord[0]);
    return [easting, northing];
}

// ======================================================================
// ELEVATION DATA — Open-Elevation API
// ======================================================================

async function fetchElevationGrid(bbox, resolution = 20) {
    const latStep = (bbox.ymax - bbox.ymin) / (resolution - 1);
    const lngStep = (bbox.xmax - bbox.xmin) / (resolution - 1);
    const locations = [];
    for (let r = 0; r < resolution; r++)
        for (let c = 0; c < resolution; c++)
            locations.push({ latitude: bbox.ymin + r * latStep, longitude: bbox.xmin + c * lngStep });

    const res = await fetch('https://api.open-elevation.com/api/v1/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locations }),
    });
    if (!res.ok) throw new Error(`Elevation API error: ${res.status}`);
    const data = await res.json();

    const grid = [];
    for (let r = 0; r < resolution; r++) {
        const row = [];
        for (let c = 0; c < resolution; c++) {
            const idx = r * resolution + c;
            row.push({ lat: locations[idx].latitude, lng: locations[idx].longitude, elevation: data.results[idx].elevation });
        }
        grid.push(row);
    }
    return grid;
}

// ======================================================================
// CONTOUR GENERATION — Marching Squares
// ======================================================================

function generateContours(grid, interval) {
    const rows = grid.length, cols = grid[0].length;
    let minE = Infinity, maxE = -Infinity;
    for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
            const e = grid[r][c].elevation;
            if (e < minE) minE = e;
            if (e > maxE) maxE = e;
        }
    const contours = [];
    for (let level = Math.ceil(minE / interval) * interval; level <= Math.floor(maxE / interval) * interval; level += interval) {
        const segs = marchingSquares(grid, level);
        if (segs.length > 0) contours.push({ elevation: level, segments: segs });
    }
    return contours;
}

function marchingSquares(grid, level) {
    const rows = grid.length, cols = grid[0].length, segs = [];
    for (let r = 0; r < rows - 1; r++)
        for (let c = 0; c < cols - 1; c++) {
            const bl = grid[r][c], br = grid[r][c + 1], tr = grid[r + 1][c + 1], tl = grid[r + 1][c];
            let ci = 0;
            if (bl.elevation >= level) ci |= 1;
            if (br.elevation >= level) ci |= 2;
            if (tr.elevation >= level) ci |= 4;
            if (tl.elevation >= level) ci |= 8;
            if (ci === 0 || ci === 15) continue;
            const bot = iEdge(bl, br, level), rt = iEdge(br, tr, level);
            const top = iEdge(tl, tr, level), lft = iEdge(bl, tl, level);
            switch (ci) {
                case 1: case 14: segs.push([lft, bot]); break;
                case 2: case 13: segs.push([bot, rt]); break;
                case 3: case 12: segs.push([lft, rt]); break;
                case 4: case 11: segs.push([rt, top]); break;
                case 5: segs.push([lft, top]); segs.push([bot, rt]); break;
                case 6: case 9: segs.push([bot, top]); break;
                case 7: case 8: segs.push([lft, top]); break;
                case 10: segs.push([lft, bot]); segs.push([rt, top]); break;
            }
        }
    return segs;
}

function iEdge(p1, p2, level) {
    const t = (level - p1.elevation) / (p2.elevation - p1.elevation + 1e-10);
    return [p1.lng + t * (p2.lng - p1.lng), p1.lat + t * (p2.lat - p1.lat)];
}

// ======================================================================
// BUILDING HEIGHT EXTRACTION
// ======================================================================

function getBuildingHeight(props, falseHeight) {
    const tags = props.tags || props;
    if (tags.height) { const h = parseFloat(tags.height); if (!isNaN(h) && h > 0) return h; }
    if (tags['building:levels']) { const l = parseInt(tags['building:levels'], 10); if (!isNaN(l) && l > 0) return l * 3; }
    return falseHeight;
}

// ======================================================================
// AutoLISP SCRIPT — DWG to SHP converter (for AutoCAD users)
// ======================================================================

function generateAutoLispScript() {
    return `;;; ============================================
;;; DWG2SHP.lsp — Export DWG objects to Shapefile
;;; Load in AutoCAD: (load "DWG2SHP.lsp")
;;; Run command:    DWG2SHP
;;; Requires: AutoCAD Map 3D or Civil 3D
;;; ============================================

(defun c:DWG2SHP (/ shp_out ss cmd_echo)
  (setq cmd_echo (getvar "CMDECHO"))
  (setvar "CMDECHO" 0)

  (princ "\\n--- GIS Export: DWG to SHP ---")

  ;; 1. Select objects to export
  (princ "\\nSelect objects to export to Shapefile...")
  (setq ss (ssget))

  (if ss
    (progn
      ;; 2. Define output file
      (setq shp_out (getfiled "Save as Shapefile" "" "shp" 1))

      (if shp_out
        (if (and (member "geomap.arx" (arx)) (getcname "_MAPEXPORT"))
          (progn
            (princ "\\nInitializing Map 3D Export...")
            (command "_-MAPEXPORT" "SHAPE" shp_out "_S" ss "" "_proceed")
            (princ (strcat "\\nSuccessfully exported to: " shp_out))
          )
          (alert "Map 3D/Civil 3D engine not found. SHP export requires these platforms.")
        )
        (princ "\\nExport cancelled: No file specified.")
      )
    )
    (princ "\\nExport cancelled: No objects selected.")
  )

  (setvar "CMDECHO" cmd_echo)
  (princ)
)
`;
}

// ======================================================================
// README & LICENSE GENERATORS
// ======================================================================

function generateReadme(areaKm2, utmZone, hemisphere, categories, featureCounts, hasContours) {
    const now = new Date().toISOString().split('T')[0];
    return `YEAN — OSM Geospatial Data Export
====================================
Generated: ${now}
Coordinate System: UTM Zone ${utmZone}${hemisphere} (WGS84)
Scale: 1:1 (metres)
Selected Area: ${formatArea(areaKm2)}

Data Categories:
${categories.map((c, i) => `  - ${c.name}: ${featureCounts[i] || 0} features`).join('\n')}
${hasContours ? '\nContour lines included from SRTM elevation data.' : ''}

Files in this archive:
  - drawing.dxf      AutoCAD R12 DXF (AC1009) — open in any CAD software
  - DWG2SHP.lsp      AutoLISP script to convert DXF/DWG to Shapefile
  - README.txt       This file
  - LICENSE.txt      Data attribution and licence

Using DWG2SHP.lsp:
  1. Open the .dxf file in AutoCAD Map 3D or Civil 3D
  2. Type: (load "DWG2SHP.lsp") in the command line
  3. Type: DWG2SHP
  4. Select objects and choose output location

DXF Details:
  - 3D buildings extruded using OSM height data or false height
  - Layers auto-organised by feature type
  - Compatible with: AutoCAD, BricsCAD, DraftSight, QCAD, LibreCAD, FreeCAD

Data Source:
  - Map data: (c) OpenStreetMap contributors (ODbL)
  - Elevation: SRTM / NASA via Open-Elevation API
  - Extracted via Overpass API
`;
}

function generateLicense() {
    return `DATA LICENSE\n============\n\nMap Data:\n  (c) OpenStreetMap contributors\n  Open Data Commons Open Database License (ODbL)\n  https://www.openstreetmap.org/copyright\n\nElevation Data:\n  SRTM courtesy of NASA / USGS\n  https://open-elevation.com\n\nGenerated by Yean — Geospatial Data Extractor\n`;
}

// ======================================================================
// DXF DOWNLOAD HANDLER — FULL GIS PIPELINE
// Overpass → GeoJSON → UTM Transform → 3D DXF → ZIP
// ======================================================================
el.downloadDwgBtn.addEventListener('click', async () => {
    if (state.selectedCategories.size === 0 || !state.polygonCoords) return;

    const selectedCats = CATEGORIES.filter(c => state.selectedCategories.has(c.id));
    const falseHeight = parseFloat(el.falseHeight.value) || 9;
    const wantContours = el.includeContours.checked;
    const contourInterval = parseInt(el.contourInterval.value, 10) || 5;

    // UTM zone
    const cLat = state.polygonCoords.reduce((s, c) => s + c[0], 0) / state.polygonCoords.length;
    const cLng = state.polygonCoords.reduce((s, c) => s + c[1], 0) / state.polygonCoords.length;
    const utmZone = getUTMZone(cLng);
    const hemisphere = getUTMHemisphere(cLat);

    const totalSteps = selectedCats.length + (wantContours ? 1 : 0) + 1;
    let completedSteps = 0;

    showLoading('GIS Export', 'Starting data extraction...');
    updateProgress(0, totalSteps);

    try {
        const allEntities = [];
        const allLayers = new Set();
        const featureCounts = [];
        let totalFeatures = 0;
        const utmExt = { xmin: Infinity, ymin: Infinity, xmax: -Infinity, ymax: -Infinity, zmax: 0 };

        const trackUTM = (e, n, z = 0) => {
            if (e < utmExt.xmin) utmExt.xmin = e;
            if (n < utmExt.ymin) utmExt.ymin = n;
            if (e > utmExt.xmax) utmExt.xmax = e;
            if (n > utmExt.ymax) utmExt.ymax = n;
            if (z > utmExt.zmax) utmExt.zmax = z;
        };

        // ── Fetch & process each category ──
        for (const cat of selectedCats) {
            updateLoadingText(`Querying OSM: ${cat.name}...`);
            const query = buildOverpassQuery(cat.overpassTags, state.polygonCoords);
            const osmData = await fetchOverpassData(query);
            const geojson = osmtogeojson(osmData);

            if (geojson.features.length === 0) {
                showToast(`No ${cat.name} data found`, 'warning');
                featureCounts.push(0);
                completedSteps++;
                updateProgress(completedSteps, totalSteps);
                continue;
            }

            updateLoadingText(`Processing ${cat.name} (${geojson.features.length} features)...`);
            featureCounts.push(geojson.features.length);
            totalFeatures += geojson.features.length;

            geojson.features.forEach(feature => {
                if (!feature.geometry) return;
                const props = feature.properties || {};
                const tags = props.tags || props;
                const layer = getDxfLayerName(props, cat.name);
                allLayers.add(layer);
                const isBuilding = !!(tags.building);

                switch (feature.geometry.type) {
                    case 'Point': {
                        const utm = coordToUTM(feature.geometry.coordinates);
                        trackUTM(utm[0], utm[1]);
                        allEntities.push(dxfPoint(utm, layer));
                        break;
                    }
                    case 'LineString': {
                        const uc = feature.geometry.coordinates.map(c => coordToUTM(c));
                        uc.forEach(c => trackUTM(c[0], c[1]));
                        allEntities.push(dxfPolyline(uc, layer, false, 0));
                        break;
                    }
                    case 'MultiLineString':
                        feature.geometry.coordinates.forEach(line => {
                            const uc = line.map(c => coordToUTM(c));
                            uc.forEach(c => trackUTM(c[0], c[1]));
                            allEntities.push(dxfPolyline(uc, layer, false, 0));
                        });
                        break;
                    case 'Polygon':
                        feature.geometry.coordinates.forEach(ring => {
                            const uc = ring.map(c => coordToUTM(c));
                            uc.forEach(c => trackUTM(c[0], c[1]));
                            if (isBuilding) {
                                const h = getBuildingHeight(props, falseHeight);
                                uc.forEach(c => trackUTM(c[0], c[1], h));
                                allEntities.push(dxfPolyline(uc, layer, true, 0));
                                allEntities.push(dxfPolyline(uc, layer + '_Roof', true, h));
                                allLayers.add(layer + '_Roof');
                                allEntities.push(...dxf3DWalls(uc, h, layer + '_Walls'));
                                allLayers.add(layer + '_Walls');
                            } else {
                                allEntities.push(dxfPolyline(uc, layer, true, 0));
                            }
                        });
                        break;
                    case 'MultiPolygon':
                        feature.geometry.coordinates.forEach(poly => {
                            poly.forEach(ring => {
                                const uc = ring.map(c => coordToUTM(c));
                                uc.forEach(c => trackUTM(c[0], c[1]));
                                if (isBuilding) {
                                    const h = getBuildingHeight(props, falseHeight);
                                    uc.forEach(c => trackUTM(c[0], c[1], h));
                                    allEntities.push(dxfPolyline(uc, layer, true, 0));
                                    allEntities.push(dxfPolyline(uc, layer + '_Roof', true, h));
                                    allLayers.add(layer + '_Roof');
                                    allEntities.push(...dxf3DWalls(uc, h, layer + '_Walls'));
                                    allLayers.add(layer + '_Walls');
                                } else {
                                    allEntities.push(dxfPolyline(uc, layer, true, 0));
                                }
                            });
                        });
                        break;
                }
            });

            completedSteps++;
            updateProgress(completedSteps, totalSteps);
        }

        // ── Contour generation (optional) ──
        let contourData = [];
        if (wantContours) {
            updateLoadingText('Fetching SRTM elevation data...');
            try {
                const lats = state.polygonCoords.map(c => c[0]);
                const lngs = state.polygonCoords.map(c => c[1]);
                const wgsBbox = { xmin: Math.min(...lngs), ymin: Math.min(...lats), xmax: Math.max(...lngs), ymax: Math.max(...lats) };
                const grid = await fetchElevationGrid(wgsBbox, 25);
                updateLoadingText('Generating contour lines...');
                contourData = generateContours(grid, contourInterval);
                const cLayer = 'Contours';
                allLayers.add(cLayer);
                contourData.forEach(({ elevation, segments }) => {
                    segments.forEach(seg => {
                        const s = coordToUTM(seg[0]), e = coordToUTM(seg[1]);
                        trackUTM(s[0], s[1], elevation);
                        trackUTM(e[0], e[1], elevation);
                        allEntities.push(dxfLine3D(s, e, elevation, cLayer));
                    });
                });
                showToast(`Generated ${contourData.length} contour levels`, 'info');
            } catch (err) {
                console.warn('Elevation fetch failed:', err);
                showToast('Contour generation failed. Continuing without contours.', 'warning');
            }
            completedSteps++;
            updateProgress(completedSteps, totalSteps);
        }

        if (allEntities.length === 0) {
            hideLoading();
            showToast('No data found for any selected category', 'warning');
            return;
        }

        // ── Build DXF and ZIP ──
        updateLoadingText('Building DXF with UTM coordinates...');
        const pad = 10;
        const bbox = {
            xmin: utmExt.xmin - pad, ymin: utmExt.ymin - pad,
            xmax: utmExt.xmax + pad, ymax: utmExt.ymax + pad,
        };

        const dxfContent = buildR12Dxf(Array.from(allLayers), allEntities, bbox);

        updateLoadingText('Creating ZIP archive...');
        const areaKm2 = calculateArea(state.polygonCoords);
        const zip = new JSZip();
        zip.file('drawing.dxf', dxfContent);
        zip.file('DWG2SHP.lsp', generateAutoLispScript());
        zip.file('README.txt', generateReadme(areaKm2, utmZone, hemisphere, selectedCats, featureCounts, contourData.length > 0));
        zip.file('LICENSE.txt', generateLicense());

        const zipBlob = await zip.generateAsync({ type: 'blob' });
        saveAs(zipBlob, `yean_export_UTM${utmZone}${hemisphere}.zip`);

        completedSteps++;
        updateProgress(completedSteps, totalSteps);
        hideLoading();
        showToast(
            `Export complete! ${totalFeatures} features in UTM Zone ${utmZone}${hemisphere} (1:1 m scale).` +
            (contourData.length > 0 ? ` ${contourData.length} contour levels.` : '') +
            ' Includes DWG2SHP.lsp for AutoCAD conversion.',
            'success'
        );
    } catch (error) {
        console.error('GIS export error:', error);
        hideLoading();
        showToast(`Export failed: ${error.message}`, 'error');
    }
});

// ======================================================================
// DXF ENTITY GENERATORS — R12 AC1009 format, UTM, 3D
// ======================================================================

function getDxfLayerName(props, defaultLayer) {
    const tags = props.tags || props;
    if (tags.building) return 'Buildings';
    if (tags.highway) return 'Roads_' + tags.highway;
    if (tags.waterway) return 'Water_' + tags.waterway;
    if (tags.natural === 'water') return 'Water_body';
    return defaultLayer || '0';
}

function dxfPoint(utm, layer) {
    return ['0', 'POINT', '8', layer, '10', utm[0].toFixed(3), '20', utm[1].toFixed(3), '30', '0.0'].join('\n');
}

function dxfPolyline(coords, layer, closed, elevation) {
    const z = (elevation || 0).toFixed(3);
    const is3D = elevation > 0;
    const lines = ['0', 'POLYLINE', '8', layer, '66', '1', '70', closed ? (is3D ? '9' : '1') : (is3D ? '8' : '0'), '30', z];
    coords.forEach(c => {
        lines.push('0', 'VERTEX', '8', layer, '10', c[0].toFixed(3), '20', c[1].toFixed(3), '30', z, '70', is3D ? '32' : '0');
    });
    lines.push('0', 'SEQEND', '8', layer);
    return lines.join('\n');
}

function dxfLine3D(s, e, elev, layer) {
    const z = elev.toFixed(3);
    return ['0', 'LINE', '8', layer, '10', s[0].toFixed(3), '20', s[1].toFixed(3), '30', z, '11', e[0].toFixed(3), '21', e[1].toFixed(3), '31', z].join('\n');
}

function dxf3DWalls(coords, height, layer) {
    const h = height.toFixed(3);
    const ents = [];
    for (let i = 0; i < coords.length - 1; i++) {
        const x1 = coords[i][0].toFixed(3), y1 = coords[i][1].toFixed(3);
        const x2 = coords[i + 1][0].toFixed(3), y2 = coords[i + 1][1].toFixed(3);
        ents.push(['0', '3DFACE', '8', layer, '10', x1, '20', y1, '30', '0.0', '11', x2, '21', y2, '31', '0.0', '12', x2, '22', y2, '32', h, '13', x1, '23', y1, '33', h].join('\n'));
    }
    return ents;
}

// ======================================================================
// R12 DXF FILE BUILDER
// ======================================================================

function buildR12Dxf(layers, entityBlocks, bbox) {
    const allLayers = ['0', ...layers.filter(l => l !== '0')];
    const colorMap = { Buildings: 30, Buildings_Roof: 40, Buildings_Walls: 52, Contours: 8, Water_body: 4, Roads_primary: 1, Roads_secondary: 3, Roads_tertiary: 5, Roads_residential: 9 };
    const defPal = [7, 1, 2, 3, 4, 5, 6, 8, 9, 30, 40, 50, 140, 170, 200];
    const dxf = [];

    // HEADER
    dxf.push('0', 'SECTION', '2', 'HEADER',
        '9', '$ACADVER', '1', 'AC1009',
        '9', '$INSBASE', '10', '0.0', '20', '0.0', '30', '0.0',
        '9', '$EXTMIN', '10', bbox.xmin.toFixed(3), '20', bbox.ymin.toFixed(3), '30', '0.0',
        '9', '$EXTMAX', '10', bbox.xmax.toFixed(3), '20', bbox.ymax.toFixed(3), '30', '0.0',
        '9', '$LIMMIN', '10', bbox.xmin.toFixed(3), '20', bbox.ymin.toFixed(3),
        '9', '$LIMMAX', '10', bbox.xmax.toFixed(3), '20', bbox.ymax.toFixed(3),
        '0', 'ENDSEC');

    // TABLES
    dxf.push('0', 'SECTION', '2', 'TABLES');
    dxf.push('0', 'TABLE', '2', 'LTYPE', '70', '1', '0', 'LTYPE', '2', 'CONTINUOUS', '70', '0', '3', 'Solid line', '72', '65', '73', '0', '40', '0.0', '0', 'ENDTAB');
    dxf.push('0', 'TABLE', '2', 'LAYER', '70', String(allLayers.length));
    allLayers.forEach((n, i) => {
        const col = colorMap[n] || (n === '0' ? 7 : defPal[i % defPal.length]);
        dxf.push('0', 'LAYER', '2', n, '70', '0', '62', String(col), '6', 'CONTINUOUS');
    });
    dxf.push('0', 'ENDTAB');
    dxf.push('0', 'TABLE', '2', 'STYLE', '70', '1', '0', 'STYLE', '2', 'STANDARD', '70', '0', '40', '0.0', '41', '1.0', '50', '0.0', '71', '0', '42', '0.2', '3', 'txt', '4', '', '0', 'ENDTAB');
    dxf.push('0', 'TABLE', '2', 'VIEW', '70', '0', '0', 'ENDTAB');
    dxf.push('0', 'TABLE', '2', 'UCS', '70', '0', '0', 'ENDTAB');
    dxf.push('0', 'TABLE', '2', 'VPORT', '70', '1', '0', 'VPORT', '2', '*ACTIVE', '70', '0',
        '10', '0.0', '20', '0.0', '11', '1.0', '21', '1.0',
        '12', ((bbox.xmin + bbox.xmax) / 2).toFixed(3), '22', ((bbox.ymin + bbox.ymax) / 2).toFixed(3),
        '13', '0.0', '23', '0.0', '14', '1.0', '24', '1.0', '15', '0.0', '25', '0.0',
        '16', '0.0', '26', '0.0', '36', '1.0', '17', '0.0', '27', '0.0', '37', '0.0',
        '40', (Math.max(bbox.xmax - bbox.xmin, bbox.ymax - bbox.ymin) * 1.1).toFixed(3),
        '41', '1.5', '42', '50.0', '43', '0.0', '44', '0.0', '50', '0.0', '51', '0.0',
        '71', '0', '72', '100', '73', '1', '74', '3', '75', '0', '76', '0', '0', 'ENDTAB');
    dxf.push('0', 'TABLE', '2', 'APPID', '70', '1', '0', 'APPID', '2', 'ACAD', '70', '0', '0', 'ENDTAB');
    dxf.push('0', 'TABLE', '2', 'DIMSTYLE', '70', '0', '0', 'ENDTAB');
    dxf.push('0', 'ENDSEC');

    // BLOCKS
    dxf.push('0', 'SECTION', '2', 'BLOCKS', '0', 'ENDSEC');

    // ENTITIES
    dxf.push('0', 'SECTION', '2', 'ENTITIES');
    entityBlocks.forEach(b => dxf.push(b));
    dxf.push('0', 'ENDSEC');

    dxf.push('0', 'EOF');
    return dxf.join('\n');
}



// ======================================================================
// INITIALIZATION
// ======================================================================
showToast('Welcome to Yean! Draw a polygon or upload a Shapefile/KML to select a boundary.', 'info');

// Search functionality using Nominatim
if (el.searchForm && el.searchInput) {
    el.searchForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const query = el.searchInput.value.trim();
        if (!query) return;

        try {
            const url = new URL('https://nominatim.openstreetmap.org/search');
            url.searchParams.set('q', query);
            url.searchParams.set('format', 'json');
            url.searchParams.set('limit', '1');

            const res = await fetch(url.toString(), {
                headers: {
                    Accept: 'application/json',
                    'User-Agent': 'Yean-Geospatial-Tool/1.0 (+https://github.com/)',
                },
            });

            if (!res.ok) {
                throw new Error('Search service unavailable');
            }

            const data = await res.json();
            if (!data.length) {
                showToast('No results found for that search.', 'warning');
                return;
            }

            const result = data[0];
            const lat = parseFloat(result.lat);
            const lon = parseFloat(result.lon);

            if (Number.isFinite(lat) && Number.isFinite(lon)) {
                map.setView([lat, lon], 14);
            } else {
                showToast('Invalid location returned from search.', 'error');
            }
        } catch (err) {
            console.error('Search error', err);
            showToast('Search failed. Please try again.', 'error');
        }
    });
}
