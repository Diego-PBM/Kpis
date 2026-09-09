const $ = id => document.getElementById(id);
const send = (type, extra={}) => chrome.runtime.sendMessage({type, ...extra});
const escapeHtml = s => String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

async function init(){
  $('redirectUri').textContent = chrome.identity.getRedirectURL();

  const cfg = (await send('GET_CONFIG')).data;
  $('clientId').value = cfg.clientId || '';
  $('esemtiaOrigin').value = cfg.esemtiaOrigin || '';
  if(cfg.autoScan){
    $('listSelector').value = cfg.autoScan.listSelector || '';
    $('textSelector').value = cfg.autoScan.textSelector || '';
  }
  await loadCalendars(cfg.calendarId);
}

async function loadCalendars(selected){
  const res = await send('LIST_CALENDARS');
  if(res.ok && res.data.length){
    $('calendarSelect').innerHTML = res.data.map(c =>
      `<option value="${escapeHtml(c.id)}">${escapeHtml(c.summary)}${c.primary?' (principal)':''}</option>`).join('');
    if(selected) $('calendarSelect').value = selected;
  }
}

function showStatus(el, ok, msg){
  el.classList.remove('hidden','ok','err');
  el.classList.add(ok?'ok':'err');
  el.textContent = msg;
}

$('copyRedirect').addEventListener('click', () => {
  navigator.clipboard.writeText($('redirectUri').textContent).catch(()=>{});
});

$('saveClientId').addEventListener('click', async () => {
  await send('SET_CONFIG', {patch:{clientId: $('clientId').value.trim()}});
  showStatus($('authStatus'), true, 'Client ID guardado.');
});

$('testAuth').addEventListener('click', async () => {
  const res = await send('AUTH_TEST');
  if(res.ok) showStatus($('authStatus'), true, '✅ Autenticado correctamente con Google.');
  else showStatus($('authStatus'), false, '❌ '+res.error);
});

$('refreshCalendars').addEventListener('click', () => loadCalendars($('calendarSelect').value));

$('saveCalendar').addEventListener('click', async () => {
  await send('SET_CONFIG', {patch:{calendarId: $('calendarSelect').value}});
  alert('Calendario guardado.');
});

$('grantOrigin').addEventListener('click', async () => {
  const pattern = $('esemtiaOrigin').value.trim();
  if(!pattern){ showStatus($('originStatus'), false, 'Escribe la URL de esemtia Connect primero.'); return; }
  const res = await send('REGISTER_ORIGIN', {originPattern: pattern});
  if(res.ok) showStatus($('originStatus'), true, '✅ Permiso concedido. Recarga la pestaña de esemtia Connect.');
  else showStatus($('originStatus'), false, '❌ '+res.error);
});

$('saveAutoScan').addEventListener('click', async () => {
  await send('SET_CONFIG', {patch:{autoScan:{
    listSelector: $('listSelector').value.trim(),
    textSelector: $('textSelector').value.trim()
  }}});
  alert('Selectores guardados.');
});

init();
