import { execFileSync } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';

const required = [
  'index.html', 'manifest.webmanifest', 'sw.js', 'version.json',
  'assets/css/app.css', 'assets/data/dashboard.json',
  'assets/js/app.js', 'assets/js/api.js', 'assets/js/charts.js', 'assets/js/config.js',
  'assets/js/data.js', 'assets/js/map.js', 'assets/js/pdf-viewer.js', 'assets/js/utils.js',
  'assets/vendor/leaflet/leaflet.css', 'assets/vendor/leaflet/leaflet.js',
  'assets/vendor/chartjs/chart.umd.js', 'assets/vendor/lucide/lucide.min.js',
  'assets/vendor/pdfjs/LICENSE', 'assets/vendor/pdfjs/pdf.mjs', 'assets/vendor/pdfjs/pdf.worker.mjs'
];

await Promise.all(required.map((file) => access(file)));
const version = JSON.parse(await readFile('version.json', 'utf8'));
const config = await readFile('assets/js/config.js', 'utf8');
const serviceWorker = await readFile('sw.js', 'utf8');
if (!config.includes(`version: '${version.version}'`)) throw new Error('La versión de config.js no coincide con version.json.');
if (!serviceWorker.includes(`v${version.version}`)) throw new Error('La caché del service worker no coincide con la versión.');

const snapshotText = await readFile('assets/data/dashboard.json', 'utf8');
const snapshot = JSON.parse(snapshotText);
if (!Array.isArray(snapshot.schools) || snapshot.schools.length !== snapshot.metrics.schools) {
  throw new Error('El total de escuelas no coincide con la instantánea.');
}
const statusTotal = snapshot.metrics.closed + snapshot.metrics.saved + snapshot.metrics.pending;
if (statusTotal !== snapshot.metrics.schools) throw new Error('Los estados no suman el total de escuelas.');
if (snapshot.metrics.withCoordinates !== snapshot.schools.filter((item) => Number.isFinite(item.latitude) && Number.isFinite(item.longitude)).length) {
  throw new Error('El control de coordenadas no coincide.');
}
if (snapshot.metrics.ocrPhotos !== snapshot.metrics.directPhotos) {
  throw new Error('El total OCR no coincide con las fotos directas.');
}
if (snapshot.metrics.photoLinksConfirmed + snapshot.metrics.photoLinksReview !== snapshot.metrics.ocrPhotos) {
  throw new Error('La conciliación foto-RUE no cubre todas las fotos OCR.');
}
if (snapshot.metrics.photoLinksConflict > snapshot.metrics.photoLinksReview) {
  throw new Error('Los conflictos no están incluidos en los casos por revisar.');
}

const forbidden = [/[A-Za-z]:\\/, /docs\.google\.com/i, /drive\.google\.com/i, /"(?:token|cedula|codigo_censista|drive_url|ruta_absoluta|sha256|texto_ocr|fecha_hora_ocr|latitud_ocr|longitud_ocr)"\s*:/i];
for (const pattern of forbidden) {
  if (pattern.test(snapshotText)) throw new Error(`La instantánea contiene un patrón prohibido: ${pattern}`);
}

for (const file of required.filter((item) => item.endsWith('.js'))) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
}

console.log(`Validación estática PASS: ${snapshot.schools.length} escuelas, versión ${version.version}.`);
