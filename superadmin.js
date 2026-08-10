import { supabase } from './src/supabaseClient.js';
import { alertToToast, withLoading, showConfirm, fieldValidation } from './toast.js';
const alert = alertToToast;

// Normaliza DNI: elimina espacios/saltos y padea a 8 dígitos con 0 a la izquierda
function normalizarDNI(raw) {
  return String(raw).trim().replace(/[\n\r]/g, '').padStart(8, '0');
}

// ✅ Verificar que sea superadmin
(async () => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) { window.location.href = 'index.html'; return; }

  const { data: perfil } = await supabase
    .from('profiles')
    .select('rol')
    .eq('id', user.id)
    .single();

  if (perfil?.rol !== 'superadmin') {
    alert('Acceso denegado.');
    window.location.href = 'index.html';
  }
})();

// 🔄 Cargar todo al iniciar
window.addEventListener('DOMContentLoaded', async () => {
  await cargarEmpresas();
  await cargarCargos();
  await cargarAdmins();
  await cargarTodosUsuarios();
  configurarRENIEC('admin-dni', 'admin-doc-tipo', 'admin-nombres', 'admin-apellidos');
  initBranding();
});

// 🪪 RENIEC autocomplete
function configurarRENIEC(idDni, idTipo, idNombres, idApellidos) {
  const inputDni = document.getElementById(idDni);
  if (!inputDni) return;

  // Desbloquear al cambiar a CE o Pasaporte
  document.getElementById(idTipo)?.addEventListener('change', () => {
    const tipo = document.getElementById(idTipo).value;
    const nombresEl = document.getElementById(idNombres);
    const apellidosEl = document.getElementById(idApellidos);
    const msgEl = document.getElementById(idDni + '-reniec-msg');
    if (tipo !== 'DNI') {
      nombresEl.disabled = false;
      apellidosEl.disabled = false;
      if (msgEl) msgEl.textContent = '';
    } else {
      nombresEl.disabled = true;
      apellidosEl.disabled = true;
      nombresEl.value = '';
      apellidosEl.value = '';
    }
  });

  inputDni.addEventListener('input', async () => {
    const dni = inputDni.value.trim();
    const tipo = document.getElementById(idTipo)?.value;
    if (tipo !== 'DNI' || dni.length !== 8) return;

    const msgEl = document.getElementById(idDni + '-reniec-msg');
    const nombresEl = document.getElementById(idNombres);
    const apellidosEl = document.getElementById(idApellidos);

    if (msgEl) msgEl.textContent = '🔍 Buscando...';

    try {
      const res = await fetch('https://apiperu.dev/api/dni/' + dni, {
        headers: {
          'Authorization': 'Bearer 53a55fee1ef9db816dc259ca21bcf8ad01ff39190d0c2f830fce23451d90f423',
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      });
      const json = await res.json();
      const data = json.data || json;
      if (data?.nombres) {
        nombresEl.value = data.nombres;
        apellidosEl.value = `${data.apellido_paterno} ${data.apellido_materno}`;
        nombresEl.disabled = false;
        apellidosEl.disabled = false;
        if (msgEl) msgEl.textContent = '✅ Datos cargados automáticamente';
      } else {
        nombresEl.disabled = false;
        apellidosEl.disabled = false;
        if (msgEl) msgEl.textContent = '⚠️ No encontrado — ingresa manualmente.';
      }
    } catch (err) {
      nombresEl.disabled = false;
      apellidosEl.disabled = false;
      if (msgEl) msgEl.textContent = '⚠️ Error — ingresa manualmente.';
    }
  });
}

// ═══════════════════════════════
// 🏢 EMPRESAS
// ═══════════════════════════════
async function cargarEmpresas() {
  const { data: empresas } = await supabase
    .from('empresas')
    .select('*')
    .order('nombre');

  // Llenar tabla
  const tbody = document.querySelector('#tabla-empresas tbody');
  tbody.innerHTML = '';
  empresas?.forEach(e => {
    tbody.innerHTML += `
      <tr>
        <td>${e.nombre}</td>
        <td>${e.ruc}</td>
        <td>${e.activo ? '✅ Activa' : '❌ Inactiva'}</td>
        <td>
          <button onclick="toggleEmpresa('${e.id}', ${e.activo})" 
            style="padding:5px 10px; background:${e.activo ? '#dc3545' : '#28a745'}; 
                   color:white; border:none; border-radius:4px; cursor:pointer;">
            ${e.activo ? 'Desactivar' : 'Activar'}
          </button>
        </td>
      </tr>`;
  });

  // Llenar selectores
  const selAdmin = document.getElementById('admin-empresa');
  const selFiltro = document.getElementById('filtro-empresa');
  selAdmin.innerHTML = '<option value="">-- Selecciona empresa --</option>';
  selFiltro.innerHTML = '<option value="">Todas las empresas</option>';
  empresas?.forEach(e => {
    selAdmin.innerHTML += `<option value="${e.id}">${e.nombre}</option>`;
    selFiltro.innerHTML += `<option value="${e.id}">${e.nombre}</option>`;
  });
}

window.crearEmpresa = async function () {
  const nombre = document.getElementById('empresa-nombre').value.trim();
  const ruc = document.getElementById('empresa-ruc').value.trim();

  if (!nombre || !ruc) { alert('Completa nombre y RUC.'); return; }
  if (!/^\d{11}$/.test(ruc)) { alert('❌ El RUC debe tener 11 dígitos.'); return; }

  const { error } = await supabase.from('empresas').insert({ nombre, ruc });
  if (error) {
    alert(error.message.includes('unique') ? '❌ Ese RUC ya existe.' : '❌ ' + error.message);
    return;
  }
  alert('✅ Empresa creada.');
  document.getElementById('empresa-nombre').value = '';
  document.getElementById('empresa-ruc').value = '';
  await cargarEmpresas();
};

window.toggleEmpresa = async function (id, activo) {
  await supabase.from('empresas').update({ activo: !activo }).eq('id', id);
  await cargarEmpresas();
};

// ═══════════════════════════════
// 💼 CARGOS
// ═══════════════════════════════
async function cargarCargos() {
  const { data: cargos } = await supabase
    .from('cargos')
    .select('*')
    .order('nombre');

  const tbody = document.querySelector('#tabla-cargos tbody');
  tbody.innerHTML = '';
  cargos?.forEach(c => {
    tbody.innerHTML += `
      <tr>
        <td>${c.nombre}</td>
        <td>${c.activo ? '✅ Activo' : '❌ Inactivo'}</td>
        <td>
          <button onclick="toggleCargo('${c.id}', ${c.activo})"
            style="padding:5px 10px; background:${c.activo ? '#dc3545' : '#28a745'};
                   color:white; border:none; border-radius:4px; cursor:pointer;">
            ${c.activo ? 'Desactivar' : 'Activar'}
          </button>
        </td>
      </tr>`;
  });

  // Llenar selector de cargos en form admin
  const selCargo = document.getElementById('admin-cargo');
  selCargo.innerHTML = '<option value="">-- Selecciona cargo --</option>';
  cargos?.filter(c => c.activo).forEach(c => {
    selCargo.innerHTML += `<option value="${c.id}">${c.nombre}</option>`;
  });
}

window.crearCargo = async function () {
  const nombre = document.getElementById('cargo-nombre').value.trim();
  if (!nombre) { alert('Ingresa el nombre del cargo.'); return; }

  const { error } = await supabase.from('cargos').insert({ nombre });
  if (error) {
    alert(error.message.includes('unique') ? '❌ Ese cargo ya existe.' : '❌ ' + error.message);
    return;
  }
  alert('✅ Cargo agregado.');
  document.getElementById('cargo-nombre').value = '';
  await cargarCargos();
};

window.toggleCargo = async function (id, activo) {
  await supabase.from('cargos').update({ activo: !activo }).eq('id', id);
  await cargarCargos();
};

// ═══════════════════════════════
// 👤 ADMINS
// ═══════════════════════════════
let _adminsCache = [];

async function cargarAdmins() {
  const { data } = await supabase
    .from('profiles')
    .select('*, empresas(nombre)')
    .in('rol', ['admin', 'gestor'])
    .order('apellidos');

  _adminsCache = data || [];
  const cont = document.getElementById('lista-admins');
  cont.innerHTML = '';

  if (!_adminsCache.length) {
    cont.innerHTML = '<p style="color:#888;padding:12px;">No hay administradores ni gestores registrados.</p>';
    return;
  }

  cont.innerHTML = _adminsCache.map((u, idx) => `
    <div class="admin-row">
      <div class="admin-row-info">
        <div class="admin-avatar">${(u.apellidos || '?').trim().charAt(0)}${(u.nombres || '').trim().charAt(0)}</div>
        <div>
          <div class="admin-nombre">${u.apellidos || ''} ${u.nombres || ''}
            <span class="${u.rol === 'gestor' ? 'badge-gestor' : 'badge-admin2'}">${u.rol === 'gestor' ? 'Gestor' : 'Admin'}</span>
          </div>
          <div class="admin-meta">${u.empresas?.nombre || '—'} · ${u.documento_tipo}: ${u.documento_numero || '—'} · ${u.email || 'sin correo'}</div>
        </div>
      </div>
      <span class="${u.activo ? 'badge-activo' : 'badge-inactivo'}">${u.activo ? 'Activo' : 'Inactivo'}</span>
      <div class="admin-row-actions">
        <button class="btn-fila" onclick="abrirGestionSedes(${idx})" title="Elegir qué sedes puede ver">🌐 Sedes</button>
        <button class="btn-fila" style="background:#0d6efd;color:#fff;" onclick="cambiarEmailAdmin(${idx})" title="Cambiar correo de acceso">✉️ Cambiar correo</button>
        <button class="btn-fila" style="background:#e65100;color:#fff;" onclick="enviarResetPasswordAdmin(${idx})" title="Envía un correo para que fije su propia contraseña">📧 Cambiar contraseña</button>
        <button class="btn-fila" style="background:#6f42c1;color:#fff;" onclick="hacerSuperadmin(${idx})" title="Dar acceso total de superadmin">⭐ Hacer superadmin</button>
        <button class="btn-fila" style="background:${u.activo ? '#dc3545' : '#28a745'};color:#fff;" onclick="toggleUsuario('${u.id}', ${u.activo})">
          ${u.activo ? 'Desactivar' : 'Activar'}
        </button>
        <button class="btn-fila" style="background:#6c757d;color:#fff;" onclick="eliminarAdmin('${u.id}', '${u.apellidos} ${u.nombres}')">🗑️ Eliminar</button>
      </div>
    </div>`).join('');
}

// Cambiar el correo de acceso de un admin/gestor — sincroniza el email de Auth vía la Edge Function.
window.cambiarEmailAdmin = async function (idx) {
  const u = _adminsCache[idx];
  if (!u) return;
  const nuevoEmail = prompt(`Correo de ${u.apellidos}, ${u.nombres} (con este ingresa y recupera su contraseña):`, u.email || '');
  if (nuevoEmail === null) return;
  if (!nuevoEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nuevoEmail)) {
    alert('❌ Correo inválido. El correo es obligatorio para administradores y gestores.');
    return;
  }

  const { data, error } = await supabase.functions.invoke('actualizar-usuario', {
    body: { usuario_id: u.id, updates: { email: nuevoEmail } },
  });
  if (error || data?.error) { alert('❌ ' + (data?.error || error.message)); return; }
  alert('✅ Correo actualizado. Ya puede ingresar y recuperar su contraseña con ese correo.');
  await cargarAdmins();
};

// Envía un correo para que el propio admin/gestor fije su contraseña — nunca se resetea a DNI (inseguro).
window.enviarResetPasswordAdmin = async function (idx) {
  const u = _adminsCache[idx];
  if (!u) return;
  if (!u.email) {
    alert('❌ Esta cuenta no tiene correo registrado. Usa "✉️ Cambiar correo" primero.');
    return;
  }
  if (!await showConfirm(
    `¿Enviar un correo a ${u.email} para que ${u.apellidos}, ${u.nombres} cambie su contraseña?`,
    { confirmText: 'Sí, enviar' }
  )) return;

  const { error } = await supabase.auth.resetPasswordForEmail(u.email, {
    redirectTo: window.location.origin + '/cambiar-clave.html',
  });
  if (error) { alert('❌ ' + error.message); return; }
  alert(`✅ Correo enviado a ${u.email}.`);
};

// Dar rol de superadmin — acceso total al sistema, acción sensible.
window.hacerSuperadmin = async function (idx) {
  const u = _adminsCache[idx];
  if (!u) return;
  if (!await showConfirm(
    `¿Dar acceso de SUPERADMIN a ${u.apellidos}, ${u.nombres}?\n` +
    `Esta persona podrá ver y administrar TODAS las empresas del sistema, no solo "${u.empresas?.nombre || 'su empresa'}".`,
    { confirmText: 'Sí, dar superadmin' }
  )) return;

  const { data, error } = await supabase.functions.invoke('actualizar-usuario', {
    body: { usuario_id: u.id, updates: { rol: 'superadmin' } },
  });
  if (error || data?.error) { alert('❌ ' + (data?.error || error.message)); return; }
  alert(`✅ ${u.apellidos}, ${u.nombres} ahora es superadmin.`);
  await cargarAdmins();
  await cargarTodosUsuarios();
};

// ── Gestión de sedes por admin ──────────────────────────────────────────────
window.abrirGestionSedes = async function (idx) {
  const u = _adminsCache[idx];
  if (!u) return;

  const modal = document.getElementById('modal-sedes');
  const cont = document.getElementById('modal-sedes-lista');
  document.getElementById('modal-sedes-nombre').textContent = `${u.apellidos}, ${u.nombres}`;
  cont.innerHTML = '<p style="color:#888;">Cargando sedes...</p>';
  modal.style.display = 'flex';
  modal.dataset.usuarioIdx = idx;

  const [{ data: sedesEmpresa }, { data: sedesCursos }, { data: sedesActuales }] = await Promise.all([
    supabase.from('perfil_sede').select('sede').eq('empresa_id', u.empresa_id),
    supabase.from('cursos').select('sede').eq('empresa_id', u.empresa_id),
    supabase.from('perfil_sede').select('sede, activo').eq('profile_id', u.id),
  ]);

  const todasSedes = Array.from(new Set([
    ...(sedesEmpresa || []).map(s => s.sede),
    ...(sedesCursos  || []).map(s => s.sede),
  ].filter(Boolean))).sort();

  const activasSet = new Set((sedesActuales || []).filter(s => s.activo).map(s => s.sede));

  if (!todasSedes.length) {
    cont.innerHTML = '<p style="color:#888;">Esta empresa todavía no tiene sedes registradas (sin cursos ni asignaciones).</p>';
    return;
  }

  cont.innerHTML = todasSedes.map(s => `
    <label style="display:flex; align-items:center; gap:8px; padding:7px 0; font-size:0.92rem;">
      <input type="checkbox" class="chk-modal-sede" value="${s}" ${activasSet.has(s) ? 'checked' : ''} style="width:16px;height:16px;" />
      ${s}
    </label>`).join('');
};

window.cerrarModalSedes = function () {
  document.getElementById('modal-sedes').style.display = 'none';
};

window.guardarSedesAdmin = async function () {
  const modal = document.getElementById('modal-sedes');
  const u = _adminsCache[modal.dataset.usuarioIdx];
  if (!u) return;

  const { data: sedesActuales } = await supabase.from('perfil_sede').select('sede, activo').eq('profile_id', u.id);
  const activasAntes = new Set((sedesActuales || []).filter(s => s.activo).map(s => s.sede));

  const marcadasAhora = new Set(
    Array.from(document.querySelectorAll('.chk-modal-sede:checked')).map(c => c.value)
  );

  const agregarSedes = Array.from(marcadasAhora).filter(s => !activasAntes.has(s));
  const quitarSedes   = Array.from(activasAntes).filter(s => !marcadasAhora.has(s));

  if (!agregarSedes.length && !quitarSedes.length) { cerrarModalSedes(); return; }

  const { data, error } = await supabase.functions.invoke('actualizar-usuario', {
    body: { usuario_id: u.id, updates: {}, agregarSedes, quitarSedes },
  });
  if (error || data?.error) { alert('❌ ' + (data?.error || error.message)); return; }

  alert(`✅ Sedes actualizadas para ${u.apellidos}, ${u.nombres}.`);
  cerrarModalSedes();
};

window.eliminarAdmin = async function (id, nombre) {
  if (!await showConfirm(`¿Eliminar al administrador "${nombre}"?\nEsta acción no se puede deshacer.`, { confirmText: 'Eliminar' })) return;

  const { error } = await supabase.from('profiles').delete().eq('id', id);
  if (error) { alert('❌ Error al eliminar: ' + error.message); return; }

  alert('✅ Administrador eliminado.');
  await cargarAdmins();
  await cargarTodosUsuarios();
};

window.crearAdmin = async function () {
  const nombres      = document.getElementById('admin-nombres').value.trim();
  const apellidos    = document.getElementById('admin-apellidos').value.trim();
  const doc_tipo     = document.getElementById('admin-doc-tipo').value;
  const dniInput     = document.getElementById('admin-dni').value.trim();
  const email        = document.getElementById('admin-email').value.trim();
  const telefono     = document.getElementById('admin-telefono').value.trim();
  const empresa_id   = document.getElementById('admin-empresa').value;
  const cargo_id     = document.getElementById('admin-cargo').value;
  const fecha_ingreso = document.getElementById('admin-fecha-ingreso').value;

  if (!nombres || !apellidos || !dniInput || !email || !empresa_id) {
    alert('❌ Completa los campos obligatorios.'); return;
  }

  // Normaliza a 8 dígitos con cero inicial — así la contraseña queda bien desde la creación.
  const dni = normalizarDNI(dniInput);

  // Verificar DNI único
  const { data: existe } = await supabase
    .from('profiles')
    .select('id')
    .eq('documento_numero', dni)
    .single();

  if (existe) { alert('❌ Ese número de documento ya está registrado.'); return; }

  // Crear usuario via Edge Function
  const res = await supabase.functions.invoke('crear-usuario', {
    body: {
      email,
      password:         dni,
      nombres,
      apellidos,
      documento_tipo:   doc_tipo,
      documento_numero: dni,
      telefono:         telefono || null,
      empresa_id,
      cargo_id:         cargo_id || null,
      fecha_ingreso:    fecha_ingreso || null,
      rol:              document.getElementById('admin-rol').value || 'admin'
    }
  });

  if (res.error || res.data?.error) {
    alert('❌ ' + (res.data?.error || res.error.message)); return;
  }

  const rolCreado = document.getElementById('admin-rol').value;
  alert(`✅ ${rolCreado === 'gestor' ? 'Gestor de Personal' : 'Administrador'} creado.\nContraseña inicial: ${dni}`);
  ['admin-nombres','admin-apellidos','admin-dni','admin-email',
   'admin-telefono','admin-fecha-ingreso'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('admin-doc-tipo').value = 'DNI';
  document.getElementById('admin-empresa').value = '';
  document.getElementById('admin-cargo').value = '';
  document.getElementById('admin-nombres').disabled = true;
  document.getElementById('admin-apellidos').disabled = true;
  document.getElementById('admin-dni-reniec-msg').textContent = '';
  document.getElementById('admin-rol').value = 'admin';
  await cargarAdmins();
};

// ═══════════════════════════════
// 👥 TODOS LOS USUARIOS
// ═══════════════════════════════
let todosUsuarios = [];

async function cargarTodosUsuarios() {
  const { data } = await supabase
    .from('profiles')
    .select('*, empresas(nombre), cargos(nombre)')
    .order('apellidos');

  todosUsuarios = data || [];
  renderizarUsuarios(todosUsuarios);
}

function renderizarUsuarios(usuarios) {
  const tbody = document.querySelector('#tabla-usuarios tbody');
  tbody.innerHTML = '';

  if (!usuarios.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:24px;color:#888;">
      No se encontraron usuarios.</td></tr>`;
    return;
  }

  usuarios.forEach(u => {
    const rolBadge = u.rol === 'superadmin'
      ? `<span class="badge-superadmin">Superadmin</span>`
      : u.rol === 'admin'
      ? `<span class="badge-admin">Admin</span>`
      : `<span class="badge-trabajador">Trabajador</span>`;

    tbody.innerHTML += `
      <tr>
        <td>${u.apellidos || ''} ${u.nombres || ''}</td>
        <td>${u.email}</td>
        <td>${u.empresas?.nombre || '—'}</td>
        <td>${u.cargos?.nombre || '—'}</td>
        <td>${rolBadge}</td>
        <td>${u.activo ? '✅' : '❌'}</td>
        <td>
          <button onclick="toggleUsuario('${u.id}', ${u.activo})"
            style="padding:5px 10px; background:${u.activo ? '#dc3545' : '#28a745'};
                   color:white; border:none; border-radius:4px; cursor:pointer;">
            ${u.activo ? 'Desactivar' : 'Activar'}
          </button>
        </td>
      </tr>`;
  });
}

let _filtrarDebounce = null;
window.filtrarUsuarios = function () {
  clearTimeout(_filtrarDebounce);
  _filtrarDebounce = setTimeout(() => {
    const texto = document.getElementById('buscar-usuario').value.toLowerCase();
    const empresaId = document.getElementById('filtro-empresa').value;

    const filtrados = todosUsuarios.filter(u => {
      const coincideTexto =
        (u.nombres || '').toLowerCase().includes(texto) ||
        (u.apellidos || '').toLowerCase().includes(texto) ||
        (u.email || '').toLowerCase().includes(texto) ||
        (u.documento_numero || '').includes(texto);
      const coincideEmpresa = !empresaId || u.empresa_id === empresaId;
      return coincideTexto && coincideEmpresa;
    });

    renderizarUsuarios(filtrados);
  }, 300);
};

window.toggleUsuario = async function (id, activo) {
  await supabase.from('profiles').update({ activo: !activo }).eq('id', id);
  await cargarAdmins();
  await cargarTodosUsuarios();
};

// ═══════════════════════════════
// 🗂️ TABS
// ═══════════════════════════════
window.mostrarTab = function (tab, btn) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('activo'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('activo'));
  document.getElementById(`tab-${tab}`).classList.add('activo');
  if (btn) btn.classList.add('activo');
};

// 🔓 Cerrar sesión
window.cerrarSesion = async function () {
  await supabase.auth.signOut();
  window.location.href = 'index.html';
};

// ═══════════════════════════════
// 🎨 BRANDING POR EMPRESA
// ═══════════════════════════════
async function initBranding() {
  const { data: empresas } = await supabase.from('empresas').select('id, nombre').eq('activo', true).order('nombre');
  const sel = document.getElementById('branding-empresa');
  if (!sel) return;
  sel.innerHTML = '<option value="">-- Selecciona una empresa --</option>';
  (empresas || []).forEach(e => sel.insertAdjacentHTML('beforeend', `<option value="${e.id}">${e.nombre}</option>`));

  sel.addEventListener('change', async () => {
    const id = sel.value;
    if (!id) return;
    const { data } = await supabase.from('empresas').select('logo_url, color_primario, color_secundario').eq('id', id).single();

    const logo   = data?.logo_url       || '';
    const color1 = data?.color_primario  || '#1e3a5f';
    const color2 = data?.color_secundario|| '#c9a84c';

    document.getElementById('branding-logo').value              = logo;
    document.getElementById('branding-color-primario').value    = color1;
    document.getElementById('branding-color-primario-hex').value= color1;
    document.getElementById('branding-color-secundario').value  = color2;
    document.getElementById('branding-color-secundario-hex').value = color2;
    actualizarPreviewLogo(logo);
  });

  // Sincronizar color picker ↔ texto hex
  ['primario', 'secundario'].forEach(tipo => {
    const picker = document.getElementById(`branding-color-${tipo}`);
    const hex    = document.getElementById(`branding-color-${tipo}-hex`);
    picker.addEventListener('input', () => { hex.value = picker.value; });
    hex.addEventListener('input',   () => { if (/^#[0-9a-fA-F]{6}$/.test(hex.value)) picker.value = hex.value; });
  });

  document.getElementById('branding-logo').addEventListener('input', e => actualizarPreviewLogo(e.target.value));
}

function actualizarPreviewLogo(url) {
  const img  = document.getElementById('branding-logo-preview');
  const placeholder = document.getElementById('branding-logo-placeholder');
  if (url) {
    img.src     = url;
    img.style.display = 'block';
    placeholder.style.display = 'none';
    img.onerror = () => { img.style.display = 'none'; placeholder.style.display = 'block'; };
  } else {
    img.style.display = 'none';
    placeholder.style.display = 'block';
  }
}

window.guardarBranding = async function () {
  const id      = document.getElementById('branding-empresa').value;
  const logo    = document.getElementById('branding-logo').value.trim();
  const color1  = document.getElementById('branding-color-primario-hex').value.trim() ||
                  document.getElementById('branding-color-primario').value;
  const color2  = document.getElementById('branding-color-secundario-hex').value.trim() ||
                  document.getElementById('branding-color-secundario').value;
  const msg     = document.getElementById('msg-branding');

  if (!id) { alert('Selecciona una empresa.'); return; }

  const { error } = await supabase.from('empresas').update({
    logo_url:          logo    || null,
    color_primario:    color1  || null,
    color_secundario:  color2  || null,
  }).eq('id', id);

  msg.textContent = error ? '❌ ' + error.message : '✅ Branding guardado correctamente.';
  msg.style.color = error ? '#dc3545' : '#198754';
};

// Cerrar cualquier modal al hacer clic fuera de su contenido (en el fondo oscuro).
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.style.display = 'none';
  }
});

// ═══════════════════════════════════════════════
// ⏳ SPINNERS EN BOTONES
// ═══════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  const wrap = (selector, fn, texto) => {
    const btn = document.querySelector(selector);
    if (btn && window[fn]) window[fn] = withLoading(btn, window[fn], texto);
  };
  wrap('button[onclick="crearEmpresa()"]',    'crearEmpresa',    'Creando...');
  wrap('button[onclick="crearAdmin()"]',       'crearAdmin',      'Creando...');
  wrap('button[onclick="crearCargo()"]',       'crearCargo',      'Creando...');
  wrap('button[onclick="guardarBranding()"]',  'guardarBranding', 'Guardando...');

  // Validación en tiempo real — empresa
  fieldValidation([
    { id: 'empresa-nombre', validate: v => !v.trim() ? 'El nombre es obligatorio.' : null },
    {
      id: 'empresa-ruc',
      validate: v => !v ? 'El RUC es obligatorio.'
                  : !/^\d{11}$/.test(v) ? 'El RUC debe tener exactamente 11 dígitos.' : null,
    },
  ]);

  // Validación en tiempo real — admin
  fieldValidation([
    { id: 'admin-dni',    validate: v => !v ? 'El documento es obligatorio.'
                                        : v.length < 8 ? 'Mínimo 8 caracteres.' : null },
    { id: 'admin-email',  validate: v => !v ? 'El correo es obligatorio.'
                                        : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? 'Correo no válido.' : null },
    { id: 'cargo-nombre', validate: v => !v.trim() ? 'El nombre del cargo es obligatorio.' : null },
  ]);
});