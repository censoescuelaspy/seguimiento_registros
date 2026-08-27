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
  throw new Error('El total de sedes no coincide con la instantánea.');
}
const statusTotal = snapshot.metrics.closed + snapshot.metrics.saved + snapshot.metrics.pending;
if (statusTotal !== snapshot.metrics.schools) throw new Error('Los estados no suman el total de sedes.');
if (snapshot.metrics.physicalSites !== snapshot.schools.length) {
  throw new Error('El total de sedes físicas no coincide con las filas publicadas.');
}
const siteIds = new Set(snapshot.schools.map((school) => school.siteId));
if (siteIds.size !== snapshot.schools.length) throw new Error('Existen sedes físicas duplicadas.');
const institutionCodes = snapshot.schools.reduce((total, school) => total + (school.codes || [school.code]).length, 0);
if (snapshot.metrics.institutionCodes !== institutionCodes) throw new Error('El total de códigos MEC no coincide.');
const rueInstitutionCodes = snapshot.schools.reduce((total, school) => total + Number(school.rueCodeCount || 0), 0);
if (snapshot.metrics.rueInstitutionCodes !== rueInstitutionCodes) throw new Error('La cobertura de códigos RUE no coincide.');
const ruePhysicalSites = snapshot.schools.filter((school) => school.rueAvailable).length;
if (snapshot.metrics.ruePhysicalSites !== ruePhysicalSites) throw new Error('La cobertura de sedes RUE no coincide.');
if (snapshot.metrics.withoutRueRecord !== snapshot.schools.length - ruePhysicalSites) {
  throw new Error('El total de sedes sin ficha RUE no coincide.');
}
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

console.log(`Validación estática PASS: ${snapshot.schools.length} sedes, ${institutionCodes} códigos MEC, versión ${version.version}.`);
