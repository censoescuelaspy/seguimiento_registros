# Seguridad y privacidad

## Información pública permitida

- Código MEC, nombre y ubicación de la institución.
- Estado agregado del relevamiento.
- Conteos de formularios, respuestas y medios.
- Fechas operativas y tiempos agregados por escuela.

## Información excluida

- Credenciales, tokens, sesiones, cookies o claves.
- Cédulas, nombres, teléfonos y desempeño individual de censistas.
- Respuestas detalladas del RUE.
- Rutas locales o compartidas, ID y URL de Drive, hashes de medios.
- Binarios, miniaturas o fotografías.

## Acceso a evidencias

El navegador solicita metadatos y contenido al backend de CIALPA Fotos. Apps Script valida el token y el alcance de cada registro antes de devolver fragmentos codificados. El tablero conserva la imagen solo en memoria y revoca su URL al cerrar el visor.

## Incidentes

Si una auditoría detecta un campo prohibido, no publicar. Retirar el artefacto de la rama, rotar cualquier secreto expuesto y documentar el incidente sin repetir el valor sensible.

