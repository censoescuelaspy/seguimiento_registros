# Acceso para especialistas

El tablero es de solo consulta. No ofrece acciones para modificar escuelas, formularios, usuarios ni fotografías.

## Alta recomendada

1. El administrador abre **CIALPA Fotos > Encuestadores**.
2. Crea la cuenta del profesional con rol **Supervisor**.
3. En **Equipos**, lo asigna como coordinador o miembro de los equipos que deba revisar.
4. El profesional ingresa al tablero con su usuario y contraseña de CIALPA Fotos.
5. En **Evidencias**, filtra por Electricidad, Sanitarios y agua, Arquitectura o Daños y fallas.

Un administrador ve todos los registros. Un supervisor ve los registros de los equipos bajo su alcance. La restricción se aplica en Apps Script antes de devolver metadatos o contenido fotográfico; no depende de ocultar botones en el navegador.

## Revocación

Al desactivar la cuenta o quitarla del equipo en CIALPA Fotos, el backend deja de entregar sus evidencias. Las sesiones duran hasta 12 horas, pero una cuenta desactivada se rechaza en la siguiente solicitud.

