/* ============================================================================
   background.js — service worker (Manifest V3)

   Responsabilidades:
   - Autenticar con Google (OAuth "implicit flow" vía chrome.identity.launchWebAuthFlow,
     sin necesidad de client secret ni de publicar la extensión).
   - Hablar con la API de Google Calendar (listar calendarios, crear/actualizar eventos).
   - Evitar duplicados: cada evento se etiqueta con un hash del texto de origen en
     extendedProperties.private, así reenviar el mismo mensaje actualiza el evento
     en vez de crear uno nuevo.
   - Registrar dinámicamente el content script sobre el dominio de esemtia que el
     usuario indique en Opciones (no conocemos ese dominio de antemano).
   - Menú contextual "Crear evento…" sobre cualquier texto seleccionado, funcione o
     no el content script en esa página.
   ========================================================================== */
import { parseMessage, suggestTitle } from './parser.js';

const CAL_API = 'https://www.googleapis.com/calendar/v3';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const SCOPE = 'https://www.googleapis.com/auth/calendar.events';

/* ---------------------------- configuración ------------------------------ */
async function getConfig(){
  const {config} = await chrome.storage.sync.get('config');
  return Object.assign({clientId:'', calendarId:'primary', esemtiaOrigin:''}, config||{});
}
async function setConfig(patch){
  const cur = await getConfig();
  const next = Object.assign({}, cur, patch);
  await chrome.storage.sync.set({config: next});
  return next;
}

/* ------------------------------- OAuth ------------------------------------ */
function redirectUri(){ return chrome.identity.getRedirectURL(); }

async function getToken(interactive){
  const {clientId} = await getConfig();
  if(!clientId) throw new Error('Falta el Client ID de Google en Opciones.');
  const {tokenCache} = await chrome.storage.session.get('tokenCache');
  if(tokenCache && tokenCache.expiresAt > Date.now()+30000) return tokenCache.accessToken;

  const url = new URL(AUTH_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri());
  url.searchParams.set('response_type', 'token');
  url.searchParams.set('scope', SCOPE);
  url.searchParams.set('include_granted_scopes', 'true');
  if(interactive) url.searchParams.set('prompt', 'consent');

  const redirected = await chrome.identity.launchWebAuthFlow({
    url: url.toString(), interactive: !!interactive
  }).catch(err => { throw new Error('Autenticación con Google cancelada o fallida: '+err.message); });

  const hash = new URL(redirected).hash.replace(/^#/, '');
  const params = new URLSearchParams(hash);
  const accessToken = params.get('access_token');
  const expiresIn = +(params.get('expires_in')||3600);
  if(!accessToken) throw new Error('Google no devolvió un token de acceso.');

  await chrome.storage.session.set({tokenCache:{accessToken, expiresAt: Date.now()+expiresIn*1000}});
  return accessToken;
}

async function authedFetch(path, opts={}, retry=true){
  const token = await getToken(false).catch(()=>getToken(true));
  const res = await fetch(`${CAL_API}${path}`, {
    ...opts,
    headers: {'Authorization':`Bearer ${token}`, 'Content-Type':'application/json', ...(opts.headers||{})}
  });
  if(res.status===401 && retry){
    await chrome.storage.session.remove('tokenCache');
    return authedFetch(path, opts, false);
  }
  if(!res.ok){
    const body = await res.text().catch(()=> '');
    throw new Error(`Google Calendar API ${res.status}: ${body.slice(0,300)}`);
  }
  return res.status===204 ? null : res.json();
}

/* ------------------------------ Calendar ---------------------------------- */
async function listCalendars(){
  const data = await authedFetch('/users/me/calendarList?minAccessRole=writer');
  return (data.items||[]).map(c=>({id:c.id, summary:c.summary, primary:!!c.primary}));
}

async function sha256Hex(text){
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
}

function buildEventBody({title, description, parsed, hash}){
  const body = {
    summary: title,
    description,
    extendedProperties: {private: {esemtiaHash: hash}}
  };
  if(parsed.allDay){
    const end = addISODays(parsed.date, 1);
    body.start = {date: parsed.date};
    body.end = {date: end};
  } else {
    const startDt = `${parsed.date}T${pad2(parsed.time.h)}:${pad2(parsed.time.min)}:00`;
    const endDt = addMinutesISO(parsed.date, parsed.time, 60);
    body.start = {dateTime: startDt};
    body.end = {dateTime: endDt};
  }
  if(parsed.recurrence && parsed.recurrence.length) body.recurrence = parsed.recurrence;
  body.reminders = {useDefault:false, overrides: parsed.reminders};
  return body;
}
function pad2(n){ return String(n).padStart(2,'0'); }
function addISODays(iso, n){
  const [y,m,d] = iso.split('-').map(Number);
  const dt = new Date(y, m-1, d+n);
  return `${dt.getFullYear()}-${pad2(dt.getMonth()+1)}-${pad2(dt.getDate())}`;
}
function addMinutesISO(iso, time, minutes){
  const [y,m,d] = iso.split('-').map(Number);
  const dt = new Date(y, m-1, d, time.h, time.min+minutes);
  return `${dt.getFullYear()}-${pad2(dt.getMonth()+1)}-${pad2(dt.getDate())}T${pad2(dt.getHours())}:${pad2(dt.getMinutes())}:00`;
}

/** Busca un evento ya sincronizado con este hash (por si el índice local se perdió). */
async function findEventByHash(calendarId, hash){
  const q = new URLSearchParams({
    privateExtendedProperty: `esemtiaHash=${hash}`,
    showDeleted: 'false', maxResults: '1'
  });
  const data = await authedFetch(`/calendars/${encodeURIComponent(calendarId)}/events?${q}`);
  return (data.items||[])[0] || null;
}

async function syncMessageToCalendar({text, referenceDate, override}){
  const cfg = await getConfig();
  const calendarId = (override&&override.calendarId) || cfg.calendarId || 'primary';
  const parsed = Object.assign({}, parseMessage(text, {referenceDate}), override && override.parsed || {});
  const title = (override && override.title) || suggestTitle(text);
  const hash = await sha256Hex(text);

  const {syncIndex} = await chrome.storage.local.get('syncIndex');
  const idx = syncIndex || {};
  let existing = idx[hash];
  if(!existing) existing = await findEventByHash(calendarId, hash).catch(()=>null);

  const body = buildEventBody({title, description: text, parsed, hash});
  let event;
  if(existing && existing.id){
    event = await authedFetch(`/calendars/${encodeURIComponent(calendarId)}/events/${existing.id}`, {
      method:'PATCH', body: JSON.stringify(body)
    });
  } else {
    event = await authedFetch(`/calendars/${encodeURIComponent(calendarId)}/events`, {
      method:'POST', body: JSON.stringify(body)
    });
  }

  idx[hash] = {id: event.id, calendarId, title, htmlLink: event.htmlLink, syncedAt: Date.now(), kind: parsed.kind};
  await chrome.storage.local.set({syncIndex: idx});
  return {event, parsed, hash};
}

/* --------------------------- registro dinámico ---------------------------- */
async function registerEsemtiaOrigin(originPattern){
  await chrome.scripting.unregisterContentScripts({ids:['esemtia-content']}).catch(()=>{});
  await chrome.scripting.registerContentScripts([{
    id: 'esemtia-content',
    js: ['src/content.js'],
    matches: [originPattern],
    // Muchas plataformas de gestión escolar (esemtia incluida) cargan la
    // bandeja de mensajes dentro de un <iframe>. Sin allFrames:true el botón
    // flotante nunca aparecería al seleccionar texto dentro de ese fotograma.
    allFrames: true,
    matchOriginAsFallback: true,
    runAt: 'document_idle'
  }]);
}

/* -------------------------------- mensajería -------------------------------- */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try{
      switch(msg.type){
        case 'GET_CONFIG': sendResponse({ok:true, data: await getConfig()}); break;
        case 'SET_CONFIG': sendResponse({ok:true, data: await setConfig(msg.patch)}); break;
        case 'AUTH_TEST': {
          await getToken(true);
          sendResponse({ok:true});
          break;
        }
        case 'LIST_CALENDARS': sendResponse({ok:true, data: await listCalendars()}); break;
        case 'PARSE': sendResponse({ok:true, data: parseMessage(msg.text, {referenceDate: msg.referenceDate})}); break;
        case 'SYNC_EVENT': {
          const result = await syncMessageToCalendar(msg.payload);
          sendResponse({ok:true, data: result});
          break;
        }
        case 'GET_RECENT_SYNCS': {
          const {syncIndex} = await chrome.storage.local.get('syncIndex');
          const items = Object.entries(syncIndex||{}).map(([hash,v])=>({hash, ...v}))
            .sort((a,b)=>b.syncedAt-a.syncedAt).slice(0, 20);
          sendResponse({ok:true, data: items});
          break;
        }
        case 'REGISTER_ORIGIN': {
          const granted = await chrome.permissions.request({origins:[msg.originPattern]});
          if(!granted) throw new Error('Permiso denegado por el usuario.');
          await registerEsemtiaOrigin(msg.originPattern);
          await setConfig({esemtiaOrigin: msg.originPattern});
          sendResponse({ok:true});
          break;
        }
        case 'OPEN_POPUP_WITH_TEXT': {
          await chrome.storage.session.set({pendingMessage: {text: msg.text, capturedAt: Date.now()}});
          try{ await chrome.action.openPopup(); }
          catch(e){
            await chrome.windows.create({url: chrome.runtime.getURL('src/popup.html'), type:'popup', width:420, height:640});
          }
          sendResponse({ok:true});
          break;
        }
        case 'GET_PENDING_MESSAGE': {
          const {pendingMessage} = await chrome.storage.session.get('pendingMessage');
          await chrome.storage.session.remove('pendingMessage');
          sendResponse({ok:true, data: pendingMessage||null});
          break;
        }
        default: sendResponse({ok:false, error:'Tipo de mensaje desconocido: '+msg.type});
      }
    }catch(err){
      sendResponse({ok:false, error: err.message||String(err)});
    }
  })();
  return true; // respuesta asíncrona
});

/* --------------------------- menú contextual -------------------------------- */
chrome.runtime.onInstalled.addListener(() => {
  // removeAll primero: chrome.contextMenus.create() falla en silencio
  // ("Cannot create item with duplicate id") si el menú de una recarga
  // anterior seguía registrado, y sin comprobar chrome.runtime.lastError
  // ese fallo pasa desapercibido y el menú nunca llega a aparecer.
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'esemtia-sync-selection',
      title: 'Crear evento en Google Calendar desde esta selección',
      contexts: ['selection']
    }, () => {
      if(chrome.runtime.lastError) console.error('No se pudo crear el menú contextual:', chrome.runtime.lastError.message);
    });
  });
});
chrome.contextMenus.onClicked.addListener(async (info) => {
  if(info.menuItemId==='esemtia-sync-selection' && info.selectionText){
    await chrome.storage.session.set({pendingMessage: {text: info.selectionText, capturedAt: Date.now()}});
    try{ await chrome.action.openPopup(); }
    catch(e){ await chrome.windows.create({url: chrome.runtime.getURL('src/popup.html'), type:'popup', width:420, height:640}); }
  }
});

/* Si el usuario ya había configurado un dominio en una sesión anterior,
   vuelve a registrar el content script al arrancar el navegador. */
chrome.runtime.onStartup.addListener(async () => {
  const cfg = await getConfig();
  if(cfg.esemtiaOrigin){
    const has = await chrome.permissions.contains({origins:[cfg.esemtiaOrigin]});
    if(has) registerEsemtiaOrigin(cfg.esemtiaOrigin).catch(()=>{});
  }
});
