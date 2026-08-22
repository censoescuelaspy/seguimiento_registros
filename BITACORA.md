# Bitácora

## 2026-08-22 - Evidencias históricas por escuela 1.1.0

### Objetivo

Hacer visibles en el tablero las fotos y reportes del plan piloto que existen en Drive pero no fueron cargados mediante las hojas `REGISTROS` y `FOTOS` de la app.

### Implementación

- La vista **Evidencias** une las escuelas de la extracción RUE con las escuelas devueltas por el backend autenticado.
- Las escuelas que solo tienen archivo histórico se muestran como **Sin ficha RUE extraída** y no alteran los indicadores de avance, tiempos ni estados RUE.
- Se agregó soporte visual para PDF con miniatura, apertura autenticada, visor y descarga.
- Los filtros de texto, departamento y distrito incluyen también las escuelas con evidencia histórica cuando se consulta esa vista.
- El aviso de sincronización informa la cobertura real del archivo: escuelas, imágenes y PDF disponibles para la sesión.
- La instantánea pública incorpora únicamente totales sanitizados: 86 escuelas piloto, 29 con evidencia histórica visible, 19 de ellas con ficha RUE extraída y 104 archivos representables en web.
- Se incrementó frontend y caché PWA a `1.1.0`; el exportador usa esquema `2026-08-22.2`.

### Validación

- Exportación y pruebas de datos: aprobadas.
- Validación estática y auditoría de privacidad: `PASS`; no se publicaron rutas locales, identificadores de carpetas ni enlaces privados.
- Playwright en escritorio y celular: 13 pruebas aprobadas y 1 omisión intencional por no aplicar al escritorio.
- Cobertura: filtros, mapa, escuela con ficha RUE, escuela solo con archivo histórico, imagen, PDF, accesibilidad y ausencia de desborde horizontal.
- `npm audit`: 0 vulnerabilidades.

### Publicación

- La URL operativa corresponde al repositorio existente `censoescuelaspy/seguimiento_registros`.
- Commit funcional `10b0888` publicado en `main`; workflows `32588055529` y `32588054491` terminados con exito.
- URL publica verificada en `1.1.0`: escuela disponible solo en el archivo historico visible, visor PDF operativo y 0 errores de consola en el smoke test.
- La instantanea publicada confirma 86 escuelas piloto, 29 con medios y 104 evidencias historicas representables en web.
- El cambio de nombre solicitado a `seguimiento_relevamiento` requiere permisos de propietario sobre la organización y no forma parte de la relación de evidencias.

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
