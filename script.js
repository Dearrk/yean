// Initialize the map and set the initial view
const map = L.map('map').setView([20.0, 0.0], 2);

// Use the CartoDB Dark Matter tile layer, which is based on OpenStreetMap data
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 20
}).addTo(map);
