# CIALPA Seguimiento del relevamiento

Tablero web instalable para consultar el avance de infraestructura escolar, explorar escuelas en el mapa, revisar tiempos observados y estimar el esfuerzo restante. Los registros fotográficos se consultan mediante el backend autenticado de **CIALPA Fotos** y nunca se copian al repositorio público.

## Estado del corte

- Fuente analítica: `CIALPA_RUE_FOTOS.duckdb`.
- Corte de la instantánea: 2026-10-17.
- Muestra: 85 sedes físicas y 86 códigos MEC; una sede agrupa dos códigos.
- Cobertura RUE del piloto: 86 de 86 códigos y 85 de 85 sedes. La extracción privada contiene 178 códigos distintos, incluidos 92 fuera de la muestra, separados de los indicadores del piloto.
- Avance: 69 sedes cerradas, 1 guardada y 15 pendientes.
- Frontend: HTML, CSS y JavaScript modular sin compilación.
- Mapas: Leaflet con OpenStreetMap y Esri World Imagery.
- Figuras: Chart.js.
- Documentos: PDF.js distribuido localmente, sin enviar los PDF privados a terceros.
- Autenticación y fotos: Google Apps Script de CIALPA Fotos.
- Publicación operativa actual: `https://censoescuelaspy.github.io/seguimiento_registros/`.

## Seguridad

El repositorio contiene una instantánea **sanitizada**: código MEC, nombre y ubicación institucional, estado, conteos y tiempos agregados. Excluye respuestas RUE, usuarios, cédulas, rutas de Drive, URL privadas, hashes de archivos y contenido fotográfico.

El login del frontend no protege archivos estáticos por sí solo. La protección real de fotos y registros corresponde al backend: cada solicitud lleva un token de sesión y Apps Script valida el alcance del usuario. Un administrador ve todo; un supervisor o encuestador ve únicamente lo permitido por su equipo.

La vista **Evidencias** combina las cargas nativas de CIALPA Fotos con el archivo histórico conciliado por código RUE. Incluye imágenes y PDF y conserva visibles todas las sedes de la muestra, aunque todavía no tengan una ficha en la extracción RUE disponible. El detalle presenta el árbol **bloque > piso > aula o espacio > fotos**, construido con los registros y con rótulos como `B1A1 Foto 3` leídos dentro de cada PDF. Las tarjetas visibles reciben miniaturas JPEG privadas en lotes de hasta 12; al pulsar una se descarga solo su recorte ampliado. El PDF completo se solicita únicamente mediante **Ver láminas**. Ningún archivo forma parte de la instantánea pública.

Desde la versión `1.2.0`, el tablero informa la conciliación foto por foto realizada en la base privada: cantidad procesada, códigos MEC visibles, ubicaciones visibles, relaciones confirmadas y casos por revisar. La instantánea pública recibe únicamente esos conteos; no contiene texto OCR, fecha y hora de captura, coordenadas impresas ni rutas de archivos.

## Planificación de tiempos

La vista **Tiempos** calcula el saldo del piloto y una proyección para los **5.448 códigos de local escolar** del padrón MEC corregido. Usa Q1, mediana y Q3 de las 57 sedes cerradas con duración positiva; las 12 cerradas sin tiempo positivo no se consideran trabajo instantáneo. Permite variar equipos y plazos; la meta nacional todavía no está deduplicada por sede física.

La versión 1.10.0 conserva el corte RUE/Drive 2026-10-17 y las 69 sedes cerradas. Con 6 horas productivas por equipo y día y 15% de contingencia, estima 125,5 horas-equipo para el saldo del piloto y 42.742,2 para el censo completo: 33 equipos para 220 jornadas. Es preliminar: no incorpora traslados, ruralidad, conectividad ni diferencias territoriales fuera de Capital/Central. El cambio frente a 1.9.0 responde a la exclusión de tiempos no medidos y al padrón corregido, no a una caída reciente de productividad.

**Matrícula y aulas** muestra el padrón nacional con búsqueda, departamento, distrito, solo piloto, orden por matrícula/aulas, paginación, ubicación y CSV de toda la selección. Tiene filtros independientes de los del seguimiento piloto. Conserva matrícula MEC (907.091), aulas estimadas por 54 casos piloto consistentes, aulas declaradas/cargadas RUE y origen de cada cifra. El modelo produce 35.007 aulas estimadas; la combinación de referencia para planificación suma 35.058. No son aulas censadas. La matrícula no se recalcula porque RUE no contiene matrícula observada comparable. Las coordenadas tienen corte documental 2026-10-18: 5.252 disponibles y 196 faltantes.

La sección **Almacenamiento y respaldo** usa las 29 escuelas con archivos vinculados: escenario central nacional de 100,5 GB primarios y 251,3 GB protegidos (dos copias y 25% de holgura), con 608,5 GB protegidos en estrés. Es una proyección de volumen, no una cuota de servidor verificada ni un saldo pendiente de subir.

## Desarrollo

```powershell
npm install
npm run vendor
python tools/export_dashboard.py --database "<base-privada>" --planning "<listado-privado-validado.json>"
npx playwright install chromium
npm run check
npm run serve
```

Abrir `http://127.0.0.1:4174/?demo=1` para la simulación local. El modo demo está señalado visualmente y no utiliza credenciales reales.

## Actualizar datos

```powershell
& "<directorio-privado>\ACTUALIZAR_BASE_MAESTRA.ps1"
python tools/export_dashboard.py --database "<directorio-privado>\CIALPA_RUE_FOTOS.duckdb" --planning "<listado-privado-validado.json>"
npm run check
```

El detalle está en [docs/ACTUALIZACION.md](docs/ACTUALIZACION.md). GitHub Actions no puede acceder a la unidad local `J:`; por eso la actualización de la instantánea se inicia desde el equipo autorizado y la publicación ocurre al hacer `push`.

## Operación de especialistas

Para dar acceso de solo consulta a un ingeniero, se crea una cuenta en CIALPA Fotos con rol **Supervisor** y se la vincula a los equipos que deba revisar. El tablero respeta exactamente ese alcance y permite filtrar evidencias por arquitectura, electricidad, sanitarios y daños o fallas.

Procedimiento completo: [docs/ACCESO_ESPECIALISTAS.md](docs/ACCESO_ESPECIALISTAS.md).
