import { cp, mkdir } from 'node:fs/promises';

await Promise.all([
  mkdir('assets/vendor/leaflet/images', { recursive: true }),
  mkdir('assets/vendor/lucide', { recursive: true }),
  mkdir('assets/vendor/chartjs', { recursive: true })
]);

await Promise.all([
  cp('node_modules/leaflet/dist/leaflet.css', 'assets/vendor/leaflet/leaflet.css'),
  cp('node_modules/leaflet/dist/leaflet.js', 'assets/vendor/leaflet/leaflet.js'),
  cp('node_modules/leaflet/dist/images', 'assets/vendor/leaflet/images', { recursive: true }),
  cp('node_modules/lucide/dist/umd/lucide.min.js', 'assets/vendor/lucide/lucide.min.js'),
  cp('node_modules/chart.js/dist/chart.umd.js', 'assets/vendor/chartjs/chart.umd.js')
]);

console.log('Dependencias web copiadas en assets/vendor.');

