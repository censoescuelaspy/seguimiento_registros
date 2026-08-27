# Actualización operativa

## Flujo autorizado

1. Verificar que la unidad sincronizada autorizada, las extracciones RUE y la carpeta compartida de campo estén materializadas.
2. Ejecutar el actualizador de la base maestra. Este procesa localmente los rótulos de fotos nuevas con RapidOCR y reutiliza por SHA-256 las lecturas válidas anteriores.
3. Generar la instantánea pública con `python tools/export_dashboard.py`.
4. Confirmar las invariantes de la muestra: 85 sedes físicas, 86 códigos MEC y ausencia de códigos duplicados fuera de la sede compartida documentada.
5. Comparar la cobertura RUE y los medios con el corte anterior. Una disminución exige detener la publicación y explicar la causa.
6. Revisar `reports/privacy_audit.json`; todos los controles deben estar en `PASS`.
7. Ejecutar `npm run check`.
8. Revisar `git diff` y confirmar que solo cambien datos sanitizados, código previsto, versión y bitácora.
9. Hacer commit y push al remoto operativo. GitHub Actions publica Pages.
10. Comprobar `version.json`, la fecha de corte, los KPI de sedes/códigos/cobertura RUE, el mapa y un flujo de login/fotos en la URL pública.

## Frecuencia

La base debe revisarse una vez al día después de la jornada, o cuando se incorporen relevamientos urgentes. No conviene publicar después de cada foto: una actualización por lote reduce ruido y permite validar el corte.

## Límites

- GitHub Actions no accede a discos locales ni a carpetas compartidas privadas; la adquisición y compilación se ejecutan en el equipo autorizado.
- Los tiempos son sesiones observadas y no cronometraje presencial continuo.
- Los vínculos probables de medios se identifican como tales y no se presentan como confirmados.
- El OCR estructurado se aplica a imágenes directas. Los PDF escaneados sin texto mantienen su estado documental pendiente.
- El texto OCR, las marcas horarias y las coordenadas impresas permanecen en la base privada; el tablero publica solo conteos agregados.
