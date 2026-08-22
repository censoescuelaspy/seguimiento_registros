import { escapeHtml, formatMinutes, statusLabel } from './utils.js';

let map = null;
let markerLayer = null;
let markers = new Map();

function markerIcon(school, selectedCode) {
  const selected = school.code === selectedCode ? ' selected' : '';
  const size = selected ? 29 : 22;
  return L.divIcon({
    className: '',
    html: `<span class="school-marker ${school.statusKey}${selected}" aria-hidden="true"></span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2]
  });
}

export function initSchoolMap(element, schools, onSelect, selectedCode = '') {
  destroySchoolMap();
  map = L.map(element, { zoomControl: true, preferCanvas: true, maxZoom: 21 });
  const street = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 20,
    attribution: '&copy; OpenStreetMap contributors'
  });
  const satellite = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 21, attribution: 'Tiles &copy; Esri' }
  );
  satellite.addTo(map);
  L.control.layers({ Satélite: satellite, Calles: street }, null, { position: 'topright' }).addTo(map);
  markerLayer = L.layerGroup().addTo(map);
  updateSchoolMap(schools, onSelect, selectedCode, true);
  return map;
}

export function updateSchoolMap(schools, onSelect, selectedCode = '', fit = false) {
  if (!map || !markerLayer) return;
  markerLayer.clearLayers();
  markers = new Map();
  const bounds = [];
  schools.forEach((school) => {
    if (!Number.isFinite(Number(school.latitude)) || !Number.isFinite(Number(school.longitude))) return;
    const marker = L.marker([school.latitude, school.longitude], {
      icon: markerIcon(school, selectedCode),
      title: school.name,
      riseOnHover: true
    });
    marker.bindPopup(`<div class="map-popup"><strong>${escapeHtml(school.name)}</strong><span>MEC ${escapeHtml(school.code)} · ${escapeHtml(school.district)}</span><small>${escapeHtml(statusLabel(school.statusKey))} · ${escapeHtml(formatMinutes(school.observedMinutes))}</small></div>`);
    marker.on('click', () => onSelect(school.code));
    marker.addTo(markerLayer);
    markers.set(school.code, marker);
    bounds.push([school.latitude, school.longitude]);
  });
  if (fit) {
    if (selectedCode && markers.has(selectedCode)) focusSchool(selectedCode, 18, false);
    else if (bounds.length) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 13 });
    else map.setView([-25.3, -57.55], 10);
  }
}

export function focusSchool(code, zoom = 18, openPopup = true) {
  if (!map || !markers.has(code)) return;
  const marker = markers.get(code);
  map.flyTo(marker.getLatLng(), Math.min(zoom, map.getMaxZoom()), { duration: .45 });
  if (openPopup) marker.openPopup();
}

export function invalidateSchoolMap() {
  setTimeout(() => map?.invalidateSize(), 20);
}

export function destroySchoolMap() {
  if (map) map.remove();
  map = null;
  markerLayer = null;
  markers = new Map();
}

