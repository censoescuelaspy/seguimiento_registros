import { cp, mkdir } from 'node:fs/promises';

await Promise.all([
  mkdir('assets/vendor/leaflet/images', { recursive: true }),
  mkdir('assets/vendor/lucide', { recursive: true }),
  mkdir('assets/vendor/chartjs', { recursive: true }),
  mkdir('assets/vendor/pdfjs', { recursive: true }),
  mkdir('assets/vendor/pdfjs/cmaps', { recursive: true }),
  mkdir('assets/vendor/pdfjs/standard_fonts', { recursive: true }),
  mkdir('assets/vendor/pdfjs/wasm', { recursive: true })
]);

await Promise.all([
  cp('node_modules/leaflet/dist/leaflet.css', 'assets/vendor/leaflet/leaflet.css'),
  cp('node_modules/leaflet/dist/leaflet.js', 'assets/vendor/leaflet/leaflet.js'),
  cp('node_modules/leaflet/dist/images', 'assets/vendor/leaflet/images', { recursive: true }),
  cp('node_modules/lucide/dist/umd/lucide.min.js', 'assets/vendor/lucide/lucide.min.js'),
  cp('node_modules/chart.js/dist/chart.umd.js', 'assets/vendor/chartjs/chart.umd.js'),
  cp('node_modules/pdfjs-dist/LICENSE', 'assets/vendor/pdfjs/LICENSE'),
  cp('node_modules/pdfjs-dist/build/pdf.mjs', 'assets/vendor/pdfjs/pdf.mjs'),
  cp('node_modules/pdfjs-dist/build/pdf.worker.mjs', 'assets/vendor/pdfjs/pdf.worker.mjs'),
  cp('node_modules/pdfjs-dist/cmaps', 'assets/vendor/pdfjs/cmaps', { recursive: true }),
  cp('node_modules/pdfjs-dist/standard_fonts', 'assets/vendor/pdfjs/standard_fonts', { recursive: true }),
  cp('node_modules/pdfjs-dist/wasm', 'assets/vendor/pdfjs/wasm', { recursive: true })
]);

console.log('Dependencias web copiadas en assets/vendor.');
