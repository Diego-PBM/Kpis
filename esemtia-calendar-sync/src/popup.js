const $ = id => document.getElementById(id);
const send = (type, extra={}) => chrome.runtime.sendMessage({type, ...extra});
const escapeHtml = s => String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

let capture = {text:'', images:[], childHint:null}; // lo que se va a analizar/guardar
let events = []; // [{selected,title,date,time,allDay,recurrence,reminderVal,confidence,matchedText}]
let lastChild = null; // hijo/alumno detectado en el último análisis, si lo hay

function reminderValueFromMinutes(minutesArr){
  const set = new Set(minutesArr||[]);
  if(set.has(60)&&set.has(1440)&&set.has(2880)) return '1440,2880,60';
  if(set.has(60)&&set.has(1440)) return '60,1440';
  if(set.has(1440)&&set.has(2880)) return '1440,2880';
  if(set.has(60)) return '60';
  return '1440';
}
function minutesFromReminderValue(v){ return v.split(',').filter(Boolean).map(Number); }

function toEventState(e){
  return {
    selected: true,
    title: e.title || 'Mensaje de esemtia Connect',
    date: e.date || '',
    time: e.time ? `${String(e.time.h).padStart(2,'0')}:${String(e.time.min).padStart(2,'0')}` : '',
    allDay: e.allDay!==false && !e.time,
    recurrence: (e.recurrence && e.recurrence[0]) || '',
    reminderVal: reminderValueFromMinutes((e.reminders||[]).map(r=>r.minutes)),
    confidence: e.confidence || 'media',
    matchedText: e.matchedText || ''
  };
}

function setStatus(msg, cls){
  const el = $('status');
  el.classList.remove('hidden','ok','err','warn');
  if(cls) el.classList.add(cls);
  el.innerHTML = msg;
}
function clearStatus(){ $('status').classList.add('hidden'); }

async function analyze(){
  const text = $('text').value.trim();
  if(!text){ setStatus('Escribe o pega el texto del mensaje primero.', 'warn'); return; }
  capture = {text, images: capture.text===text ? capture.images : [], childHint: capture.text===text ? capture.childHint : null};
  $('events').innerHTML = '';
  $('saveRow').style.display = 'none';
  $('childInfo').classList.add('hidden');
  $('result').classList.add('hidden');
  setStatus('<span class="spinner"></span>Analizando el mensaje…');
  $('analyze').disabled = true;

  const res = await send('EXTRACT_EVENTS', {payload: {
    text: capture.text, images: capture.images, childHint: capture.childHint
  }});
  $('analyze').disabled = false;

  if(!res.ok){ setStatus('❌ '+res.error, 'err'); return; }
  const {source, child, events: rawEvents, warning} = res.data;
  lastChild = child || null;

  if(child){
    $('childInfo').classList.remove('hidden');
    $('childInfo').textContent = `👤 Sobre: ${child}`;
  }

  if(warning){
    setStatus('⚠️ '+escapeHtml(warning), 'warn');
  } else if(source==='local'){
    setStatus('Analizado con reglas locales (configura tu clave de IA en Opciones para una lectura más completa del correo, incluidos adjuntos).', 'warn');
  } else {
    setStatus(`✅ Analizado con IA · ${rawEvents.length} evento${rawEvents.length===1?'':'s'} detectado${rawEvents.length===1?'':'s'}.`, 'ok');
  }

  events = rawEvents.map(toEventState);
  renderEvents();
}

function renderEvents(){
  const box = $('events');
  if(!events.length){
    box.innerHTML = '<div class="info">No se ha detectado ningún evento accionable en este texto.</div>';
    $('saveRow').style.display = 'none';
    return;
  }
  box.innerHTML = events.map((ev, i) => `
    <div class="card" data-idx="${i}">
      <div class="cardhead">
        <label class="chk"><input type="checkbox" class="f-sel" ${ev.selected?'checked':''}> ${escapeHtml(ev.title)}</label>
      </div>
      ${ev.matchedText ? `<div class="quote">“${escapeHtml(ev.matchedText)}”</div>` : ''}
      <div class="row">
        <label class="fld">Título<input type="text" class="f-title" value="${escapeHtml(ev.title)}"></label>
      </div>
      <div class="row">
        <label class="fld">Fecha<input type="date" class="f-date" value="${ev.date}"></label>
        <label class="fld f-timefld ${ev.allDay?'hidden':''}">Hora<input type="time" class="f-time" value="${ev.time}"></label>
        <label class="chk"><input type="checkbox" class="f-allday" ${ev.allDay?'checked':''}> Todo el día</label>
      </div>
      <div class="row">
        <label class="fld">Recordarme<select class="f-reminder">
          <option value="60">1 hora antes</option>
          <option value="60,1440">1 hora y 1 día antes</option>
          <option value="1440">1 día antes</option>
          <option value="1440,2880">1 y 2 días antes</option>
          <option value="1440,2880,60">1 día, 2 días y 1 hora antes</option>
        </select></label>
        <label class="fld">Repetir<select class="f-recurrence">
          <option value="">No se repite</option>
          <option value="RRULE:FREQ=DAILY">Cada día</option>
          <option value="RRULE:FREQ=WEEKLY">Cada semana</option>
          <option value="RRULE:FREQ=WEEKLY;INTERVAL=2">Cada 2 semanas</option>
          <option value="RRULE:FREQ=MONTHLY">Cada mes</option>
        </select></label>
      </div>
    </div>
  `).join('');

  // fijar selects/valores calculados (no siempre representables como atributo "selected" fijo)
  box.querySelectorAll('.card').forEach(card => {
    const i = +card.dataset.idx;
    card.querySelector('.f-reminder').value = events[i].reminderVal;
    const recSel = card.querySelector('.f-recurrence');
    if([...recSel.options].some(o=>o.value===events[i].recurrence)) recSel.value = events[i].recurrence;
  });

  box.addEventListener('input', onCardChange);
  box.addEventListener('change', onCardChange);
  $('saveRow').style.display = '';
}

function onCardChange(e){
  const card = e.target.closest('.card'); if(!card) return;
  const i = +card.dataset.idx; const ev = events[i]; if(!ev) return;
  if(e.target.classList.contains('f-sel')) ev.selected = e.target.checked;
  if(e.target.classList.contains('f-title')) ev.title = e.target.value;
  if(e.target.classList.contains('f-date')) ev.date = e.target.value;
  if(e.target.classList.contains('f-time')) ev.time = e.target.value;
  if(e.target.classList.contains('f-allday')){
    ev.allDay = e.target.checked;
    card.querySelector('.f-timefld').classList.toggle('hidden', ev.allDay);
  }
  if(e.target.classList.contains('f-reminder')) ev.reminderVal = e.target.value;
  if(e.target.classList.contains('f-recurrence')) ev.recurrence = e.target.value;
}

async function loadCalendars(){
  const res = await send('LIST_CALENDARS');
  const sel = $('calendar');
  if(res.ok && res.data.length){
    sel.innerHTML = res.data.map(c=>`<option value="${escapeHtml(c.id)}">${escapeHtml(c.summary)}${c.primary?' (principal)':''}</option>`).join('');
    const cfg = (await send('GET_CONFIG')).data;
    if(cfg.calendarId) sel.value = cfg.calendarId;
  }
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
  await loadCalendars();
  await loadRecent();
  if(pending.ok && pending.data && pending.data.text){
    $('text').value = pending.data.text;
    capture = {text: pending.data.text, images: pending.data.images||[], childHint: pending.data.childHint||null};
    analyze();
  }
}

$('analyze').addEventListener('click', analyze);
$('openOptions').addEventListener('click', (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); });

$('saveAll').addEventListener('click', async () => {
  const selected = events.map((ev,i)=>({ev,i})).filter(x=>x.ev.selected);
  if(!selected.length){ setStatus('Marca al menos un evento para guardar.', 'warn'); return; }

  const result = $('result');
  result.classList.remove('hidden','ok','err');
  const btn = $('saveAll'); btn.disabled = true; btn.textContent = 'Guardando…';
  const calendarId = $('calendar').value;
  const outcomes = [];

  for(const {ev, i} of selected){
    if(!ev.date){ outcomes.push(`❌ “${escapeHtml(ev.title)}”: falta la fecha.`); continue; }
    const time = ev.allDay ? null : (ev.time ? {h:+ev.time.split(':')[0], min:+ev.time.split(':')[1]} : null);
    const parsed = {
      date: ev.date, allDay: ev.allDay || !time, time: (ev.allDay || !time) ? null : time,
      recurrence: ev.recurrence ? [ev.recurrence] : [],
      reminders: minutesFromReminderValue(ev.reminderVal).map(minutes=>({method:'popup', minutes}))
    };
    const res = await send('SYNC_EVENT', {payload:{
      text: capture.text, eventIndex: i, calendarId, title: ev.title, child: lastChild, parsed
    }});
    outcomes.push(res.ok
      ? `✅ “${escapeHtml(ev.title)}”: <a href="${res.data.event.htmlLink}" target="_blank">ver ↗</a>`
      : `❌ “${escapeHtml(ev.title)}”: ${escapeHtml(res.error)}`);
  }

  btn.disabled = false; btn.textContent = 'Guardar seleccionados en Google Calendar';
  const anyErr = outcomes.some(o=>o.startsWith('❌'));
  result.classList.toggle('ok', !anyErr);
  result.classList.toggle('err', anyErr);
  result.innerHTML = outcomes.join('<br>');
  await loadRecent();
});

init();
