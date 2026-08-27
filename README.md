# CIALPA Seguimiento del relevamiento

Tablero web instalable para consultar el avance de infraestructura escolar, explorar escuelas en el mapa, revisar tiempos observados y estimar el esfuerzo restante. Los registros fotográficos se consultan mediante el backend autenticado de **CIALPA Fotos** y nunca se copian al repositorio público.

## Estado del corte

- Fuente analítica: `CIALPA_RUE_FOTOS.duckdb`.
- Corte publicado: 2026-08-27.
- Muestra: 85 sedes físicas y 86 códigos MEC; una sede agrupa dos códigos.
- Cobertura RUE del piloto: 86 de 86 códigos y 85 de 85 sedes. La extracción privada contiene además 2 fichas fuera de la muestra, separadas de los indicadores del piloto.
- Avance: 27 sedes cerradas, 9 guardadas y 49 pendientes.
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

La vista **Tiempos** calcula el saldo del piloto y una proyección para 5.000 escuelas mediante tres escenarios basados en el Q1, la mediana y el Q3 de las escuelas cerradas. Permite variar los equipos disponibles, el plazo del piloto y el plazo nacional; para cada combinación informa días efectivos y equipos mínimos.

El corte 2026-08-27 usa 27 escuelas cerradas, 6 horas productivas por equipo y día y 15% de contingencia. En el escenario central estima 346,4 horas-equipo para completar el piloto y 34.204,8 horas-equipo para 5.000 escuelas. La proyección nacional es preliminar: todavía no incorpora traslados, ruralidad, conectividad ni diferencias territoriales fuera de Capital y Central.

## Desarrollo

```powershell
npm install
npm run vendor
python tools/export_dashboard.py
npx playwright install chromium
npm run check
npm run serve
```

Abrir `http://127.0.0.1:4174/?demo=1` para la simulación local. El modo demo está señalado visualmente y no utiliza credenciales reales.

## Actualizar datos

```powershell
& "<directorio-privado>\ACTUALIZAR_BASE_MAESTRA.ps1"
python tools/export_dashboard.py --database "<directorio-privado>\CIALPA_RUE_FOTOS.duckdb"
npm run check
```

El detalle está en [docs/ACTUALIZACION.md](docs/ACTUALIZACION.md). GitHub Actions no puede acceder a la unidad local `J:`; por eso la actualización de la instantánea se inicia desde el equipo autorizado y la publicación ocurre al hacer `push`.

## Operación de especialistas

Para dar acceso de solo consulta a un ingeniero, se crea una cuenta en CIALPA Fotos con rol **Supervisor** y se la vincula a los equipos que deba revisar. El tablero respeta exactamente ese alcance y permite filtrar evidencias por arquitectura, electricidad, sanitarios y daños o fallas.

Procedimiento completo: [docs/ACCESO_ESPECIALISTAS.md](docs/ACCESO_ESPECIALISTAS.md).
