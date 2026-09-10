/* ============================================================================
   ai.js — extracción inteligente de eventos con la API de Claude (Anthropic).

   A diferencia de parser.js (reglas/regex, un único evento por mensaje), este
   módulo le pasa el CORREO COMPLETO (texto + adjuntos jpg/pdf como imágenes)
   a Claude y le pide que decida:
     - a qué hijo/alumno se refiere el mensaje,
     - cuántos eventos de calendario hay realmente (un correo largo puede
       mencionar varias actividades con fechas distintas),
     - fecha/hora/cadencia y urgencia de cada uno.

   Se llama directamente desde el navegador (sin backend propio), usando el
   header que la API de Anthropic exige para peticiones que no pasan por un
   servidor: 'anthropic-dangerous-direct-browser-access'. La clave se guarda
   en chrome.storage.sync y solo sale de tu navegador hacia api.anthropic.com.
   ========================================================================== */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

const EXTRACT_TOOL = {
  name: 'extract_events',
  description: 'Extrae del correo escolar el alumno/hijo al que se refiere y la lista de eventos de calendario relevantes (citas, plazos, pagos, actividades recurrentes) que contiene, con su fecha, hora, cadencia y la urgencia del aviso.',
  input_schema: {
    type: 'object',
    properties: {
      child: {
        type: ['string', 'null'],
        description: "Nombre del alumno/hijo al que se refiere el mensaje (p.ej. del campo 'Sobre el hijo'). null si es un aviso general o no se puede determinar."
      },
      events: {
        type: 'array',
        description: 'Un elemento por cada actividad/plazo distinto y accionable mencionado en el correo. Si el correo es una circular sin ninguna fecha/plazo real, devuelve una lista vacía.',
        items: {
          type: 'object',
          properties: {
            title: {type: 'string', description: 'Título corto y claro del evento (máx. 80 caracteres), en español.'},
            date: {type: 'string', description: 'Fecha ISO yyyy-mm-dd de la primera/próxima ocurrencia, resuelta a partir de la fecha de referencia dada.'},
            time: {type: ['string', 'null'], description: "Hora en formato 24h 'HH:MM' si el evento tiene una hora concreta; null si es todo el día o no se especifica."},
            recurrence: {type: ['string', 'null'], description: "Regla RRULE (p.ej. 'RRULE:FREQ=WEEKLY;BYDAY=SA') si el evento se repite; null si es puntual."},
            reminder_minutes: {
              type: 'array', items: {type: 'integer'},
              description: 'Minutos de antelación para los recordatorios, según la importancia/urgencia: una cita puntual con hora ~ [60,1440]; un plazo o pago ~ [1440,2880]; un evento recurrente ~ [60] o [1440].'
            },
            confidence: {type: 'string', enum: ['alta', 'media', 'baja']},
            quote: {type: 'string', description: 'Frase textual (o muy próxima) del correo en la que se basa este evento, para que la persona pueda verificarlo de un vistazo.'}
          },
          required: ['title', 'date', 'reminder_minutes', 'confidence', 'quote']
        }
      }
    },
    required: ['events']
  }
};

const SYSTEM_PROMPT = `Eres un asistente que ayuda a un padre/madre a convertir los correos de la
plataforma de comunicación de un colegio (esemtia Connect) en eventos de
Google Calendar. Analiza el correo completo (y las imágenes/PDF adjuntos, si
los hay) y llama SIEMPRE a la herramienta "extract_events" con tu resultado.

Reglas importantes:
- Un correo puede mencionar varias actividades distintas (p.ej. misas
  semanales, recogida de alimentos, una reunión puntual, un plazo de pago).
  Crea UN evento por cada actividad con fecha/plazo real y accionable.
  Ignora menciones de fechas pasadas, anécdotas o ejemplos sin relevancia
  para el calendario (p.ej. "la visita del Papa el pasado mes de junio").
- Si el correo es solo un saludo/agradecimiento sin ninguna fecha o plazo
  real, devuelve events: [] (lista vacía) — no inventes eventos.
- Resuelve fechas relativas ("el próximo viernes", "este sábado") usando la
  fecha de referencia proporcionada.
- Si varios adjuntos contienen información relevante (horarios, circulares
  en imagen o PDF), inclúyela también en los eventos.`;

/**
 * @param {Object} opts
 * @param {string} opts.apiKey
 * @param {string} opts.model
 * @param {string} opts.text            Texto completo del correo (asunto + cuerpo).
 * @param {string} [opts.childHint]     Pista ya conocida de a qué hijo se refiere (p.ej. leída del DOM).
 * @param {{mimeType:string, base64:string, kind:'image'|'pdf', name?:string}[]} [opts.attachments]
 * @param {Date}   [opts.referenceDate]
 * @returns {Promise<{child:string|null, events:Array}>}
 */
export async function extractEventsWithAI({apiKey, model, text, childHint, attachments, referenceDate}){
  if(!apiKey) throw new Error('Falta la clave de la API de Claude (configúrala en Opciones).');
  const ref = referenceDate ? new Date(referenceDate) : new Date();
  const refIso = ref.toISOString().slice(0,10);

  const content = [];
  for(const att of (attachments||[]).slice(0,6)){
    if(att.kind==='image'){
      content.push({type:'image', source:{type:'base64', media_type: att.mimeType, data: att.base64}});
    } else if(att.kind==='pdf'){
      content.push({type:'document', source:{type:'base64', media_type:'application/pdf', data: att.base64}});
    }
  }
  content.push({
    type:'text',
    text: `Fecha de referencia ("hoy"): ${refIso}.\n` +
      (childHint ? `Pista de a qué hijo se refiere (verifícala en el texto): ${childHint}\n` : '') +
      `\n--- CORREO ---\n${text}`
  });

  const body = {
    model: model || 'claude-sonnet-5',
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    tools: [EXTRACT_TOOL],
    tool_choice: {type:'tool', name:'extract_events'},
    messages: [{role:'user', content}]
  };

  const res = await fetch(ANTHROPIC_URL, {
    method:'POST',
    headers: {
      'content-type':'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-dangerous-direct-browser-access':'true'
    },
    body: JSON.stringify(body)
  });

  if(!res.ok){
    const errText = await res.text().catch(()=> '');
    throw new Error(`Claude API ${res.status}: ${errText.slice(0,300)}`);
  }
  const data = await res.json();
  const toolUse = (data.content||[]).find(b=>b.type==='tool_use' && b.name==='extract_events');
  if(!toolUse) throw new Error('Claude no devolvió una extracción estructurada (respuesta inesperada).');

  const input = toolUse.input || {};
  const events = (input.events||[]).map(e => normalizeEvent(e));
  return {child: input.child || null, events};
}

function normalizeEvent(e){
  const time = e.time ? parseHHMM(e.time) : null;
  return {
    title: String(e.title||'').slice(0,120),
    date: e.date,
    time,
    allDay: !time,
    recurrence: e.recurrence ? [e.recurrence] : [],
    reminders: (Array.isArray(e.reminder_minutes) && e.reminder_minutes.length ? e.reminder_minutes : [1440])
      .map(minutes=>({method:'popup', minutes})),
    confidence: e.confidence==='alta' ? 'high' : e.confidence==='media' ? 'medium' : 'low',
    matchedText: e.quote || ''
  };
}
function parseHHMM(s){
  const m = String(s).match(/^(\d{1,2}):(\d{2})$/);
  if(!m) return null;
  const h=+m[1], min=+m[2];
  if(h>23||min>59) return null;
  return {h,min};
}
