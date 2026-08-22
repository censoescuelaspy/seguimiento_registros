# Bitácora

## 2026-08-22 - Inicio del tablero 1.0.0

### Objetivo

Crear un tablero publicable para seguimiento del relevamiento CIALPA, con estadísticas, tablas, mapas, estimaciones temporales actualizadas y consulta autenticada de fotografías por escuela.

### Diagnóstico

- La base maestra vigente contiene RUE, tiempos e inventario de medios en DuckDB.
- CIALPA Fotos 1.9.0 ya ofrece login, alcance por rol, listado de registros y lectura fragmentada de fotos privadas.
- El repositorio solicitado no existía al iniciar el trabajo.
- La cuenta activa `diegomezapy` no tiene permiso para crear repositorios dentro de la cuenta personal `censoescuelaspy`; se continúa localmente con el remoto exacto configurado.

### Decisiones

- Mantener datos agregados sanitizados en GitHub Pages.
- Mantener registros y fotos detrás de la autorización real del backend.
- No exponer rutas locales, enlaces de Drive, respuestas, cédulas ni archivos privados.
- Aplicar todos los filtros a indicadores, gráficos, mapa, tabla y escenarios de tiempo.
- Usar la mediana de escuelas cerradas y mostrar escenarios Q1, mediana y Q3 con 15% de contingencia.

### Implementación terminada

- Tablero PWA con vistas de resumen, mapa, escuelas, tiempos, evidencias y método.
- Filtros globales por texto, departamento, distrito, estado y disponibilidad de medios.
- Mapa satelital/calles con navegación anterior/siguiente dentro del conjunto filtrado.
- Tabla ordenable y exportable, indicadores y gráficos vinculados a los mismos filtros.
- Estimaciones ajustables por cantidad de equipos, basadas en Q1, mediana y Q3 de escuelas cerradas.
- Detalle temporal por escuela, bloque y aula cuando la fuente dispone de esos eventos.
- Consulta autenticada de registros y fotografías por escuela y especialidad mediante CIALPA Fotos.
- Modo de simulación local separado y señalado; no usa credenciales ni contenido real.

### Corte inicial publicado en la instantánea

- 49 escuelas: 13 cerradas, 10 guardadas y 26 pendientes.
- 119,5 horas observadas.
- Mediana observada por escuela cerrada: 322,05 minutos.
- Estimación restante con 15% de contingencia: 117,59 a 218,85 horas-persona; escenario central 172,23.
- 149 medios inventariados y 19 escuelas con asociación de medios confirmada o probable.

### Validación local

- `python tests/test_export_dashboard.py`: 2/2 pruebas aprobadas.
- `node tools/validate-static.mjs`: PASS, 49 escuelas y versión 1.0.0.
- `playwright test`: 11 pruebas aprobadas y 1 omitida por no aplicar al escritorio.
- Cobertura funcional: login, filtros, mapa y teselas, navegación, detalle, tiempos, evidencias, accesibilidad y ancho móvil.
- `reports/privacy_audit.json`: PASS, sin claves prohibidas, rutas Windows, enlaces privados ni correos.
- Auditoría de dependencias: 0 vulnerabilidades informadas por `npm audit`.
- El backend vigente respondió correctamente al control de salud y rechazó `listRecords` sin sesión con `AUTH_REQUIRED`.

### Estado operativo

- Código y pruebas: terminados.
- Remoto configurado: `https://github.com/censoescuelaspy/seguimiento_relevamiento.git`.
- Publicación: pendiente porque ese repositorio todavía no existe y la cuenta GitHub activa no puede crearlo dentro de la cuenta personal `censoescuelaspy`.
- Próxima acción externa mínima: crear el repositorio vacío bajo `censoescuelaspy` o conceder a `diegomezapy` permiso para hacerlo. Después corresponde `git push` y verificar GitHub Actions y Pages.
