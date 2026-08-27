# Bitácora

## 2026-08-26 - Muestra completa y cobertura RUE 1.6.0

### Objetivo

Corregir el universo del tablero y evitar que las 49 fichas RUE descargadas se interpreten como el total de escuelas asignadas.

### Diagnóstico

- El tablero anterior partía de `rue_instituciones` y por eso mostraba solo 49 códigos con extracción RUE.
- La muestra vigente contiene 86 códigos MEC agrupados en 85 sedes físicas; una sede comparte ubicación entre dos códigos.
- Las 49 fichas RUE corresponden a 48 sedes físicas, por lo que 37 sedes de la muestra todavía no poseen ficha descargada.

### Implementación

- El exportador parte ahora del catálogo completo, agrupa por `sitio_id` y combina estado, tiempos, infraestructura y medios de todos los códigos de cada sede.
- La interfaz separa sedes físicas, códigos MEC y cobertura RUE; incorpora el filtro **Cobertura RUE** y una señal específica para sedes sin ficha.
- El mapa presenta 85 marcadores y diferencia visualmente las 37 sedes sin extracción RUE.
- La búsqueda, la ficha, las evidencias y el CSV reconocen códigos múltiples y agregan correctamente los registros de una sede compartida.
- Las estimaciones se calculan sobre las 85 sedes pendientes, guardadas o cerradas y el control de equipos inicia en ocho equipos operativos.
- Se actualizó frontend, esquema público y caché PWA a `1.6.0`.

### Datos y seguridad

- Corte de base: 2026-08-23; instantánea regenerada el 2026-08-26.
- Resultado: 85 sedes, 86 códigos MEC, 49 códigos RUE en 48 sedes, 37 sedes sin ficha, 13 cerradas, 10 guardadas y 62 pendientes.
- `reports/privacy_audit.json`: `PASS`, sin rutas privadas, credenciales, enlaces de Drive, correos ni campos prohibidos.
- El procedimiento diario detallado quedó en el área privada de la base maestra y no se incorporó al repositorio público.

### Validación local

- Pruebas del exportador: 2 aprobadas, incluida sede compartida, cobertura parcial y sede sin ficha.
- Validación estática: `PASS` para 85 sedes, 86 códigos y versión `1.6.0`.
- Playwright en instalación temporal limpia: 13 pruebas aprobadas y 1 omisión intencional; escritorio y celular.
- Cobertura: KPI, filtros, 85 marcadores, 37 marcadores sin RUE, mapa satelital, sedes compartidas, tiempos, evidencias, PDF, accesibilidad y ausencia de desbordamiento móvil.
- Revisión visual de capturas de resumen, mapa y vista móvil: sin solapamientos ni controles truncados después del ajuste responsive.
- La copia local de `node_modules` en la unidad sincronizada tenía un `package.json` inválido; la aplicación se verificó con `npm ci` en una copia temporal limpia, sin modificar dependencias del proyecto.

### Publicación y estado

- Commit funcional `5759c03` publicado en `production/main` de `censoescuelaspy/seguimiento_registros`.
- Workflows `33024270557` y `33024269753`: finalizados correctamente, incluidas pruebas, artefacto y despliegue de GitHub Pages.
- Verificación pública con caché evitada: versión `1.6.0`, 85 sedes, 86 códigos MEC, 49 fichas RUE, 85 marcadores generales y 37 al filtrar **Sin ficha RUE**.
- Smoke test público en navegador nuevo: login de simulación, KPI, filtro y mapa operativos; cero errores de página y cero solicitudes fallidas.

## 2026-08-23 - Carga rápida de fotos PDF 1.5.0

### Objetivo

Reducir la espera de la galería sin publicar imágenes ni debilitar el control por escuela.

### Diagnóstico

- La interfaz descargaba el PDF completo y recién después recortaba cada tarjeta con PDF.js.
- Los 30 PDF ocupan 191,8 MB; el mayor alcanza 19,9 MB y podía requerir cerca de 90 solicitudes secuenciales antes de mostrar una foto.

### Implementación

- Se eliminó la descarga automática del PDF para construir miniaturas.
- `IntersectionObserver` solicita únicamente las tarjetas visibles y las agrupa por documento en lotes de hasta 12.
- Cada tarjeta usa `PREVIEW`; al ampliarla solicita un único `FULL` y conserva su URL temporal durante la sesión.
- **Ver láminas** mantiene el visor PDF.js y es la única acción que obtiene el original.
- La API demo registra llamadas para comprobar que ningún `getPhotoContent(..., original)` ocurre antes de esa acción.
- Se incrementó frontend y caché PWA a `1.5.0`.

### Datos y seguridad

- La base privada contiene 3.036 fotos PDF, 6.072 derivados JPEG y 3.110 imágenes lógicas incluyendo las 74 fotos directas.
- Apps Script valida sesión, escuela, documento e identificador de foto antes de leer un derivado.
- La instantánea pública conserva 49 escuelas y solo datos agregados; no incorpora rutas, hashes ni binarios.

### Validación local

- Exportación sanitizada y validación estática: `PASS`, versión `1.5.0`.
- Playwright: 13 pruebas aprobadas y 1 omisión intencional en escritorio y celular.
- Cobertura específica: lote de miniaturas, apertura `FULL`, ausencia de descarga PDF automática, visor original explícito, mapa, filtros, accesibilidad y responsive.

### Publicación y estado

- Commit funcional `ec0b6ee` publicado en `main` de `censoescuelaspy/seguimiento_registros`.
- Workflows `32662355714` y `32662355210`: finalizados correctamente, incluidas la validación estática, la suite Playwright y GitHub Pages.
- Backend estable publicado como Apps Script `@34`, versión `1.13.0` y esquema `2026-08-23.2`.
- Smoke test público en `1.5.0`: miniatura y ampliación individual visibles, dos solicitudes de derivados, cero solicitudes del PDF original y cero errores de página antes de pulsar **Ver láminas**.

## 2026-08-23 - Desglose fotográfico por bloque y espacio 1.4.0

### Objetivo

Mostrar para cada escuela el desglose de bloques, pisos, aulas y otros espacios, con las fotos que ya están rotuladas dentro de los reportes PDF históricos.

### Implementación

- El panel de escuela combina los registros directos y el índice PDF autenticado en un árbol **bloque > piso > espacio > fotos**.
- Cada tarjeta muestra el recorte de la foto, su número, rótulo, página y estado de conciliación RUE.
- Al pulsar un recorte, el visor abre exactamente esa zona de la página; el PDF completo permanece disponible para verificación.
- Las miniaturas se renderizan de forma diferida y por página para evitar cargar todo el documento visualmente de una vez.
- Los filtros de especialidad también se aplican a los rótulos recuperados de las fotos PDF.
- Se incrementó frontend y caché PWA a `1.4.0`.

### Datos y privacidad

- La base privada contiene 30 PDF, 3.036 fotos individualizadas y 666 combinaciones documento-bloque-piso-espacio.
- `assets/data/dashboard.json` mantiene únicamente el corte sanitizado de 49 escuelas y conteos agregados.
- `reports/privacy_audit.json`: `PASS`, sin rutas Windows, enlaces privados de Google, correos ni claves prohibidas.
- Las fotos, rótulos y recortes se solicitan al backend después del login y de validar el acceso a la escuela.

### Validación local

- Pruebas de datos y validación estática: aprobadas; versión `1.4.0` y 49 escuelas.
- Playwright en entorno limpio: 13 pruebas aprobadas y 1 omisión intencional, en escritorio y celular.
- Cobertura específica: jerarquía, cuatro recortes simulados, apertura enfocada, vista del PDF completo, carga diferida, filtros, accesibilidad y ausencia de desbordamiento móvil.
- Revisión visual de escritorio y celular: sin solapamientos ni texto fuera de sus controles.

### Publicación y estado

- Commit funcional `ac9dd24` publicado en `main` de `censoescuelaspy/seguimiento_registros`.
- Workflows `32637682255` y `32637681495` finalizados con `success`.
- Smoke test en GitHub Pages: versión `1.4.0`, 1 bloque, 2 espacios, 4 recortes y apertura enfocada en `Foto 1 - Aula 1`, sin errores de consola.
- Backend estable verificado en `1.12.0`, esquema `2026-08-23.1`, deployment `@33`; las consultas anónimas al índice privado reciben `AUTH_REQUIRED`.
- Estado operativo: frontend y backend publicados; queda pendiente solamente la conformidad del usuario dentro de una sesión autenticada real.

## 2026-08-22 - Galería de láminas fotográficas dentro de PDF 1.3.0

### Objetivo

Mostrar automáticamente las páginas con fotografías de cada reporte PDF histórico, en vez de presentar el documento como una sola evidencia sin vista previa navegable.

### Diagnóstico

- El archivo histórico contiene 30 PDF, 2.090 páginas y 6.293 referencias ráster incrustadas.
- La detección conservadora identifica 3.395 imágenes con tamaño y proporción compatibles con fotografías; una referencia ráster también puede ser un logo, ícono o elemento repetido y por eso no equivale necesariamente a una foto distinta.
- `Equipo5 Reporte_Escuela la Arboleda.pdf` tiene 66 páginas, 30 páginas con imágenes detectadas, 201 referencias ráster y 197 candidatas a fotografía.

### Implementación

- Se incorporó PDF.js local para renderizar dentro del navegador únicamente las láminas seleccionadas por el índice documental.
- El visor abre una cuadrícula diferida en escritorio y una columna legible en celular; cada página se puede ampliar y el PDF completo sigue disponible.
- El archivo se obtiene del backend después de validar la sesión, se representa mediante una URL temporal y no se publica ni se duplica en GitHub Pages.
- Los metadatos enviados al tablero contienen conteos y números de página, sin rutas locales, nombres de carpetas ni identificadores privados de Drive.
- Se incrementó frontend y caché PWA a `1.3.0`.

### Validación local

- Base maestra: actualización transaccional `PASS`, con 49 escuelas RUE, 149 archivos y 30 PDF indexados.
- Exportación sanitizada, auditoría de privacidad y validación estática: `PASS`.
- Playwright: 13 pruebas aprobadas y 1 omisión intencional en escritorio y celular.
- Se comprobaron la galería de dos páginas, renderizado no vacío, ampliación, mapa, filtros y ausencia de desbordamiento móvil.
- Prueba con el PDF real de La Arboleda: 66 páginas, 30 láminas creadas y primer canvas con contenido no vacío.

### Publicación y estado

- Commit funcional `8a038b5` publicado en `main` de `censoescuelaspy/seguimiento_registros`.
- Workflows `32608572406` y `32608571583`: finalizados con éxito.
- GitHub Pages verificado en `1.3.0`; PDF.js y su worker respondieron HTTP 200.
- Smoke test público: dos láminas renderizadas, canvas de 331 x 428 px con contenido y 0 errores de consola o página.
- Estado operativo: la galería abre automáticamente las láminas PDF autorizadas y conserva el enlace al documento completo.

## 2026-08-22 - Vistas previas automáticas de evidencias 1.2.1

### Objetivo

Eliminar el paso manual **Cargar vista previa** y mostrar cada miniatura protegida automáticamente al consultar las evidencias de una escuela.

### Implementación

- Las miniaturas se solicitan al backend autenticado cuando su tarjeta entra en pantalla; no se descargan todas las evidencias de la escuela al mismo tiempo.
- `IntersectionObserver` aplica carga diferida dentro del panel lateral y conserva una alternativa compatible para navegadores sin ese API.
- Las solicitudes simultáneas del mismo archivo se deduplican y las URL temporales permanecen solo durante la sesión autenticada.
- Un error de red queda contenido en la tarjeta y ofrece **Reintentar**, sin cerrar el panel ni impedir consultar las demás evidencias.
- Los originales mantienen el flujo protegido **Abrir imagen** o **Abrir PDF**.

### Validación local

- Sintaxis JavaScript y Python: aprobada.
- Exportación sanitizada y auditoría de privacidad: `PASS`.
- Pruebas de datos: 2/2 aprobadas.
- Playwright en escritorio y celular: 13 pruebas aprobadas y 1 omisión intencional.
- Cobertura específica: miniatura de imagen y miniatura de PDF visibles sin clic previo, ausencia del botón **Cargar vista previa**, apertura de originales y captura visual de la galería.

### Publicación

- Commit funcional `90cf5d0` publicado en `main` de `censoescuelaspy/seguimiento_registros`.
- Workflows `32606420630` y `32606420268`: finalizados con éxito, incluidas las pruebas Playwright y la publicación en GitHub Pages.
- URL pública verificada en `1.2.1`: la miniatura apareció automáticamente, se descargó como imagen válida de 750 x 471 px y no existe el botón **Cargar vista previa**.
- Smoke test público: 0 errores de consola o de página; el backend protegido respondió `ok: true` al control de salud.

## 2026-08-22 - Conciliación OCR de fotografías con RUE 1.2.0

### Objetivo

Relacionar cada fotografía histórica con su escuela RUE mediante los rótulos visibles de código MEC y coordenadas, sin modificar las imágenes originales ni publicar datos OCR, fechas o coordenadas visibles.

### Implementación

- La base maestra incorpora OCR local reproducible con RapidOCR y caché por hash de archivo, motor y versión del proceso.
- La conciliación prioriza el código MEC exacto, usa la distancia entre las coordenadas visibles y las coordenadas RUE como validación espacial, y conserva como respaldo el mapeo controlado por carpeta.
- Los códigos conocidos en conflicto nunca reemplazan automáticamente el vínculo controlado: quedan destinados a revisión.
- DuckDB incorpora tablas y vistas de OCR, vínculos foto-RUE y casos para revisión; el Excel resumen agrega las hojas `OCR_FOTOS`, `VINCULOS_FOTO_RUE` y `OCR_REVISION`.
- La instantánea pública expone solo totales sanitizados por escuela y agregados. No contiene texto OCR, fechas impresas, coordenadas detectadas, rutas locales ni identificadores privados.
- El tablero muestra fotos conciliadas con RUE, pendientes de revisión y conflictos en la vista Evidencias y en el detalle de cada escuela.
- Se incrementó frontend y caché PWA a `1.2.0`; el exportador usa el esquema `2026-08-22.3`.

### Resultado verificado

- 74 fotografías directas procesadas y 74 relaciones foto-RUE confirmadas.
- 73 fotografías con código MEC visible y 69 con coordenadas visibles.
- 69 vínculos confirmados por código y coordenadas, 4 por código y 1 por mapeo controlado porque la imagen no contiene rótulo visible.
- 0 errores OCR, 0 conflictos y 0 casos pendientes de revisión.
- Distancia máxima entre coordenada impresa y coordenada RUE: 40,09 m.
- El código detectado en esta colección es `0012110`, correspondiente a la escuela vinculada por el inventario controlado.

### Validación local

- Compilación de los tres módulos Python: aprobada.
- Reconstrucción completa de DuckDB, Excel y manifiesto: `PASS`.
- Segunda ejecución con caché: 74 OCR y 30 PDF reutilizados; 0 reprocesamientos y 0 errores.
- Validador independiente de OCR y vínculos: `PASS`.
- Pruebas de datos: 2/2 aprobadas.
- Validación estática y auditoría de privacidad: `PASS`, versión `1.2.0` y 49 escuelas.
- Playwright en entorno limpio: 13 pruebas aprobadas y 1 omisión intencional, con cobertura de escritorio y móvil.
- El `node_modules` de la carpeta sincronizada contenía un ejecutable vacío preexistente; las pruebas se ejecutaron sobre una instalación limpia con `npm ci` fuera de Drive.

### Publicación

- Commit funcional `968248f` publicado en `main` del repositorio operativo `censoescuelaspy/seguimiento_registros`.
- Workflows `32605640049` y `32605639322`: finalizados con éxito; incluyeron pruebas de datos, validación estática, Playwright y despliegue en GitHub Pages.
- URL pública verificada en `1.2.0` y esquema `2026-08-22.3`: 74 fotos OCR, 73 códigos, 69 ubicaciones, 74 vínculos confirmados, 0 revisiones y 0 conflictos.
- Smoke test público en modo de simulación: vista Evidencias renderizada en escritorio, versión visible correcta y 0 errores de consola o de página.
- GitHub Actions emitió una advertencia no bloqueante por la transición interna de acciones basadas en Node.js 20 a Node.js 24; la ejecución y publicación finalizaron correctamente.

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
