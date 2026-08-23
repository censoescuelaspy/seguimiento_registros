# Actualización operativa

## Flujo autorizado

1. Verificar que la unidad `J:` y las fuentes RUE estén materializadas.
2. Ejecutar el actualizador de la base maestra. Este procesa localmente los rótulos de fotos nuevas con RapidOCR y reutiliza por SHA-256 las lecturas válidas anteriores.
3. Generar la instantánea pública con `python tools/export_dashboard.py`.
4. Revisar `reports/privacy_audit.json`; todos los controles deben estar en `PASS`.
5. Ejecutar `npm run check`.
6. Revisar `git diff` y confirmar que solo cambien datos sanitizados, versión y bitácora.
7. Hacer commit y push. GitHub Actions publica Pages.
8. Comprobar `version.json`, la fecha de corte y un flujo de login/fotos en la URL pública.

## Frecuencia

La base puede actualizarse después de cada jornada o cuando se incorporen nuevos relevamientos. No conviene publicar después de cada foto: una actualización por lote reduce ruido y permite validar el corte.

## Límites

- GitHub Actions no accede a discos locales ni a carpetas compartidas privadas.
- Los tiempos son sesiones observadas y no cronometraje presencial continuo.
- Los vínculos probables de medios se identifican como tales y no se presentan como confirmados.
- El OCR estructurado se aplica a imágenes directas. Los PDF escaneados sin texto mantienen su estado documental pendiente.
- El texto OCR, las marcas horarias y las coordenadas impresas permanecen en la base privada; el tablero publica solo conteos agregados.
