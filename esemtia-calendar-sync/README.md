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

5. **(Recomendado) Activar la lectura inteligente con IA** (Opciones,
   sección 4): crea una clave gratuita en
   [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys)
   y pégala ahí. Sin esto, la extensión sigue funcionando con reglas simples
   (una fecha por mensaje, sin leer adjuntos); con ella, lee el **correo
   completo** (incluidas imágenes y PDF adjuntos), identifica **a qué
   hijo/alumno** se refiere y puede proponer **varios eventos** si el correo
   menciona varias actividades distintas.

## Uso del día a día

1. Abre esemtia Connect y **selecciona con el ratón** un fragmento del
   mensaje (basta con una palabra del asunto o del cuerpo: la extensión sube
   automáticamente hasta el contenedor del mensaje completo, no solo lo
   seleccionado).
2. Aparece un botón flotante **"📅 Sincronizar con Calendar"** junto a la
   selección — púlsalo. Recoge el texto completo del correo y, si hay,
   sus imágenes/PDF adjuntos.
3. Se abre el popup de la extensión y analiza el mensaje (con IA si la
   configuraste, si no con las reglas locales) mostrando:
   - A qué hijo/alumno se refiere, si se ha podido determinar.
   - Una tarjeta por cada evento detectado (puede haber varios si el correo
     menciona varias actividades), con la frase del correo en la que se basa
     cada uno, y todo editable: título, fecha, hora, recordatorio, repetición.
   - Una casilla por evento para elegir cuáles guardar.
4. Pulsa **"Guardar seleccionados en Google Calendar"**. Si vuelves a
   sincronizar el mismo mensaje (por ejemplo tras corregir algo), la
   extensión **actualiza** los eventos existentes en vez de duplicarlos.

También puedes abrir el icono de la extensión directamente y **pegar el
texto a mano** (por si el mensaje llega por otro medio, o el botón flotante
no aparece en alguna vista concreta de esemtia).

### Menú contextual

Si seleccionas texto en *cualquier* página (no solo en el dominio autorizado)
puedes usar clic derecho → **"Crear evento en Google Calendar desde esta
selección"**. Es el mismo flujo, sin depender del content script.

### Escaneo automático de la bandeja (opcional)

Si averiguas los selectores CSS que usa esemtia para listar los mensajes,
puedes rellenarlos en Opciones (sección 5) y la extensión mostrará un aviso
flotante con el número de mensajes detectados en la página, para revisarlos
en bloque desde el popup. Es opcional y "a mejor esfuerzo": si esemtia
cambia su HTML, deja de detectar hasta que ajustes los selectores. El botón
flotante al seleccionar texto (arriba) siempre funciona, cambie lo que
cambie esa lista.

## Cómo se decide la alerta

### Con IA (Claude), si configuraste tu clave en Opciones

El correo completo (texto + imágenes/PDF adjuntos) se envía a la API de
Claude, que decide: a qué hijo/alumno se refiere, cuántos eventos
accionables contiene (un correo largo puede mencionar varias actividades
distintas — misas semanales, un plazo de pago, una reunión puntual — y cada
una se convierte en un evento independiente) y qué recordatorio corresponde
a cada uno según su urgencia. Cada evento propuesto muestra la frase del
correo en la que se basa, para que lo puedas verificar antes de guardar. La
lógica de la llamada está en [`src/ai.js`](src/ai.js).

Coste y privacidad: cada análisis es una llamada a la API de Claude, con
cargo a tu propia cuenta de Anthropic (no a Anthropic ni a esta extensión).
El texto del correo y sus adjuntos se envían directamente desde tu
navegador a `api.anthropic.com` — a nadie más. Si la llamada falla (clave
incorrecta, sin conexión…), la extensión cae automáticamente a las reglas
locales de abajo, avisando en el popup.

### Reglas locales (respaldo automático, sin IA ni coste)

Si no hay clave de IA configurada (o la llamada falla), el texto se analiza
con un motor de patrones en español, buscando por orden de prioridad:

| Patrón detectado | Ejemplo | Tipo de evento | Recordatorios |
|---|---|---|---|
| Cadencia recurrente | "cada semana", "todos los lunes", "mensual", "cada 2 semanas" | Evento recurrente (`RRULE`) | 1h antes si hay hora, si no 1 día antes |
| Plazo / fecha límite | "antes del 20/09", "fecha límite: …", "antes de que acabe la semana" | Evento único en la fecha límite | 1 y 2 días antes (+1h si hay hora) |
| Fecha explícita | "15 de octubre", "20/09/2026", "el viernes" | Evento único | 1 día antes (+1h si hay hora) |
| Relativo | "mañana", "en 3 días", "hoy" | Evento único | 1 día antes (+1h si hay hora) |
| Nada de lo anterior | — | Se avisa en el popup para que pongas la fecha a mano | — |

A diferencia de la IA, este motor solo produce **un evento por mensaje** y
no lee adjuntos ni decide a qué hijo se refiere. La lógica completa está en
[`src/parser.js`](src/parser.js) y tiene sus propios tests
(`test/parser.test.mjs`, ejecutables con `node --test test/parser.test.mjs`)
— es el sitio para ajustar reglas si esemtia usa fraseos distintos a los
previstos.

## Privacidad y alcance

- La extensión **no tiene backend propio**: solo habla con
  `accounts.google.com` / `www.googleapis.com` (Calendar API) y, si activas
  la IA, con `api.anthropic.com` (Claude) — nunca con un servidor propio.
- El texto del mensaje (y, si usas IA, sus adjuntos) se guarda como
  **descripción del evento** en tu propio calendario de Google — en ningún
  otro sitio salvo, de forma transitoria, la llamada a Claude para analizarlo.
- El scope de OAuth pedido es el mínimo necesario:
  `https://www.googleapis.com/auth/calendar.events` (crear/editar eventos,
  no borrar todo el calendario ni leer el resto de tu agenda).
- La detección de duplicados usa un hash del texto (+ un índice, si un mismo
  correo produce varios eventos) guardado en `extendedProperties.private`
  del propio evento de Google (y en `chrome.storage.local` como caché), así
  reenviar el mismo mensaje actualiza sus eventos en lugar de duplicarlos.
- La captura de adjuntos tiene límites de seguridad: máximo 6 archivos por
  mensaje y 6 MB por archivo (se ignoran los que excedan esto), para no
  disparar el coste ni el tamaño de la petición.

## Estructura del proyecto

```
esemtia-calendar-sync/
├── manifest.json        Manifest V3
├── src/
│   ├── background.js    Service worker: OAuth, Calendar API, orquesta IA/reglas, mensajería
│   ├── ai.js              Extracción con la API de Claude (texto + imágenes/PDF → eventos)
│   ├── content.js        Se inyecta en el dominio de esemtia autorizado: botón flotante + escaneo opcional
│   ├── parser.js          Motor de reglas de respaldo (puro, sin Chrome/DOM, sin IA)
│   ├── popup.html/js      Revisión de los eventos propuestos y confirmación antes de guardar
│   └── options.html/js    Configuración: OAuth, calendario, dominio de esemtia, IA, selectores
├── icons/                 Iconos de la extensión
├── scripts/gen_icons.py   Generador de los iconos (sin dependencias)
└── test/parser.test.mjs   Tests del motor de reglas de respaldo (`node --test`)
```
