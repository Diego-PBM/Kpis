import { parseMessage, suggestTitle } from './parser.js';

const $ = id => document.getElementById(id);
const send = (type, extra={}) => chrome.runtime.sendMessage({type, ...extra});

let currentParsed = null;

function fmtReminderValue(minutesArr){
  const set = new Set(minutesArr);
  if(set.has(60)&&set.has(1440)&&set.has(2880)) return '1440,2880,60';
  if(set.has(60)&&set.has(1440)) return '60,1440';
  if(set.has(1440)&&set.has(2880)) return '1440,2880';
  if(set.has(60)) return '60';
  return '1440';
}

function applyParsedToForm(text, parsed){
  currentParsed = parsed;
  $('title').value = suggestTitle(text);
  $('date').value = parsed.date || '';
  $('allDay').checked = parsed.allDay;
  $('time').value = parsed.time ? `${String(parsed.time.h).padStart(2,'0')}:${String(parsed.time.min).padStart(2,'0')}` : '';
  $('timeFld').classList.toggle('hidden', parsed.allDay);
  $('recurrence').value = (parsed.recurrence&&parsed.recurrence[0]) || '';
  $('reminder').value = fmtReminderValue(parsed.reminders.map(r=>r.minutes));

  const box = $('detected');
  box.classList.remove('hidden','warn','ok','err');
  if(parsed.kind==='none'){
    box.classList.add('warn');
    box.innerHTML = '<b>No he detectado ninguna fecha.</b> Ajusta la fecha a mano abajo antes de guardar.';
  } else {
    const kindLabel = {single:'Fecha puntual', deadline:'Plazo / fecha límite', recurring:'Evento recurrente'}[parsed.kind];
    box.classList.add('ok');
    box.innerHTML = `<span class="badge">${kindLabel}</span> detecté “<i>${escapeHtml(parsed.matchedText)}</i>” · confianza ${parsed.confidence}`;
  }
}
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function reparseFromForm(){
  const text = $('text').value;
  if(!text.trim()){ $('detected').classList.add('hidden'); return; }
  const parsed = parseMessage(text);
  applyParsedToForm(text, parsed);
}

async function loadCalendars(){
  const res = await send('LIST_CALENDARS');
  const sel = $('calendar');
  if(res.ok && res.data.length){
    sel.innerHTML = res.data.map(c=>`<option value="${escapeHtml(c.id)}">${escapeHtml(c.summary)}${c.primary?' (principal)':''}</option>`).join('');
    const cfg = (await send('GET_CONFIG')).data;
    if(cfg.calendarId) sel.value = cfg.calendarId;
  }
  // si falla (aún no autenticado), se deja "Mi calendario principal" / "primary" por defecto
}

async function loadRecent(){
  const res = await send('GET_RECENT_SYNCS');
  const ul = $('recentList');
  if(!res.ok || !res.data.length){ ul.innerHTML = '<li style="color:#999">Todavía no hay eventos sincronizados.</li>'; return; }
  ul.innerHTML = res.data.map(it => `<li><span>${escapeHtml(it.title||'(sin título)')}</span>` +
    (it.htmlLink ? `<a href="${it.htmlLink}" target="_blank">abrir ↗</a>` : '') + `</li>`).join('');
}

async function init(){
  const pending = await send('GET_PENDING_MESSAGE');
  if(pending.ok && pending.data && pending.data.text){
    $('text').value = pending.data.text;
    reparseFromForm();
  }
  await loadCalendars();
  await loadRecent();
}

$('text').addEventListener('input', debounce(reparseFromForm, 250));
$('allDay').addEventListener('change', () => $('timeFld').classList.toggle('hidden', $('allDay').checked));

$('sync').addEventListener('click', async () => {
  const text = $('text').value.trim();
  if(!text){ alert('Escribe o pega el texto del mensaje primero.'); return; }
  if(!$('date').value){
    const result = $('result');
    result.classList.remove('hidden','ok','err');
    result.classList.add('err');
    result.textContent = '❌ Falta la fecha. Rellena el campo "Fecha" antes de guardar (no se ha detectado ninguna en el texto).';
    $('date').focus();
    return;
  }
  const btn = $('sync'); btn.disabled = true; btn.textContent = 'Guardando…';
  const result = $('result');
  result.classList.remove('hidden','ok','err');

  const time = $('time').value;
  const [h,min] = time ? time.split(':').map(Number) : [null,null];
  const allDay = $('allDay').checked || !time;
  const reminderMinutes = $('reminder').value.split(',').filter(Boolean).map(Number);
  const recurrenceVal = $('recurrence').value;

  const overrideParsed = {
    date: $('date').value,
    allDay,
    time: allDay ? null : {h, min},
    recurrence: recurrenceVal ? [recurrenceVal] : [],
    reminders: reminderMinutes.map(minutes=>({method:'popup', minutes})),
    kind: currentParsed ? currentParsed.kind : 'single'
  };

  try{
    const res = await send('SYNC_EVENT', {payload:{
      text, override:{title: $('title').value, calendarId: $('calendar').value, parsed: overrideParsed}
    }});
    if(!res.ok) throw new Error(res.error);
    result.classList.add('ok');
    result.innerHTML = `✅ Evento guardado. <a href="${res.data.event.htmlLink}" target="_blank">Verlo en Google Calendar ↗</a>`;
    await loadRecent();
  }catch(err){
    result.classList.add('err');
    result.textContent = '❌ '+ (err.message||'No se ha podido sincronizar.');
  }finally{
    btn.disabled = false; btn.textContent = 'Guardar en Google Calendar';
  }
});

$('openOptions').addEventListener('click', (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); });

function debounce(fn,ms){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; }

init();
