/* ============================================================================
   content.js — se inyecta SOLO en el dominio de esemtia Connect que el
   usuario autoriza desde Opciones (chrome.scripting.registerContentScripts).

   Flujo principal (botón flotante al seleccionar texto):
     1) El usuario selecciona con el ratón un fragmento del mensaje.
     2) Aparece un botón flotante "📅 Sincronizar con Calendar".
     3) Al pulsarlo, NO solo se manda el fragmento seleccionado: se sube hasta
        encontrar el contenedor del mensaje completo (para que la IA pueda ver
        todo el correo, no solo la frase resaltada), se detecta a qué
        hijo/alumno se refiere si hay pistas en el DOM, y se recogen las
        imágenes/PDF adjuntos dentro de ese contenedor (convertidos a base64)
        para que la IA también pueda leerlos. Todo eso va al popup, que hace
        la extracción real.

   Como complemento opcional (mejor esfuerzo, configurable en Opciones con
   selectores CSS), se puede activar un escaneo automático de una lista de
   mensajes si el usuario indica los selectores de su bandeja de entrada.
   ========================================================================== */
(function(){
  const BTN_ID = 'esemtia-sync-floating-btn';
  const MAX_ATTACHMENTS = 6;
  const MAX_ATTACHMENT_BYTES = 6 * 1024 * 1024; // 6MB por archivo

  function removeBtn(){ const b=document.getElementById(BTN_ID); if(b) b.remove(); }

  function showButtonNear(rect, anchorNode){
    removeBtn();
    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.textContent = '📅 Sincronizar con Calendar';
    Object.assign(btn.style, {
      position: 'absolute',
      top: `${window.scrollY + rect.bottom + 6}px`,
      left: `${window.scrollX + rect.left}px`,
      zIndex: 2147483647,
      font: '13px/1.3 system-ui, sans-serif',
      padding: '6px 10px',
      borderRadius: '8px',
      border: '1px solid rgba(0,0,0,.15)',
      background: '#2a78d6',
      color: '#fff',
      cursor: 'pointer',
      boxShadow: '0 4px 14px rgba(0,0,0,.18)'
    });
    btn.addEventListener('mousedown', e=>e.preventDefault()); // no perder la selección
    btn.addEventListener('click', async () => {
      btn.disabled = true; btn.textContent = '⏳ Leyendo mensaje…';
      try{
        const payload = await captureMessage(anchorNode);
        chrome.runtime.sendMessage({type:'OPEN_POPUP_WITH_TEXT', ...payload});
      }catch(e){
        // si algo falla al capturar el contenedor/adjuntos, no perdemos el texto seleccionado
        const fallbackInfo = getSelectionInfo();
        chrome.runtime.sendMessage({type:'OPEN_POPUP_WITH_TEXT', text: fallbackInfo ? fallbackInfo.text : '', images:[], childHint:null});
      }
      removeBtn();
    });
    document.body.appendChild(btn);
  }

  /** Muchos formularios de mensajería (De/Asunto/Sobre el hijo/cuerpo…)
   *  muestran el texto dentro de <input>/<textarea>. Esas selecciones NO
   *  las expone window.getSelection() — hay que mirar selectionStart/End
   *  del propio campo con foco. Sin esto, seleccionar texto dentro de esos
   *  campos no hacía aparecer el botón flotante en absoluto. */
  function getSelectionInfo(){
    const ae = document.activeElement;
    if(ae && (ae.tagName==='TEXTAREA' || ae.tagName==='INPUT')){
      try{
        const s = ae.selectionStart, e = ae.selectionEnd;
        if(s!=null && e!=null && e>s) return {text: ae.value.slice(s,e), node: ae, rectEl: ae};
      }catch(err){ /* algunos tipos de input (number, email…) no soportan selectionStart */ }
    }
    const sel = window.getSelection();
    const text = sel ? sel.toString().trim() : '';
    if(text && sel.rangeCount) return {text, node: sel.getRangeAt(0).startContainer, rectEl: sel.getRangeAt(0)};
    return null;
  }

  document.addEventListener('mouseup', () => {
    setTimeout(() => {
      const info = getSelectionInfo();
      if(info && info.text.length >= 12){
        const rect = info.rectEl.getBoundingClientRect();
        if(rect.width || rect.height) showButtonNear(rect, info.node);
      } else {
        removeBtn();
      }
    }, 0);
  });
  document.addEventListener('mousedown', (e) => {
    if(e.target && e.target.id===BTN_ID) return;
    removeBtn();
  });
  document.addEventListener('keydown', (e) => { if(e.key==='Escape') removeBtn(); });

  /* ---------------- captura del mensaje completo (texto + adjuntos) ------- */

  /** Sube desde el nodo de la selección hasta encontrar un contenedor que
   *  represente "el mensaje completo". Dos heurísticas, por orden:
   *  1) el primer ancestro que agrupe varios campos de formulario (típico de
   *     un diálogo De/Asunto/Sobre el hijo/Fecha/cuerpo con inputs y textarea);
   *  2) si no, el primer ancestro con al menos 120 caracteres de texto plano. */
  function findMessageContainer(node){
    const start = node && node.nodeType===3 ? node.parentElement : node;
    if(!start) return document.body;

    let formEl = start;
    while(formEl && formEl !== document.documentElement){
      if(formEl.querySelectorAll && formEl.querySelectorAll('input,textarea,select').length >= 3) return formEl;
      formEl = formEl.parentElement;
    }

    let el = start;
    while(el && el !== document.documentElement){
      const len = (el.innerText||'').trim().length;
      if(len >= 120) return el;
      el = el.parentElement;
    }
    return document.body;
  }

  /** Construye el texto del "correo" a partir de un contenedor que puede
   *  mezclar texto plano y campos de formulario (inputs/textarea) — estos
   *  últimos no aportan nada a innerText, así que hay que leer su .value
   *  explícitamente o se pierde el De/Asunto/Sobre el hijo/cuerpo, etc. */
  function buildTextFromContainer(container){
    const parts = [];
    const skipTypes = /^(hidden|button|submit|checkbox|radio|file|image|password)$/i;
    for(const el of container.querySelectorAll('input,select')){
      if(skipTypes.test(el.type||'')) continue;
      if(!el.value || !el.value.trim()) continue;
      const label = nearestLabelText(el).trim().replace(/:\s*$/,'');
      parts.push(label ? `${label}: ${el.value.trim()}` : el.value.trim());
    }
    for(const el of container.querySelectorAll('textarea')){
      if(el.value && el.value.trim()) parts.push(el.value.trim());
    }
    const plain = (container.innerText||'').trim();
    if(plain) parts.push(plain);
    return parts.join('\n\n');
  }

  function nearestLabelText(el){
    if(el.labels && el.labels[0]) return el.labels[0].textContent||'';
    const sib = el.previousElementSibling;
    if(sib && sib.textContent.trim()) return sib.textContent;
    const row = el.closest('tr,div,li,section');
    if(row){
      for(const cand of row.querySelectorAll('label,td,span,b,strong')){
        if(cand!==el && cand.textContent.trim()) return cand.textContent;
      }
    }
    return '';
  }

  /** Mejor esfuerzo: intenta averiguar a qué hijo/alumno se refiere el
   *  mensaje, mirando campos etiquetados ("Sobre el hijo", "Alumno"...) o,
   *  si no, el propio texto plano del contenedor. Puede devolver null. */
  function findChildHint(container){
    try{
      for(const el of container.querySelectorAll('input,select,textarea')){
        const label = nearestLabelText(el).toLowerCase();
        if(/hijo|alumn/.test(label) && el.value && el.value.trim()) return el.value.trim();
      }
    }catch(e){ /* selectores no soportados en algún contexto raro: ignorar */ }
    const m = (container.innerText||'').match(/(?:sobre el hijo|alumn[oa])\s*:?\s*\n?\s*([^\n]{2,80})/i);
    return m ? m[1].trim() : null;
  }

  function blobToBase64(blob){
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1] || '');
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }

  async function fetchAttachment(url, kind){
    const res = await fetch(url, {credentials:'include'});
    if(!res.ok) return null;
    const blob = await res.blob();
    if(blob.size > MAX_ATTACHMENT_BYTES) return null;
    const base64 = await blobToBase64(blob);
    let mimeType = blob.type;
    if(kind==='pdf' && !mimeType) mimeType = 'application/pdf';
    if(kind==='image' && (!mimeType || !mimeType.startsWith('image/'))) mimeType = guessImageMime(url);
    return {kind, mimeType, base64};
  }
  function guessImageMime(url){
    if(/\.png(\?|$)/i.test(url)) return 'image/png';
    if(/\.gif(\?|$)/i.test(url)) return 'image/gif';
    if(/\.webp(\?|$)/i.test(url)) return 'image/webp';
    return 'image/jpeg';
  }

  async function collectAttachments(container){
    const urls = [];
    for(const img of container.querySelectorAll('img')){
      const w = img.naturalWidth || img.clientWidth || 0, h = img.naturalHeight || img.clientHeight || 0;
      if(w>=40 && h>=40 && img.src) urls.push({url: img.src, kind:'image'});
    }
    for(const a of container.querySelectorAll('a[href]')){
      if(/\.pdf(\?|#|$)/i.test(a.href)) urls.push({url: a.href, kind:'pdf'});
    }
    const capped = urls.slice(0, MAX_ATTACHMENTS);
    const results = await Promise.all(capped.map(u => fetchAttachment(u.url, u.kind).catch(()=>null)));
    return results.filter(Boolean);
  }

  async function captureMessage(anchorNode){
    const container = findMessageContainer(anchorNode);
    const info = getSelectionInfo();
    const text = buildTextFromContainer(container) || (info ? info.text : '');
    const childHint = findChildHint(container);
    const images = await collectAttachments(container);
    return {text: text.trim(), images, childHint};
  }

  /* ---------------- escaneo automático opcional (selectores CSS) ---------- */
  async function runAutoScan(){
    const {config} = await chrome.storage.sync.get('config');
    const sel = config && config.autoScan;
    if(!sel || !sel.listSelector) return;
    const items = document.querySelectorAll(sel.listSelector);
    if(!items.length) return;
    let panel = document.getElementById('esemtia-autoscan-panel');
    if(!panel){
      panel = document.createElement('div');
      panel.id = 'esemtia-autoscan-panel';
      Object.assign(panel.style, {
        position:'fixed', bottom:'16px', right:'16px', zIndex:2147483647,
        font:'13px system-ui, sans-serif', background:'#111', color:'#fff',
        padding:'10px 14px', borderRadius:'10px', boxShadow:'0 6px 20px rgba(0,0,0,.3)',
        cursor:'pointer', opacity:0.92
      });
      document.body.appendChild(panel);
      panel.addEventListener('click', () => {
        const texts = [...document.querySelectorAll(sel.listSelector)].map(el => {
          const node = sel.textSelector ? el.querySelector(sel.textSelector) : el;
          return node ? node.innerText.trim() : '';
        }).filter(Boolean);
        chrome.storage.session.set({pendingBulkMessages: {texts, capturedAt: Date.now()}});
        chrome.runtime.sendMessage({type:'OPEN_POPUP_WITH_TEXT', text: texts[0]||'', images:[], childHint:null});
      });
    }
    panel.textContent = `📅 ${items.length} mensajes detectados — clic para revisar`;
  }
  const observer = new MutationObserver(() => runAutoScan());
  observer.observe(document.body, {childList:true, subtree:true});
  runAutoScan();
})();
