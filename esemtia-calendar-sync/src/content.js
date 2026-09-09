/* ============================================================================
   content.js — se inyecta SOLO en el dominio de esemtia Connect que el
   usuario autoriza desde Opciones (chrome.scripting.registerContentScripts).

   No conocemos de antemano la estructura HTML real de esemtia Connect, así
   que el mecanismo principal y siempre fiable es:

     1) El usuario selecciona con el ratón el texto del mensaje.
     2) Aparece un botón flotante "📅 Sincronizar con Calendar".
     3) Al pulsarlo, el texto va al popup para revisar la fecha/alerta
        detectada antes de crear el evento.

   Como complemento opcional (mejor esfuerzo, configurable en Opciones con
   selectores CSS), se puede activar un escaneo automático de una lista de
   mensajes si el usuario indica los selectores de su bandeja de entrada.
   ========================================================================== */
(function(){
  const BTN_ID = 'esemtia-sync-floating-btn';

  function removeBtn(){ const b=document.getElementById(BTN_ID); if(b) b.remove(); }

  function showButtonNear(rect, text){
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
    btn.addEventListener('click', () => {
      chrome.runtime.sendMessage({type:'OPEN_POPUP_WITH_TEXT', text});
      removeBtn();
    });
    document.body.appendChild(btn);
  }

  document.addEventListener('mouseup', () => {
    setTimeout(() => {
      const sel = window.getSelection();
      const text = sel ? sel.toString().trim() : '';
      if(text.length >= 12 && sel.rangeCount){
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        if(rect.width || rect.height) showButtonNear(rect, text);
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
        chrome.runtime.sendMessage({type:'OPEN_POPUP_WITH_TEXT', text: texts[0]||''});
      });
    }
    panel.textContent = `📅 ${items.length} mensajes detectados — clic para revisar`;
  }
  const observer = new MutationObserver(() => runAutoScan());
  observer.observe(document.body, {childList:true, subtree:true});
  runAutoScan();
})();
