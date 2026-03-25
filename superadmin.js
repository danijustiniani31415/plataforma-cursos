import { supabase } from './src/supabaseClient.js';

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
});

// 🪪 RENIEC autocomplete
function configurarRENIEC(idDni, idTipo, idNombres, idApellidos) {
  const inputDni = document.getElementById(idDni);
  if (!inputDni) return;

  inputDni.addEventListener('input', async () => {
    const dni = inputDni.value.trim();
    const tipo = document.getElementById(idTipo)?.value;
    if (tipo !== 'DNI' || dni.length !== 8) return;

    const msgEl = document.getElementById(idDni + '-reniec-msg');
    if (msgEl) msgEl.textContent = '🔍 Buscando...';

    try {
      const res = await fetch('https://wrahjlstautwinxyqcfx.supabase.co/functions/v1/consultar-reniec', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndyYWhqbHN0YXV0d2lueHlxY2Z4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxMTMyNjYsImV4cCI6MjA4ODY4OTI2Nn0.iAbYatXkr5BAplYDhs7vMca2ROjb11uFM0e4619sD4s'
        },
        body: JSON.stringify({ dni, token: 'sk_14199.4hJ9PKMMwKk2amriKg4G7jJ5WZmXmk15' })
      });
      const data = await res.json();
      if (data?.nombres) {
        document.getElementById(idNombres).value = data.nombres;
        document.getElementById(idApellidos).value = `${data.apellidoPaterno} ${data.apellidoMaterno}`;
        if (msgEl) msgEl.textContent = '✅ Datos cargados automáticamente';
      } else {
        if (msgEl) msgEl.textContent = '⚠️ No encontrado — ingresa manualmente.';
      }
    } catch (err) {
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
async function cargarAdmins() {
  const { data } = await supabase
    .from('profiles')
    .select('*, empresas(nombre)')
    .eq('rol', 'admin')
    .order('apellidos');

  const tbody = document.querySelector('#tabla-admins tbody');
  tbody.innerHTML = '';
  data?.forEach(u => {
    tbody.innerHTML += `
      <tr>
        <td>${u.apellidos || ''} ${u.nombres || ''}</td>
        <td>${u.email}</td>
        <td>${u.empresas?.nombre || '—'}</td>
        <td>${u.documento_tipo}: ${u.documento_numero || '—'}</td>
        <td>${u.activo ? '✅ Activo' : '❌ Inactivo'}</td>
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

window.crearAdmin = async function () {
  const nombres      = document.getElementById('admin-nombres').value.trim();
  const apellidos    = document.getElementById('admin-apellidos').value.trim();
  const doc_tipo     = document.getElementById('admin-doc-tipo').value;
  const dni          = document.getElementById('admin-dni').value.trim();
  const email        = document.getElementById('admin-email').value.trim();
  const telefono     = document.getElementById('admin-telefono').value.trim();
  const empresa_id   = document.getElementById('admin-empresa').value;
  const cargo_id     = document.getElementById('admin-cargo').value;
  const fecha_ingreso = document.getElementById('admin-fecha-ingreso').value;

  if (!nombres || !apellidos || !dni || !email || !empresa_id) {
    alert('❌ Completa los campos obligatorios.'); return;
  }

  // Verificar DNI único
  const { data: existe } = await supabase
    .from('profiles')
    .select('id')
    .eq('documento_numero', dni)
    .single();

  if (existe) { alert('❌ Ese número de documento ya está registrado.'); return; }

  // Crear usuario via Edge Function
  const { data: { session } } = await supabase.auth.getSession();
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
      rol:              'admin'
    }
  });

  if (res.error || res.data?.error) {
    alert('❌ ' + (res.data?.error || res.error.message)); return;
  }

  alert(`✅ Administrador creado.\nContraseña inicial: ${dni}`);
  ['admin-nombres','admin-apellidos','admin-dni','admin-email',
   'admin-telefono','admin-fecha-ingreso'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('admin-doc-tipo').value = 'DNI';
  document.getElementById('admin-empresa').value = '';
  document.getElementById('admin-cargo').value = '';
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

window.filtrarUsuarios = function () {
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
};

window.toggleUsuario = async function (id, activo) {
  await supabase.from('profiles').update({ activo: !activo }).eq('id', id);
  await cargarAdmins();
  await cargarTodosUsuarios();
};

// ═══════════════════════════════
// 🗂️ TABS
// ═══════════════════════════════
window.mostrarTab = function (tab) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('activo'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('activo'));
  document.getElementById(`tab-${tab}`).classList.add('activo');
  event.target.classList.add('activo');
};

// 🔓 Cerrar sesión
window.cerrarSesion = async function () {
  await supabase.auth.signOut();
  window.location.href = 'index.html';
};