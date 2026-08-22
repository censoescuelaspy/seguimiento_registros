# Reglas locales

- Este repositorio es público. Nunca guardar credenciales, tokens, cookies, rutas privadas, cédulas, nombres de usuarios, respuestas detalladas del RUE ni archivos fotográficos.
- `assets/data/dashboard.json` solo puede contener indicadores agregados y datos institucionales de escuelas ya presentes en catálogos públicos.
- Las fotografías se leen exclusivamente mediante el backend autenticado de CIALPA Fotos; no publicar enlaces directos de Drive.
- Toda actualización de datos debe ejecutarse con `python tools/export_dashboard.py`, revisar `reports/privacy_audit.json` y registrar el corte en `BITACORA.md`.
- Antes de publicar: ejecutar `npm run check`, revisar `git diff`, confirmar que no haya secretos y comprobar la URL de GitHub Pages.

