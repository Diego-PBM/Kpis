# esemtia Connect → Google Calendar

Extensión de Chrome (Manifest V3) que convierte los mensajes de **esemtia Connect**
en eventos de **Google Calendar**, con la alerta y la recurrencia decididas
automáticamente según el contenido del mensaje (fecha concreta, plazo o
cadencia recurrente). Todo corre en tu navegador: no hay servidor propio ni
se envía el texto del mensaje a nadie salvo a Google (al crear el evento).

## Por qué una extensión y no una app conectada por API

esemtia Connect no publica una API para automatizar la lectura de mensajes,
así que la forma fiable de "traer" un mensaje a la herramienta es que tú lo
selecciones en la propia página de esemtia. La extensión te pone un botón
flotante para hacerlo en dos clics, revisa lo que ha entendido y crea el
evento con la alerta correcta. Si en el futuro cambias de opinión y prefieres
otro origen de datos (reenvío por email, copiar/pegar manual…), el motor de
detección de fechas (`src/parser.js`) es independiente del resto y se puede
reutilizar tal cual.

## Instalación

1. **Cargar la extensión**
   - Chrome → `chrome://extensions` → activa "Modo de desarrollador" →
     "Cargar descomprimida" → selecciona esta carpeta (`esemtia-calendar-sync/`).

2. **Crear el acceso OAuth con Google (una sola vez, gratis)**
   - Ve a [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials)
     y crea (o reutiliza) un proyecto.
   - "APIs y servicios → Biblioteca" → habilita **Google Calendar API**.
   - "Pantalla de consentimiento OAuth" → tipo *Externo* → añádete a ti mismo
     como *usuario de prueba* (no hace falta publicar la app).
   - "Credenciales → Crear credenciales → ID de cliente de OAuth" → tipo
     **Aplicación web**.
   - Abre la página de **Opciones** de la extensión (icono de la extensión →
     ⚙ o clic derecho → Opciones): ahí verás el *URI de redirección* exacto
     que debes pegar en "URI de redirección autorizados" del cliente OAuth.
   - Copia el **Client ID** (termina en `.apps.googleusercontent.com`) y
     pégalo en la sección 1 de Opciones. Pulsa "Guardar" y luego
     "Probar autenticación" para confirmar que todo funciona.

3. **Elegir el calendario de destino** (Opciones, sección 2). Por defecto se
   usa tu calendario principal.

4. **Autorizar el dominio de esemtia Connect** (Opciones, sección 3): pega la
   URL con comodín, por ejemplo `https://connect.esemtia.com/*`, y pulsa
   "Conceder acceso a este sitio". Recarga la pestaña de esemtia después.

## Uso del día a día

1. Abre esemtia Connect y **selecciona con el ratón** el texto del mensaje
   (asunto + cuerpo, o solo la parte relevante).
2. Aparece un botón flotante **"📅 Sincronizar con Calendar"** junto a la
   selección — púlsalo.
3. Se abre el popup de la extensión con:
   - El texto pegado.
   - La fecha, hora, recurrencia y recordatorio que se han detectado
     automáticamente, con la frase que lo disparó (p. ej. *"detecté: 'cada
     lunes'"*).
   - Todo editable antes de guardar (título, fecha, hora, calendario,
     recordatorio, repetición).
4. Pulsa **"Guardar en Google Calendar"**. Si vuelves a sincronizar el mismo
   mensaje (por ejemplo tras corregir algo), la extensión **actualiza** el
   evento existente en vez de duplicarlo.

También puedes abrir el icono de la extensión directamente y **pegar el
texto a mano** (por si el mensaje llega por otro medio, o el botón flotante
no aparece en alguna vista concreta de esemtia).

### Menú contextual

Si seleccionas texto en *cualquier* página (no solo en el dominio autorizado)
puedes usar clic derecho → **"Crear evento en Google Calendar desde esta
selección"**. Es el mismo flujo, sin depender del content script.

### Escaneo automático de la bandeja (opcional)

Si averiguas los selectores CSS que usa esemtia para listar los mensajes,
puedes rellenarlos en Opciones (sección 4) y la extensión mostrará un aviso
flotante con el número de mensajes detectados en la página, para revisarlos
en bloque desde el popup. Es opcional y "a mejor esfuerzo": si esemtia
cambia su HTML, deja de detectar hasta que ajustes los selectores. El botón
flotante al seleccionar texto (arriba) siempre funciona, cambie lo que
cambie esa lista.

## Cómo se decide la alerta (motor de reglas)

El texto se analiza en español buscando, por orden de prioridad:

| Patrón detectado | Ejemplo | Tipo de evento | Recordatorios |
|---|---|---|---|
| Cadencia recurrente | "cada semana", "todos los lunes", "mensual", "cada 2 semanas" | Evento recurrente (`RRULE`) | 1h antes si hay hora, si no 1 día antes |
| Plazo / fecha límite | "antes del 20/09", "fecha límite: …", "antes de que acabe la semana" | Evento único en la fecha límite | 1 y 2 días antes (+1h si hay hora) |
| Fecha explícita | "15 de octubre", "20/09/2026", "el viernes" | Evento único | 1 día antes (+1h si hay hora) |
| Relativo | "mañana", "en 3 días", "hoy" | Evento único | 1 día antes (+1h si hay hora) |
| Nada de lo anterior | — | Se avisa en el popup para que pongas la fecha a mano | — |

La lógica completa está en [`src/parser.js`](src/parser.js) y tiene sus
propios tests (`test/parser.test.mjs`, ejecutables con
`node --test test/parser.test.mjs`) — es el sitio para ajustar reglas si
esemtia usa fraseos distintos a los previstos.

## Privacidad y alcance

- La extensión **no tiene backend propio**: solo habla con
  `accounts.google.com` (login) y `www.googleapis.com` (Calendar API).
- El texto del mensaje se guarda como **descripción del evento** en tu
  propio calendario de Google — en ningún otro sitio.
- El scope de OAuth pedido es el mínimo necesario:
  `https://www.googleapis.com/auth/calendar.events` (crear/editar eventos,
  no borrar todo el calendario ni leer el resto de tu agenda).
- La detección de duplicados usa un hash del texto guardado en
  `extendedProperties.private` del propio evento de Google (y en
  `chrome.storage.local` como caché), así reenviar el mismo mensaje
  actualiza el evento en lugar de crear uno nuevo.

## Estructura del proyecto

```
esemtia-calendar-sync/
├── manifest.json        Manifest V3
├── src/
│   ├── background.js    Service worker: OAuth, llamadas a Calendar API, mensajería
│   ├── content.js        Se inyecta en el dominio de esemtia autorizado: botón flotante + escaneo opcional
│   ├── parser.js          Motor de detección de fecha/cadencia/plazo (puro, sin Chrome/DOM)
│   ├── popup.html/js      Revisión y confirmación antes de guardar en Calendar
│   └── options.html/js    Configuración: OAuth, calendario, dominio de esemtia, selectores
├── icons/                 Iconos de la extensión
├── scripts/gen_icons.py   Generador de los iconos (sin dependencias)
└── test/parser.test.mjs   Tests del motor de reglas (`node --test`)
```
