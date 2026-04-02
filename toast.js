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
  const clean = translateError(s.replace(/^[✅❌⚠️ℹ️]\s*/, ''));
  toast(clean, type);
}

window.toast = toast;

// ── Diccionario de errores Supabase → español ──
const ERROR_MAP = [
  [/invalid login credentials/i,           'Correo o contraseña incorrectos.'],
  [/email not confirmed/i,                  'Debes confirmar tu correo antes de ingresar.'],
  [/user already registered/i,             'Este correo ya está registrado.'],
  [/duplicate key value violates unique/i, 'Ya existe un registro con esos datos.'],
  [/jwt expired/i,                         'Tu sesión expiró. Vuelve a iniciar sesión.'],
  [/invalid jwt/i,                         'Sesión inválida. Vuelve a iniciar sesión.'],
  [/row-level security/i,                  'No tienes permiso para realizar esta acción.'],
  [/foreign key violation/i,               'No se puede eliminar porque tiene registros relacionados.'],
  [/not null violation/i,                  'Faltan campos obligatorios.'],
  [/network|failed to fetch|load failed/i, 'Sin conexión. Verifica tu internet.'],
  [/timeout/i,                             'La operación tardó demasiado. Intenta de nuevo.'],
  [/permission denied/i,                   'No tienes permiso para realizar esta acción.'],
  [/invalid.*email/i,                      'El correo electrónico no es válido.'],
  [/password.*short|at least.*characters/i,'La contraseña es muy corta.'],
];

export function translateError(msg) {
  if (!msg) return 'Ocurrió un error inesperado.';
  for (const [regex, translation] of ERROR_MAP) {
    if (regex.test(msg)) return translation;
  }
  return msg;
}

// ── Modal de confirmación — reemplaza confirm() nativo ──
export function showConfirm(message, { confirmText = 'Confirmar', cancelText = 'Cancelar', danger = true } = {}) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = [
      'position:fixed','inset:0','background:rgba(0,0,0,0.45)',
      'z-index:99998','display:flex','align-items:center','justify-content:center',
      'padding:16px','animation:toastIn 0.2s ease',
    ].join(';');

    const box = document.createElement('div');
    box.style.cssText = [
      'background:white','border-radius:16px','padding:28px 24px','max-width:360px',
      'width:100%','box-shadow:0 20px 60px rgba(0,0,0,0.25)','text-align:center',
    ].join(';');

    box.innerHTML = `
      <div style="font-size:2rem;margin-bottom:12px">${danger ? '⚠️' : 'ℹ️'}</div>
      <p style="font-size:0.95rem;color:#1a2332;line-height:1.6;margin-bottom:20px;font-weight:500">${message.replace(/\n/g,'<br>')}</p>
      <div style="display:flex;gap:10px;justify-content:center">
        <button id="confirm-cancel" style="flex:1;padding:11px 16px;border:1.5px solid #dde3ec;background:white;border-radius:10px;font-size:0.9rem;cursor:pointer;font-weight:500">${cancelText}</button>
        <button id="confirm-ok" style="flex:1;padding:11px 16px;border:none;background:${danger?'#ef4444':'#1e3a5f'};color:white;border-radius:10px;font-size:0.9rem;cursor:pointer;font-weight:600">${confirmText}</button>
      </div>
    `;

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const close = (val) => { overlay.remove(); resolve(val); };
    box.querySelector('#confirm-ok').onclick     = () => close(true);
    box.querySelector('#confirm-cancel').onclick = () => close(false);
    overlay.onclick = (e) => { if (e.target === overlay) close(false); };
  });
}

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
