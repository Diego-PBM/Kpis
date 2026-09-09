/* ============================================================================
   parser.js — detecta fecha / cadencia / plazo en el TEXTO de un mensaje
   (pensado para mensajes de esemtia Connect: reuniones, pagos, entregas,
   avisos recurrentes...) y propone una alerta de Google Calendar razonable.

   Módulo puro, sin dependencias del DOM ni de Chrome: se puede probar con
   `node --test test/parser.test.mjs` y se importa igual desde el content
   script, el background y el popup.
   ========================================================================== */

export const WEEKDAYS = ['domingo','lunes','martes','miercoles','jueves','viernes','sabado'];
const WEEKDAY_ALIASES = {
  domingo:0, lunes:1, martes:2, miercoles:3, 'miércoles':3, jueves:4, viernes:5,
  sabado:6, 'sábado':6
};
const MONTHS = {
  enero:1, febrero:2, marzo:3, abril:4, mayo:5, junio:6, julio:7, agosto:8,
  septiembre:9, setiembre:9, octubre:10, noviembre:11, diciembre:12,
  ene:1, feb:2, mar:3, abr:4, may:5, jun:6, jul:7, ago:8, sep:9, set:9, oct:10, nov:11, dic:12
};
const BYDAY = {domingo:'SU',lunes:'MO',martes:'TU',miercoles:'WE',jueves:'TH',viernes:'FR',sabado:'SA'};

const stripAccents = s => String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'');
const norm = s => stripAccents(String(s||'')).toLowerCase();

function pad(n){ return String(n).padStart(2,'0'); }
function toISODate(d){ return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function addDays(d,n){ const r=new Date(d); r.setDate(r.getDate()+n); return r; }
function startOfDay(d){ const r=new Date(d); r.setHours(0,0,0,0); return r; }
function lastDayOfMonth(d){ return new Date(d.getFullYear(), d.getMonth()+1, 0); }
function nextWeekday(from, targetDow, {allowToday=false}={}){
  const cur = from.getDay();
  let diff = (targetDow - cur + 7) % 7;
  if(diff===0 && !allowToday) diff = 7;
  return addDays(from, diff);
}

/* ---------- hora del día ("a las 17:00", "17h", "17:30h") ---------------- */
function extractTime(text){
  let m = text.match(/\ba\s+las?\s+(\d{1,2})(?:[:.](\d{2}))?\s*(h|hrs?|horas)?\b/i);
  if(!m) m = text.match(/\b(\d{1,2})[:.](\d{2})\s*h?\b/);
  if(!m) return null;
  let h = +m[1], min = m[2]?+m[2]:0;
  if(h>23||min>59) return null;
  return {h,min, matched:m[0]};
}

/* ---------- fechas explícitas -------------------------------------------- */
function explicitDate(text, ref){
  // dd/mm/yyyy | dd-mm-yyyy | dd/mm
  let m = text.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
  if(m){
    const day=+m[1], mon=+m[2]; let year = m[3]? (+m[3]<100?2000+ +m[3]:+m[3]) : ref.getFullYear();
    if(mon>=1&&mon<=12&&day>=1&&day<=31){
      let d = new Date(year, mon-1, day);
      if(!m[3] && startOfDay(d) < startOfDay(ref)) d = new Date(year+1, mon-1, day);
      if(d.getMonth()===mon-1) return {date:d, matched:m[0]};
    }
  }
  // "15 de octubre (de 2026)?" / "15 octubre" / "15 oct"
  m = text.match(/\b(\d{1,2})\s*(?:de\s+)?([a-zA-Zñáéíóú]+)(?:\s+de\s+(\d{4}))?\b/i);
  if(m){
    const mon = MONTHS[norm(m[2])];
    if(mon){
      const day=+m[1]; let year = m[3]?+m[3]:ref.getFullYear();
      let d = new Date(year, mon-1, day);
      if(d.getDate()===day && d.getMonth()===mon-1){
        if(!m[3] && startOfDay(d) < startOfDay(ref)) d = new Date(year+1, mon-1, day);
        return {date:d, matched:m[0]};
      }
    }
  }
  return null;
}

/* ---------- construye el resultado de recordatorios ---------------------- */
function reminders(list){ return list.map(minutes=>({method:'popup', minutes})); }

const TIER = {NONE:0, RELATIVE:1, EXPLICIT:2, DEADLINE:3, RECURRING:4};

/**
 * @param {string} rawText  Texto del mensaje (asunto + cuerpo)
 * @param {Object} [opts]
 * @param {Date}   [opts.referenceDate]  "Hoy" para resolver fechas relativas
 * @returns {{
 *   kind:'recurring'|'deadline'|'single'|'none',
 *   date:string|null,           // ISO yyyy-mm-dd de la primera ocurrencia
 *   time:{h:number,min:number}|null,
 *   allDay:boolean,
 *   recurrence:string[],        // ["RRULE:..."] si aplica
 *   reminders:{method:string,minutes:number}[],
 *   confidence:'high'|'medium'|'low',
 *   matchedText:string,
 *   ruleId:string
 * }}
 */
export function parseMessage(rawText, opts={}){
  const ref = opts.referenceDate ? new Date(opts.referenceDate) : new Date();
  const text = String(rawText||'');
  const n = norm(text);
  const time = extractTime(text);

  const candidates = [];

  // --- TIER RECURRING ------------------------------------------------------
  let m;
  if((m = n.match(/\bcada\s+(\d+)\s*(dias?|semanas?|meses?)\b/))){
    const num=+m[1], unit=m[2];
    const freq = unit.startsWith('dia')?'DAILY':unit.startsWith('sem')?'WEEKLY':'MONTHLY';
    candidates.push({tier:TIER.RECURRING, ruleId:'cada-n-unidad', matched:m[0],
      recurrence:[`RRULE:FREQ=${freq};INTERVAL=${num}`], date:ref});
  }
  if((m = n.match(/\bcada\s+(dia|semana|mes|ano|año)\b/))){
    const freq = m[1].startsWith('dia')?'DAILY':m[1]==='semana'?'WEEKLY':m[1]==='mes'?'MONTHLY':'YEARLY';
    candidates.push({tier:TIER.RECURRING, ruleId:'cada-unidad', matched:m[0],
      recurrence:[`RRULE:FREQ=${freq}`], date:ref});
  }
  if((m = n.match(/\bcada\s+(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/))){
    const dow = WEEKDAY_ALIASES[m[1]];
    candidates.push({tier:TIER.RECURRING, ruleId:'cada-dia-semana', matched:m[0],
      recurrence:[`RRULE:FREQ=WEEKLY;BYDAY=${BYDAY[m[1]]}`], date:nextWeekday(ref,dow,{allowToday:true})});
  }
  if((m = n.match(/\btodos\s+los\s+(lunes|martes|miercoles|jueves|viernes|sabados|domingos)\b/))){
    const raw = m[1];
    // "lunes/martes/miercoles/jueves/viernes" ya son invariables en plural;
    // solo "sabado(s)"/"domingo(s)" añaden una "s" real al pluralizar.
    const key = WEEKDAY_ALIASES[raw]!==undefined ? raw : raw.replace(/s$/,'');
    const dow = WEEKDAY_ALIASES[key];
    if(dow!==undefined) candidates.push({tier:TIER.RECURRING, ruleId:'todos-los-dias-semana', matched:m[0],
      recurrence:[`RRULE:FREQ=WEEKLY;BYDAY=${BYDAY[key]}`], date:nextWeekday(ref,dow,{allowToday:true})});
  }
  if((m = n.match(/\b(diariamente|a diario|a\s+diario)\b/))){
    candidates.push({tier:TIER.RECURRING, ruleId:'diario', matched:m[0], recurrence:['RRULE:FREQ=DAILY'], date:ref});
  }
  if((m = n.match(/\b(semanalmente|semanal)\b/))){
    candidates.push({tier:TIER.RECURRING, ruleId:'semanal', matched:m[0], recurrence:['RRULE:FREQ=WEEKLY'], date:ref});
  }
  if((m = n.match(/\b(mensualmente|mensual)\b/))){
    candidates.push({tier:TIER.RECURRING, ruleId:'mensual', matched:m[0], recurrence:['RRULE:FREQ=MONTHLY'], date:ref});
  }
  if((m = n.match(/\bquincenal(mente)?\b/))){
    candidates.push({tier:TIER.RECURRING, ruleId:'quincenal', matched:m[0], recurrence:['RRULE:FREQ=WEEKLY;INTERVAL=2'], date:ref});
  }

  // --- TIER DEADLINE ("antes de...", "plazo", "fecha límite", "hasta el") --
  if((m = text.match(/\bantes\s+de\s+que\s+acabe\s+la\s+semana\b/i))){
    const d = nextWeekday(ref, 0, {allowToday:true}); // domingo de esta semana
    candidates.push({tier:TIER.DEADLINE, ruleId:'antes-fin-semana', matched:m[0], date:d});
  }
  if((m = text.match(/\bantes\s+de\s+que\s+acabe\s+el\s+mes\b/i))){
    candidates.push({tier:TIER.DEADLINE, ruleId:'antes-fin-mes', matched:m[0], date:lastDayOfMonth(ref)});
  }
  {
    const deadlineIntro = text.match(/\b(antes\s+del?|fecha\s+l[ií]mite\s*:?|plazo(?:\s+m[aá]ximo)?\s*:?|hasta\s+el|hasta\s+la)\s+(.+)/i);
    if(deadlineIntro){
      const rest = deadlineIntro[2];
      const ed = explicitDate(rest, ref);
      if(ed) candidates.push({tier:TIER.DEADLINE, ruleId:'antes-de-fecha', matched:deadlineIntro[0].slice(0,60), date:ed.date});
      else {
        const wd = rest.match(/\b(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\b/i);
        if(wd){
          const dow = WEEKDAY_ALIASES[norm(wd[1])];
          candidates.push({tier:TIER.DEADLINE, ruleId:'antes-de-dia-semana', matched:deadlineIntro[0].slice(0,60), date:nextWeekday(ref,dow)});
        }
      }
    }
  }

  // --- TIER EXPLICIT (fecha concreta) --------------------------------------
  {
    const ed = explicitDate(text, ref);
    if(ed) candidates.push({tier:TIER.EXPLICIT, ruleId:'fecha-explicita', matched:ed.matched, date:ed.date});
  }
  if((m = n.match(/\b(el|para el|el proximo)\s+(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/))){
    const dow = WEEKDAY_ALIASES[m[2]];
    candidates.push({tier:TIER.EXPLICIT, ruleId:'dia-semana', matched:m[0], date:nextWeekday(ref,dow)});
  }

  // --- TIER RELATIVE --------------------------------------------------------
  if((m = n.match(/\ben\s+(\d+)\s*dias?\b/))){
    candidates.push({tier:TIER.RELATIVE, ruleId:'en-n-dias', matched:m[0], date:addDays(ref,+m[1])});
  }
  if((m = n.match(/\ben\s+(\d+)\s*semanas?\b/))){
    candidates.push({tier:TIER.RELATIVE, ruleId:'en-n-semanas', matched:m[0], date:addDays(ref,+m[1]*7)});
  }
  if((m = n.match(/\bpasado\s+manana\b/))){
    candidates.push({tier:TIER.RELATIVE, ruleId:'pasado-manana', matched:m[0], date:addDays(ref,2)});
  } else if((m = n.match(/\bmanana\b/)) && !/\b(por|de|esta)\s+la?\s*manana\b/.test(n)){
    candidates.push({tier:TIER.RELATIVE, ruleId:'manana', matched:m[0], date:addDays(ref,1)});
  }
  if((m = n.match(/\bhoy\b/))){
    candidates.push({tier:TIER.RELATIVE, ruleId:'hoy', matched:m[0], date:ref});
  }

  if(!candidates.length){
    return {
      kind:'none', date:null, time, allDay:!time, recurrence:[],
      reminders: reminders([60]), confidence:'low', matchedText:'', ruleId:'sin-deteccion'
    };
  }

  // El de mayor "tier" gana; entre empates, el que aparece antes en el texto.
  candidates.sort((a,b)=> b.tier-a.tier);
  const best = candidates[0];

  const isRecurring = best.tier===TIER.RECURRING;
  const isDeadline = best.tier===TIER.DEADLINE;
  const kind = isRecurring?'recurring':isDeadline?'deadline':'single';

  let reminderMinutes;
  if(isRecurring) reminderMinutes = time ? [60] : [24*60];
  else if(isDeadline) reminderMinutes = time ? [60,24*60,2*24*60] : [24*60,2*24*60];
  else reminderMinutes = time ? [60,24*60] : [24*60];

  const confidence = best.tier>=TIER.EXPLICIT ? 'high' : 'medium';

  return {
    kind,
    date: toISODate(best.date),
    time,
    allDay: !time,
    recurrence: best.recurrence || [],
    reminders: reminders(reminderMinutes),
    confidence,
    matchedText: best.matched,
    ruleId: best.ruleId
  };
}

/** Título corto para el evento a partir del cuerpo del mensaje. */
export function suggestTitle(rawText, fallback='Mensaje de esemtia Connect'){
  const firstLine = String(rawText||'').split(/\r?\n/).map(s=>s.trim()).find(Boolean) || '';
  if(!firstLine) return fallback;
  return firstLine.length>80 ? firstLine.slice(0,77)+'…' : firstLine;
}
