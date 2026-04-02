// ═══════════════════════════════════════════
// SISTEMA DE TOASTS — reemplaza alert() nativo
// ═══════════════════════════════════════════
const ICONS  = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
const COLORS = { success: '#10b981', error: '#ef4444', warning: '#f59e0b', info: '#1e3a5f' };

function getContainer() {
  let c = document.getElementById('toast-container');
  if (!c) {
    c = document.createElement('div');
    c.id = 'toast-container';
    c.style.cssText = [
      'position:fixed', 'top:16px', 'left:50%', 'transform:translateX(-50%)',
      'z-index:99999', 'display:flex', 'flex-direction:column', 'align-items:center',
      'gap:8px', 'width:min(420px,calc(100vw - 32px))', 'pointer-events:none',
    ].join(';');
    document.body.appendChild(c);
  }
  return c;
}

export function toast(message, type = 'info', duration) {
  const auto = duration ?? (message.length > 80 ? 5500 : 3500);
  const container = getContainer();

  const el = document.createElement('div');
  el.style.cssText = [
    `background:${COLORS[type]}`, 'color:white', 'padding:13px 18px',
    'border-radius:12px', 'box-shadow:0 4px 24px rgba(0,0,0,0.22)',
    'font-size:0.88rem', 'font-weight:500', 'display:flex', 'align-items:flex-start',
    'gap:10px', 'animation:toastIn 0.3s ease', 'line-height:1.5',
    'cursor:pointer', 'word-break:break-word', 'width:100%', 'pointer-events:all',
  ].join(';');
  el.innerHTML = `<span style="flex-shrink:0;font-size:1.05rem">${ICONS[type]}</span><span>${message.replace(/\n/g, '<br>')}</span>`;

  function dismiss() {
    el.style.cssText += ';opacity:0;transform:translateY(-8px);transition:opacity 0.3s,transform 0.3s';
    setTimeout(() => el.remove(), 320);
  }

  el.onclick = dismiss;
  container.appendChild(el);
  setTimeout(dismiss, auto);
}

// Adaptar alert() nativo al sistema de toasts
export function alertToToast(msg) {
  if (!msg) return;
  const s = String(msg);
  const type = s.startsWith('✅') ? 'success'
             : s.startsWith('❌') ? 'error'
             : s.startsWith('⚠️') ? 'warning'
             : 'info';
  // Limpiar emoji inicial
  const clean = s.replace(/^[✅❌⚠️ℹ️]\s*/, '');
  toast(clean, type);
}

window.toast = toast;

// ── Utilidad: envuelve una función async con estado de carga en un botón ──
export function withLoading(btn, fn, loadingText = 'Procesando...') {
  return async function (...args) {
    if (!btn) return fn(...args);
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span style="display:inline-flex;align-items:center;gap:7px;">
      <svg style="animation:spin 0.8s linear infinite" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
      ${loadingText}
    </span>`;
    try { await fn(...args); }
    finally { btn.disabled = false; btn.innerHTML = original; }
  };
}

// CSS para spin (inyectar una vez)
if (!document.getElementById('toast-spin-style')) {
  const s = document.createElement('style');
  s.id = 'toast-spin-style';
  s.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
  document.head.appendChild(s);
}
