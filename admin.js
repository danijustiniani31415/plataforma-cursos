import { supabase } from './src/supabaseClient.js';
import { alertToToast, withLoading, showConfirm, fieldValidation } from './toast.js';
import { buildHtmlCertificado, generarCertificadoPDFBlob, generarCertificadoCanvas, RBD_LOGO_URL, FIRMA_RBD_URL } from './certificado.js';
const alert = alertToToast;

// Normaliza DNI: elimina espacios/saltos y padea a 8 dígitos con 0 a la izquierda
function normalizarDNI(raw) {
  return String(raw).trim().replace(/[\n\r]/g, '').padStart(8, '0');
}

// Extrae el ID (11 caracteres) de un link de YouTube sin importar el formato:
// watch?v=, youtu.be/, embed/, shorts/, m.youtube.com, con o sin &si=/&t=/&list= al final.
function extraerIdYoutube(url) {
  const match = String(url).match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

// Ejecuta un query Supabase con .in(col, values) en chunks, en paralelo,
// para evitar exceder el límite de URL (~8-16KB) cuando values es grande.
// queryFn recibe un sub-array y debe retornar { data, error }.
async function chunkedInQuery(values, chunkSize, queryFn) {
  if (!values?.length) return { data: [], error: null };
  const chunks = [];
  for (let i = 0; i < values.length; i += chunkSize) {
    chunks.push(values.slice(i, i + chunkSize));
  }
  const results = await Promise.all(chunks.map(queryFn));
  for (const r of results) {
    if (r?.error) return { data: null, error: r.error };
  }
  return { data: results.flatMap(r => r?.data || []), error: null };
}

// Trae TODAS las filas de un query paginando de a 1000 (límite por defecto de
// PostgREST) — buildQuery debe devolver un query builder NUEVO cada vez que se
// invoca (no reutilizar uno ya encadenado con .range()).
async function fetchAllRows(buildQuery, pageSize = 1000) {
  let all = [];
  let from = 0;
  while (true) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) return { data: null, error };
    all = all.concat(data || []);
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return { data: all, error: null };
}

// Select buscable con Tom Select
function initSelectBuscable(id) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el.tomselect) { el.tomselect.sync(); return; }
  new window.TomSelect(el, { allowEmptyOption: true, maxOptions: 300 });
}

let _debounceTrab = null;
window.buscarTrabajadoresDebounced = function () {
  clearTimeout(_debounceTrab);
  _debounceTrab = setTimeout(() => cargarTrabajadores(0), 350);
};

let _debounceStaff = null;
window.buscarStaffDebounced = function () {
  clearTimeout(_debounceStaff);
  _debounceStaff = setTimeout(() => cargarStaff(), 350);
};

let empresaAdminId = null;
let empresaAdminNombre = null;
let empresaAdminRuc = null;
let sedeAdminActiva = null;
let sedesAdminDisponibles = [];
let currentUserId = null;
let cargosGlobalesCache = [];

// Fila por sede: checkbox + su propio selector de cargo (el puesto puede cambiar entre sedes).
// Ninguna sede queda marcada por defecto — se elige explícitamente.
function pintarCheckboxesSedes() {
  const cont = document.getElementById('nuevo-sedes-checks');
  if (!cont) return;
  const lista = sedesAdminDisponibles.length ? sedesAdminDisponibles : ['ANTAMINA'];
  const opcionesCargo = cargosGlobalesCache.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('');
  cont.innerHTML = lista.map(s => `
    <div style="display:flex; align-items:center; gap:10px; margin-bottom:6px; flex-wrap:wrap;">
      <label style="display:flex; align-items:center; gap:6px; font-size:0.88rem; min-width:120px;">
        <input type="checkbox" class="chk-nuevo-sede" value="${s}" onchange="toggleCargoPorSede(this)" />
        ${s}
      </label>
      <select class="sel-cargo-por-sede" data-sede="${s}" disabled
              style="padding:7px 10px; border:1px solid #ddd; border-radius:6px; font-size:0.85rem; flex:1; min-width:180px; opacity:0.5;">
        <option value="">-- Cargo en ${s} --</option>
        ${opcionesCargo}
      </select>
    </div>`).join('');
}

window.toggleCargoPorSede = function (chk) {
  const sel = chk.closest('div').querySelector('.sel-cargo-por-sede');
  sel.disabled = !chk.checked;
  sel.style.opacity = chk.checked ? '1' : '0.5';
  if (!chk.checked) sel.value = '';
  actualizarEstadoBotonNuevoTrabajador();
};

// ═══════════════════════════════
// 🏢 Resolver sede activa del admin (una o varias)
// ═══════════════════════════════
async function resolverSedeAdmin(userId) {
  const sedeGuardada = sessionStorage.getItem('sedeAdminActiva');

  const { data: sedes } = await supabase
    .from('perfil_sede')
    .select('sede')
    .eq('profile_id', userId)
    .eq('activo', true);

  if (!sedes || sedes.length === 0) {
    sedeAdminActiva = sedeGuardada || 'ANTAMINA';
    sedesAdminDisponibles = [sedeAdminActiva];
    pintarCheckboxesSedes();
    return;
  }

  sedesAdminDisponibles = sedes.map(s => s.sede);

  if (sedeGuardada && sedes.some(s => s.sede === sedeGuardada)) {
    sedeAdminActiva = sedeGuardada;
  } else {
    sedeAdminActiva = sedes[0].sede;
    sessionStorage.setItem('sedeAdminActiva', sedeAdminActiva);
  }

  pintarCheckboxesSedes();

  // Si el admin gestiona más de una sede, mostrar selector en el header
  if (sedes.length > 1) {
    const cont = document.getElementById('info-empresa-header');
    if (cont && !document.getElementById('selector-sede-admin')) {
      const sel = document.createElement('select');
      sel.id = 'selector-sede-admin';
      sel.title = 'Clic para cambiar de sede';
      sel.style.display = 'block';
      sel.style.width = '100%';
      sel.style.marginTop = '6px';
      sel.style.padding = '6px 26px 6px 8px';
      sel.style.borderRadius = '6px';
      sel.style.border = '1px solid #dde3ec';
      sel.style.background = "#f3f5f8 url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%231e3a5f' d='M6 8L1 3h10z'/%3E%3C/svg%3E\") no-repeat right 8px center";
      sel.style.appearance = 'none';
      sel.style.webkitAppearance = 'none';
      sel.style.cursor = 'pointer';
      sel.style.color = '#1e3a5f';
      sel.style.fontSize = '0.76rem';
      sel.style.fontWeight = '600';
      sedes.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.sede;
        opt.textContent = s.sede;
        opt.selected = s.sede === sedeAdminActiva;
        sel.appendChild(opt);
      });
      sel.onchange = () => {
        sessionStorage.setItem('sedeAdminActiva', sel.value);
        location.reload();
      };
      cont.appendChild(sel);
    }
  }
}

// ═══════════════════════════════
// 🔐 Validar admin + cargar datos
// ═══════════════════════════════
(async () => {
  let user = null;

  for (let i = 0; i < 5; i++) {
    const { data } = await supabase.auth.getUser();
    if (data.user) { user = data.user; break; }
    await new Promise(r => setTimeout(r, 300));
  }

  if (!user) {
    alert("⚠️ No autenticado.");
    window.location.href = "index.html";
    return;
  }

  currentUserId = user.id;

  const { data: perfil } = await supabase
    .from("profiles")
    .select("rol")
    .eq("id", user.id)
    .single();

  const rolesPermitidos = ["admin", "superadmin", "gestor"];
  if (!rolesPermitidos.includes(perfil?.rol)) {
    alert("Acceso denegado. Solo administradores.");
    window.location.href = "index.html";
    return;
  }

  await cargarDatosAdmin();

  // Si al restaurar la última pantalla (justo al abrir la página) se necesitaba una función
  // de este archivo antes de que terminara de cargar, se saltó — la disparamos de nuevo ahora
  // que ya está todo listo.
  const tabActivoAlCargar = document.querySelector('.tab-panel.activo')?.id.replace('tab-', '');
  if (tabActivoAlCargar) window.mostrarTab?.(tabActivoAlCargar);

  // Gestor de Personal: solo ve la sección Trabajadores, sin "Crear gestor"
  if (perfil?.rol === "gestor") {
    document.querySelectorAll('.sidebar-nav .nav-item').forEach(btn => {
      if (btn.id !== 'seccion-btn-trabajadores') btn.style.display = 'none';
    });
    document.getElementById('subtab-btn-crear-gestor')?.remove();
    mostrarTab('importar');
  }
})();

// ═══════════════════════════════
// 🏢 Cargar datos del admin
// ═══════════════════════════════
async function cargarDatosAdmin() {
  const { data: { user } } = await supabase.auth.getUser();

  const { data: perfil } = await supabase
    .from('profiles')
    .select('empresa_id, empresas(nombre, ruc)')
    .eq('id', user.id)
    .single();

  // Cargar cargos primero — pintarCheckboxesSedes() (dentro de resolverSedeAdmin) los necesita
  // para armar el selector de cargo por sede.
  const { data: cargos } = await supabase
    .from('cargos')
    .select('*')
    .eq('activo', true)
    .order('nombre');
  cargosGlobalesCache = cargos || [];

  if (perfil?.empresa_id) {
    empresaAdminId = perfil.empresa_id;
    empresaAdminNombre = perfil.empresas?.nombre;
    empresaAdminRuc = perfil.empresas?.ruc;

    document.getElementById('info-empresa-header').textContent = `🏢 ${empresaAdminNombre}`;
    await resolverSedeAdmin(user.id);
    document.getElementById('info-empresa').innerHTML = `
      <div class="info-box info-box--linea" style="margin-bottom:14px;">
        🏢 <strong>${empresaAdminNombre}</strong> — RUC: ${empresaAdminRuc}
      </div>
    `;
  } else {
    document.getElementById('info-empresa').innerHTML = `
      <div style="background:#fff3cd; padding:12px; border-radius:8px;
                  border-left:4px solid #ffc107; margin-bottom:15px;">
        ⚠️ Tu usuario no tiene empresa asignada. Contacta al superadmin.
      </div>
    `;
  }

  configurarRENIEC('nuevo-dni', 'nuevo-doc-tipo', 'nuevo-nombres', 'nuevo-apellidos', actualizarEstadoBotonNuevoTrabajador);
  configurarRENIEC('gestor-dni', 'gestor-doc-tipo', 'gestor-nombres', 'gestor-apellidos', actualizarEstadoBotonNuevoGestor);
  document.getElementById('gestor-email')?.addEventListener('input', actualizarEstadoBotonNuevoGestor);
  actualizarEstadoBotonNuevoTrabajador();
  actualizarEstadoBotonNuevoGestor();

  // Cargar cursos en los selects que los necesitan (bulk cert)
  const { data: cursosForSelect } = await supabase
    .from('cursos').select('id, titulo').eq('sede', sedeAdminActiva).order('titulo');
  const selBulkCurso = document.getElementById('cert-bulk-curso');
  if (selBulkCurso) {
    (cursosForSelect || []).forEach(c => {
      selBulkCurso.innerHTML += `<option value="${c.id}">${c.titulo}</option>`;
    });
    initSelectBuscable('cert-bulk-curso');
  }
}

// 🪪 RENIEC autocomplete
function configurarRENIEC(idDni, idTipo, idNombres, idApellidos, onUpdate) {
  const inputDni = document.getElementById(idDni);
  if (!inputDni) return;

  const nombresEl = document.getElementById(idNombres);
  const apellidosEl = document.getElementById(idApellidos);
  nombresEl?.addEventListener('input', () => onUpdate?.());
  apellidosEl?.addEventListener('input', () => onUpdate?.());

  // Desbloquear al cambiar a CE o Pasaporte
  document.getElementById(idTipo)?.addEventListener('change', () => {
    const tipo = document.getElementById(idTipo).value;
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
    onUpdate?.();
  });

  inputDni.addEventListener('input', async () => {
    onUpdate?.();
    const dni = inputDni.value.trim();
    const tipo = document.getElementById(idTipo)?.value;
    if (tipo !== 'DNI' || dni.length !== 8) return;

    const msgEl = document.getElementById(idDni + '-reniec-msg');

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
    onUpdate?.();
  });
}

// Muestra el botón de guardar solo cuando los campos obligatorios están completos —
// evita que el usuario intente guardar un formulario a medio llenar.
window.actualizarEstadoBotonNuevoTrabajador = function () {
  const dni = document.getElementById('nuevo-dni')?.value.trim();
  const nombres = document.getElementById('nuevo-nombres')?.value.trim();
  const apellidos = document.getElementById('nuevo-apellidos')?.value.trim();
  const sedesOk = Array.from(document.querySelectorAll('.chk-nuevo-sede:checked')).every(chk =>
    chk.closest('div').querySelector('.sel-cargo-por-sede')?.value
  );
  const haySedes = document.querySelectorAll('.chk-nuevo-sede:checked').length > 0;
  const completo = !!dni && !!nombres && !!apellidos && haySedes && sedesOk;
  const btn = document.getElementById('btn-crear-usuario');
  if (btn) btn.style.display = completo ? 'block' : 'none';
};

window.actualizarEstadoBotonNuevoGestor = function () {
  const dni = document.getElementById('gestor-dni')?.value.trim();
  const nombres = document.getElementById('gestor-nombres')?.value.trim();
  const apellidos = document.getElementById('gestor-apellidos')?.value.trim();
  const email = document.getElementById('gestor-email')?.value.trim();
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '');
  const completo = !!dni && !!nombres && !!apellidos && emailOk;
  const btn = document.getElementById('btn-crear-gestor');
  if (btn) btn.style.display = completo ? 'block' : 'none';
};

// ═══════════════════════════════
// 👥 Crear nuevo usuario
// ═══════════════════════════════
window.crearUsuario = async function () {
  const email         = document.getElementById("nuevo-email").value.trim();
  const dniInput      = document.getElementById("nuevo-dni").value.trim();
  const nombres       = document.getElementById("nuevo-nombres").value.trim();
  const apellidos     = document.getElementById("nuevo-apellidos").value.trim();
  const doc_tipo      = document.getElementById("nuevo-doc-tipo").value;
  const telefono      = document.getElementById("nuevo-telefono").value.trim();
  const fecha_ingreso = document.getElementById("nuevo-fecha-ingreso").value;

  if (!dniInput || !nombres || !apellidos) {
    alert("❌ Completa los campos obligatorios: nombres, apellidos y documento.");
    return;
  }

  // Normaliza a 8 dígitos con cero inicial — así la contraseña queda bien desde la creación.
  const dni = normalizarDNI(dniInput);
  const emailFinal = email || null;

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    alert("❌ Ingresa un correo electrónico válido.");
    return;
  }

  if (!empresaAdminId) {
    alert("❌ Tu usuario no tiene empresa asignada. Contacta al superadmin.");
    return;
  }

  const sedesElegidas = Array.from(document.querySelectorAll('.chk-nuevo-sede:checked')).map(chk => ({
    sede: chk.value,
    cargo_id: chk.closest('div').querySelector('.sel-cargo-por-sede')?.value || null,
  }));
  if (sedesElegidas.length === 0) {
    alert("❌ Selecciona al menos una sede.");
    return;
  }
  const sedesSinCargo = sedesElegidas.filter(s => !s.cargo_id);
  if (sedesSinCargo.length > 0) {
    alert(`❌ Selecciona el cargo para: ${sedesSinCargo.map(s => s.sede).join(', ')}.`);
    return;
  }

  // Obtener token de sesión
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;

  if (!token) {
    alert("❌ Sesión expirada. Vuelve a iniciar sesión.");
    return;
  }

  // Llamar Edge Function con fetch directo
  const response = await fetch('https://wrahjlstautwinxyqcfx.supabase.co/functions/v1/crear-usuario', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndyYWhqbHN0YXV0d2lueHlxY2Z4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxMTMyNjYsImV4cCI6MjA4ODY4OTI2Nn0.iAbYatXkr5BAplYDhs7vMca2ROjb11uFM0e4619sD4s'
    },
    body: JSON.stringify({
      email:            emailFinal,
      password:         dni,
      nombres,
      apellidos,
      documento_tipo:   doc_tipo,
      documento_numero: dni,
      telefono:         telefono || null,
      empresa_id:       empresaAdminId,
      fecha_ingreso:    fecha_ingreso || null,
      rol:              'trabajador',
      sedes:            sedesElegidas
    })
  });

  const data = await response.json();

  if (!response.ok || data?.error) {
    alert('❌ ' + (data?.error || 'Error al crear usuario'));
    return;
  }

  alert(`✅ Usuario creado correctamente.\nDNI: ${dni}\nContraseña inicial: ${dni}`);

  ["nuevo-email", "nuevo-dni", "nuevo-nombres", "nuevo-apellidos",
   "nuevo-telefono", "nuevo-fecha-ingreso"].forEach(id => {
    document.getElementById(id).value = '';
  });
  pintarCheckboxesSedes();
  actualizarEstadoBotonNuevoTrabajador();
};

window.crearGestor = async function () {
  const email         = document.getElementById("gestor-email").value.trim();
  const dniInput      = document.getElementById("gestor-dni").value.trim();
  const nombres       = document.getElementById("gestor-nombres").value.trim();
  const apellidos     = document.getElementById("gestor-apellidos").value.trim();
  const doc_tipo      = document.getElementById("gestor-doc-tipo").value;

  if (!dniInput || !nombres || !apellidos || !email) {
    alert("❌ Completa los campos obligatorios: nombres, apellidos, documento y correo.");
    return;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    alert("❌ Ingresa un correo electrónico válido.");
    return;
  }

  // Normaliza a 8 dígitos con cero inicial — así la contraseña queda bien desde la creación.
  const dni = normalizarDNI(dniInput);
  const emailFinal = email;

  if (!empresaAdminId) {
    alert("❌ Tu usuario no tiene empresa asignada. Contacta al superadmin.");
    return;
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) { alert("❌ Sesión expirada. Vuelve a iniciar sesión."); return; }

  const response = await fetch('https://wrahjlstautwinxyqcfx.supabase.co/functions/v1/crear-usuario', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndyYWhqbHN0YXV0d2lueHlxY2Z4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxMTMyNjYsImV4cCI6MjA4ODY4OTI2Nn0.iAbYatXkr5BAplYDhs7vMca2ROjb11uFM0e4619sD4s'
    },
    body: JSON.stringify({
      email:            emailFinal,
      password:         dni,
      nombres,
      apellidos,
      documento_tipo:   doc_tipo,
      documento_numero: dni,
      empresa_id:       empresaAdminId,
      rol:              'gestor'
    })
  });

  const data = await response.json();
  if (!response.ok || data?.error) {
    alert('❌ ' + (data?.error || 'Error al crear gestor'));
    return;
  }

  alert(`✅ Gestor de Personal creado.\nDNI: ${dni}\nContraseña inicial: ${dni}`);
  ["gestor-email", "gestor-dni", "gestor-nombres", "gestor-apellidos"].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('gestor-doc-tipo').value = 'DNI';
  document.getElementById('gestor-nombres').disabled = true;
  document.getElementById('gestor-apellidos').disabled = true;
  actualizarEstadoBotonNuevoGestor();
};

// ═══════════════════════════════
// 📚 Subir nuevo curso
// ═══════════════════════════════
window.subirCurso = async function () {
  const titulo        = document.getElementById("titulo-curso").value.trim();
  const prefijo       = document.getElementById("codigo-prefijo").value.trim().toUpperCase();
  const duracion      = parseInt(document.getElementById("duracion-curso").value);
  const vigencia_meses= parseInt(document.getElementById("vigencia-curso").value) || 12;

  if (!titulo || !prefijo || !duracion) {
    alert("❌ Completa los campos obligatorios: título, prefijo y duración.");
    return;
  }

  // Generar código automático
  const anio = new Date().getFullYear();
  const { count } = await supabase
    .from('cursos')
    .select('*', { count: 'exact', head: true })
    .eq('codigo_prefijo', prefijo);

  const correlativo = String((count || 0) + 1).padStart(4, '0');
  const codigo = `${prefijo}-${anio}-${correlativo}`;

  const { data: nuevoCurso, error } = await supabase.from("cursos").insert([{
    titulo,
    codigo_prefijo: prefijo,
    codigo,
    duracion,
    vigencia_meses,
    activo:       true,
    sede:         sedeAdminActiva
  }]).select().single();

  if (error) {
    alert("❌ Error al subir curso: " + error.message);
  } else {
    // Todo curso nuevo es obligatorio por defecto: se agrega a las rutas de
    // aprendizaje ya configuradas para cualquier cargo en esta sede/empresa.
    // Los cargos sin ruta configurada ya ven todos los cursos automáticamente.
    const { data: rutas } = await supabase
      .from('rutas_aprendizaje')
      .select('id')
      .eq('empresa_id', empresaAdminId)
      .eq('sede', sedeAdminActiva);

    if (rutas?.length) {
      await supabase.from('ruta_cursos').insert(
        rutas.map(r => ({ ruta_id: r.id, curso_id: nuevoCurso.id, obligatorio: true }))
      );
    }

    alert(`✅ Curso subido correctamente.\nCódigo: ${codigo}\n\nAhora ábrelo con "✏️ Editar" en la lista de cursos para subir el material y los videos.`);
    ["titulo-curso", "codigo-prefijo", "duracion-curso", "vigencia-curso"].forEach(id => {
      document.getElementById(id).value = '';
    });
    cargarListaCursos();
  }
};
// ═══════════════════════════════
// 🔐 Resetear contraseña
// ═══════════════════════════════
// ═══════════════════════════════
// 🔍 Verificar DNI en tiempo real
// ═══════════════════════════════
document.getElementById('nuevo-dni').addEventListener('blur', async function () {
  const dni = this.value.trim();
  if (!dni) return;

  const { data: existentes } = await supabase
    .from('profiles')
    .select('id')
    .eq('documento_numero', dni);

  if (existentes && existentes.length > 0) {
    this.style.border = '2px solid red';
    document.getElementById('dni-mensaje').innerHTML =
      '<span style="color:red;">❌ Este documento ya está registrado.</span>';
  } else {
    this.style.border = '2px solid green';
    document.getElementById('dni-mensaje').innerHTML =
      '<span style="color:green;">✅ Documento disponible.</span>';
  }
});

// ═══════════════════════════════
// 📥 Importar desde Excel
// ═══════════════════════════════
let filasExcel = [];
let filasClasificadas = [];

window.descargarPlantilla = async function (e) {
  e.preventDefault();
  const XLSX = window.XLSX;

  // Obtener cargos activos
  const { data: cargos } = await supabase.from('cargos').select('nombre').eq('activo', true).order('nombre');
  const listaCargos = cargos?.map(c => c.nombre) || [];

  // Hoja principal
  const ws = XLSX.utils.aoa_to_sheet([
    ['DNI', 'Apellidos', 'Nombres', 'Email', 'Cargo', 'Teléfono', 'Fecha Ingreso'],
  ]);

  // Forzar columna DNI como texto en 200 filas para que Excel preserve ceros iniciales
  for (let row = 2; row <= 201; row++) {
    ws[`A${row}`] = { t: 's', v: '' };
  }
  ws['!ref'] = 'A1:G201';

  // Hoja oculta con la lista de cargos para el dropdown
  const wsCargos = XLSX.utils.aoa_to_sheet(listaCargos.map(c => [c]));

  // Ancho de columnas
  ws['!cols'] = [12, 22, 22, 28, 28, 14, 14].map(w => ({ wch: w }));

  // Validación desplegable en columna E (Cargo) — bloquea valores fuera de la lista
  ws['!dataValidations'] = [];
  if (listaCargos.length > 0) {
    ws['!dataValidations'].push({
      type: 'list',
      sqref: 'E2:E200',
      formula1: 'Cargos!$A$1:$A$' + listaCargos.length,
      showDropDown: false,
      showErrorMessage: true,
      errorStyle: 'stop',
      errorTitle: 'Cargo no válido',
      error: 'Selecciona un cargo de la lista desplegable. No se permiten valores personalizados.'
    });
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Trabajadores');
  XLSX.utils.book_append_sheet(wb, wsCargos, 'Cargos');
  XLSX.writeFile(wb, 'plantilla_trabajadores.xlsx');
};

window.previsualizarExcel = function () {
  const archivo = document.getElementById('archivo-excel').files[0];
  if (!archivo) { alert('Selecciona un archivo Excel.'); return; }

  const btnVista = document.getElementById('btn-vista-previa');
  btnVista.disabled = true;
  btnVista.textContent = '⏳ Analizando...';

  const reader = new FileReader();
  reader.onload = async function (e) {
    try {
      const XLSX = window.XLSX;
      const workbook = XLSX.read(e.target.result, { type: 'array', cellDates: true });
      const hoja = workbook.Sheets[workbook.SheetNames[0]];
      const filas = XLSX.utils.sheet_to_json(hoja, { header: 1, defval: '' });

      filasExcel = filas.slice(1).filter(f => f[0]);

      // Detectar duplicados dentro del Excel
      const vistosDni = new Set();
      const dnisDuplicados = new Set();
      filasExcel.forEach(f => {
        const dni = normalizarDNI(f[0]);
        if (vistosDni.has(dni)) dnisDuplicados.add(dni);
        vistosDni.add(dni);
      });

      // Consultar perfiles y cargos en paralelo
      const dnisUnicos = [...vistosDni];
      const [{ data: perfilesExistentes }, { data: cargos }] = await Promise.all([
        supabase.from('profiles').select('id, documento_numero, cargo_id, cargo')
          .in('documento_numero', dnisUnicos).eq('empresa_id', empresaAdminId),
        supabase.from('cargos').select('id, nombre').eq('activo', true)
      ]);

      const perfilPorDni = {};
      (perfilesExistentes || []).forEach(p => { perfilPorDni[p.documento_numero] = p; });

      // Clasificar cada fila (plantilla: DNI, Apellidos, Nombres, Email, Cargo, Teléfono, Fecha)
      const vistosOrden = new Set();
      filasClasificadas = filasExcel.map(f => {
        const dni = normalizarDNI(f[0]);
        const cargoNombre = String(f[4] || '').trim();
        const cargo = cargos?.find(c => c.nombre.toLowerCase() === cargoNombre.toLowerCase());
        let tipo;
        if (vistosOrden.has(dni)) {
          tipo = 'duplicado';
        } else if (cargoNombre && !cargo) {
          tipo = 'cargo_invalido';
        } else if (!perfilPorDni[dni]) {
          tipo = 'nuevo';
        } else {
          const p = perfilPorDni[dni];
          const mismoCargo = (p.cargo || '').toLowerCase() === cargoNombre.toLowerCase()
            || (cargo && p.cargo_id === cargo.id);
          tipo = mismoCargo ? 'sin_cambios' : 'cambio_cargo';
        }
        vistosOrden.add(dni);
        return { fila: f, dni, tipo, perfil: perfilPorDni[dni] || null, cargo, cargoNombre };
      });

      // Renderizar tabla
      const etiquetas = {
        nuevo:          { texto: '🆕 Nuevo',             color: '#1a7f37' },
        cambio_cargo:   { texto: '🔄 Cambio de cargo',   color: '#9a6700' },
        sin_cambios:    { texto: '✅ Sin cambios',        color: '#888'    },
        duplicado:      { texto: '❌ Duplicado',          color: '#d1242f' },
        cargo_invalido: { texto: '⚠️ Cargo no existe',   color: '#c0392b' },
      };

      const tbody = document.getElementById('tbody-preview');
      tbody.innerHTML = '';
      filasClasificadas.forEach(({ fila: f, tipo, perfil, cargo }) => {
        const { texto, color } = etiquetas[tipo];
        const cargoNombre = String(f[4] || '').trim();
        const cargoCell = tipo === 'cambio_cargo'
          ? `<span style="color:#aaa;text-decoration:line-through;font-size:0.85em">${perfil?.cargo || '—'}</span><br>${cargoNombre}`
          : (cargoNombre || '—');
        const tr = document.createElement('tr');
        tr.style.opacity = tipo === 'sin_cambios' ? '0.45' : '1';
        tr.innerHTML = `
          <td style="padding:5px;">${normalizarDNI(f[0])}</td>
          <td style="padding:5px;">${String(f[1]).trim()}</td>
          <td style="padding:5px;">${String(f[2]).trim()}</td>
          <td style="padding:5px;">${cargoCell}</td>
          <td style="padding:5px; font-weight:600; color:${color};">${texto}</td>
        `;
        tbody.appendChild(tr);
      });

      // Contar por tipo
      const counts = { nuevo: 0, cambio_cargo: 0, sin_cambios: 0, duplicado: 0, cargo_invalido: 0 };
      filasClasificadas.forEach(r => counts[r.tipo]++);

      const partes = [];
      if (counts.nuevo > 0)          partes.push(`<span style="color:#1a7f37">🆕 ${counts.nuevo} nuevos</span>`);
      if (counts.cambio_cargo > 0)   partes.push(`<span style="color:#9a6700">🔄 ${counts.cambio_cargo} cambios de cargo</span>`);
      if (counts.sin_cambios > 0)    partes.push(`<span style="color:#888">✅ ${counts.sin_cambios} sin cambios</span>`);
      if (counts.duplicado > 0)      partes.push(`<span style="color:#d1242f">❌ ${counts.duplicado} duplicados</span>`);
      if (counts.cargo_invalido > 0) partes.push(`<span style="color:#c0392b">⚠️ ${counts.cargo_invalido} con cargo inválido</span>`);
      document.getElementById('preview-resumen').innerHTML = partes.join(' &nbsp;·&nbsp; ');

      // Botones de acción
      const botonesDiv = document.getElementById('acciones-importacion');
      botonesDiv.innerHTML = '';
      if (counts.cargo_invalido > 0) {
        botonesDiv.innerHTML += `<button onclick="descargarCargosInvalidosExcel()" style="background:#fff3f3;border:1px solid #c0392b;color:#c0392b;padding:8px 14px;border-radius:6px;cursor:pointer;font-size:0.9rem;">⬇️ Descargar ${counts.cargo_invalido} con cargo inválido para corregir</button>`;
      }
      if (counts.nuevo > 0) {
        botonesDiv.innerHTML += `<button onclick="descargarNuevosExcel()" class="btn-secondary" style="background:#f0f7f0;border:1px solid #1a7f37;color:#1a7f37;">⬇️ Descargar ${counts.nuevo} nuevos para verificar</button>`;
      }
      if (counts.cambio_cargo > 0) {
        botonesDiv.innerHTML += `<button onclick="aplicarCambiosDeCargo()" id="btn-aplicar-cargos" class="btn-primary">🔄 Aplicar ${counts.cambio_cargo} cambios de cargo</button>`;
      }
      if (counts.nuevo === 0 && counts.cambio_cargo === 0 && counts.cargo_invalido === 0) {
        botonesDiv.innerHTML = '<p style="color:#888; margin:0;">No hay cambios que aplicar.</p>';
      }

      document.getElementById('preview-excel').style.display = 'block';
    } catch (err) {
      alert('Error al analizar el archivo: ' + err.message);
    } finally {
      btnVista.disabled = false;
      btnVista.textContent = 'Vista previa';
    }
  };
  reader.readAsArrayBuffer(archivo);
};

// ─── Descargar nuevos para verificar vía RENIEC ──────────────────────────────
window.descargarNuevosExcel = function () {
  const nuevos = filasClasificadas.filter(r => r.tipo === 'nuevo');
  if (!nuevos.length) return;

  const XLSX = window.XLSX;
  // Plantilla: DNI, Apellidos, Nombres, Email, Cargo, Teléfono, Fecha Ingreso
  const filas = nuevos.map(({ fila: f, dni }) => {
    const fechaRaw = f[6];
    let fechaIngreso = '';
    if (fechaRaw instanceof Date) {
      fechaIngreso = `${fechaRaw.getFullYear()}-${String(fechaRaw.getMonth()+1).padStart(2,'0')}-${String(fechaRaw.getDate()).padStart(2,'0')}`;
    } else if (fechaRaw) {
      fechaIngreso = String(fechaRaw).trim();
    }
    return [
      dni,
      String(f[1]).trim(),
      String(f[2]).trim(),
      String(f[3] || '').trim(),
      String(f[4] || '').trim(),
      String(f[5] || '').trim(),
      fechaIngreso
    ];
  });

  const ws = XLSX.utils.aoa_to_sheet([
    ['DNI', 'Apellidos', 'Nombres', 'Email', 'Cargo', 'Teléfono', 'Fecha Ingreso'],
    ...filas
  ]);
  for (let row = 2; row <= filas.length + 1; row++) {
    ws[`A${row}`] = { t: 's', v: filas[row-2][0] };
  }
  ws['!cols'] = [12, 22, 22, 28, 22, 14, 14].map(w => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Nuevos');
  XLSX.writeFile(wb, 'trabajadores_nuevos_para_verificar.xlsx');
};

// ─── Descargar filas con cargo inválido para corregir ────────────────────────
window.descargarCargosInvalidosExcel = function () {
  const invalidos = filasClasificadas.filter(r => r.tipo === 'cargo_invalido');
  if (!invalidos.length) return;

  const XLSX = window.XLSX;
  const filas = invalidos.map(({ fila: f, dni, cargoNombre }) => {
    const fechaRaw = f[6];
    let fechaIngreso = '';
    if (fechaRaw instanceof Date) {
      fechaIngreso = `${fechaRaw.getFullYear()}-${String(fechaRaw.getMonth()+1).padStart(2,'0')}-${String(fechaRaw.getDate()).padStart(2,'0')}`;
    } else if (fechaRaw) {
      fechaIngreso = String(fechaRaw).trim();
    }
    return [dni, String(f[1]).trim(), String(f[2]).trim(), String(f[3] || '').trim(), cargoNombre + ' ← CORREGIR', String(f[5] || '').trim(), fechaIngreso];
  });

  const ws = XLSX.utils.aoa_to_sheet([
    ['DNI', 'Apellidos', 'Nombres', 'Email', 'Cargo (CORREGIR)', 'Teléfono', 'Fecha Ingreso'],
    ...filas
  ]);
  ws['!cols'] = [12, 22, 22, 28, 30, 14, 14].map(w => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Cargo Inválido');
  XLSX.writeFile(wb, 'trabajadores_cargo_invalido.xlsx');
};

// ─── Aplicar cambios de cargo ─────────────────────────────────────────────────
window.aplicarCambiosDeCargo = async function () {
  const cambios = filasClasificadas.filter(r => r.tipo === 'cambio_cargo');
  if (!cambios.length) return;

  const btn = document.getElementById('btn-aplicar-cargos');
  btn.disabled = true;
  btn.textContent = '⏳ Aplicando...';

  const progreso = document.getElementById('progreso-importacion');
  let ok = 0, errores = 0;

  for (const { perfil, cargo, fila } of cambios) {
    const emailFila   = String(fila[3] || '').trim();
    const cargoNombre = String(fila[4] || '').trim();
    const updateData  = { cargo_id: cargo?.id || null, cargo: cargoNombre };
    if (emailFila && emailFila.includes('@')) updateData.email = emailFila;
    const { error } = await supabase
      .from('profiles')
      .update(updateData)
      .eq('id', perfil.id);

    if (error) errores++;
    else ok++;
    progreso.textContent = `Actualizando cargos: ✅ ${ok} OK · ❌ ${errores} errores`;
  }

  progreso.textContent = `Cargos actualizados — ✅ ${ok} correctos · ❌ ${errores} errores`;
  btn.textContent = `✅ Aplicados (${ok})`;
  btn.disabled = false;
};

// ═══════════════════════════════
// 📊 Descargar reporte Excel por mes/año
// ═══════════════════════════════

// Llenar selectores de años al cargar
(function () {
  const hoy = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Lima' }));
  const anioActual = hoy.getFullYear();
  const mesActual  = hoy.getMonth() + 1;

  // Reporte Excel
  const selReporte = document.getElementById('filtro-anio');
  if (selReporte) {
    for (let y = anioActual; y >= 2024; y--) {
      const opt = document.createElement('option');
      opt.value = y; opt.textContent = y;
      selReporte.appendChild(opt);
    }
    document.getElementById('filtro-mes').value = mesActual;
  }

  // Informe RBD
  const selRbd = document.getElementById('rbd-anio');
  if (selRbd) {
    for (let y = anioActual; y >= 2024; y--) {
      const opt = document.createElement('option');
      opt.value = y; opt.textContent = y;
      selRbd.appendChild(opt);
    }
    document.getElementById('rbd-mes').value  = mesActual;
    document.getElementById('rbd-anio').value = anioActual;
  }

  // Dashboard
  const selDash = document.getElementById('dash-anio');
  if (selDash) {
    for (let y = anioActual; y >= 2024; y--) {
      const opt = document.createElement('option');
      opt.value = y; opt.textContent = y;
      selDash.appendChild(opt);
    }
    document.getElementById('dash-mes').value  = mesActual;
    document.getElementById('dash-anio').value = anioActual;
  }

  // Satisfacción
  const selSat = document.getElementById('sat-anio');
  if (selSat) {
    for (let y = anioActual; y >= 2024; y--) {
      const opt = document.createElement('option');
      opt.value = y; opt.textContent = y;
      selSat.appendChild(opt);
    }
  }

  // Asignación mensual
  for (const idSel of ['asig-anio', 'ver-asig-anio']) {
    const sel = document.getElementById(idSel);
    if (!sel) continue;
    for (let y = anioActual; y >= 2024; y--) {
      const opt = document.createElement('option');
      opt.value = y; opt.textContent = y;
      sel.appendChild(opt);
    }
  }
  const selAsigMes = document.getElementById('asig-mes');
  const selVerMes  = document.getElementById('ver-asig-mes');
  if (selAsigMes) selAsigMes.value = mesActual;
  if (selVerMes)  selVerMes.value  = mesActual;
})();


// ═══════════════════════════════════════════════════
// 📊 REGISTRO DE NOTAS — v2 (fuente: certificados)
// ═══════════════════════════════════════════════════
const RN_POR_PAGINA    = 10;
const NOTA_APROBATORIA = 16;
const RN_MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const RN_SVG_CHECK = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
const RN_SVG_X     = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
const RN_SVG_SEARCH = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>`;

let _rn_datos     = [];   // registros completos desde BD
let _rn_filtrados = [];   // después de búsqueda libre
let _rn_pagina    = 0;

// Carga cursos del dropdown al abrir la tab (solo los que tienen certificados reales)
async function initReporteNotas() {
  const sel = document.getElementById('rn-curso');
  if (!sel || sel.dataset.loaded) return;
  let q = supabase.from('certificados').select('curso_id');
  if (empresaAdminNombre) q = q.eq('empresa', empresaAdminNombre);
  const { data } = await q;
  const ids = [...new Set((data || []).map(c => c.curso_id).filter(Boolean))];
  const { data: cursoData } = ids.length
    ? await supabase.from('cursos').select('id, titulo').in('id', ids)
    : { data: [] };
  const seen = new Set();
  const lista = [];
  for (const c of (cursoData || [])) {
    if (!seen.has(c.id)) {
      seen.add(c.id);
      lista.push({ id: c.id, titulo: c.titulo });
    }
  }
  lista.sort((a, b) => a.titulo.localeCompare(b.titulo, 'es'));
  lista.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id; opt.textContent = c.titulo;
    sel.appendChild(opt);
  });
  sel.dataset.loaded = 'true';
}
window.initReporteNotas = initReporteNotas;

window.generarReporteNotas = async function () {
  const btn  = document.getElementById('rn-btn-generar');
  const kpis = document.getElementById('rn-kpis');
  const wrap = document.getElementById('rn-tabla-wrap');

  btn.disabled = true;
  btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg> Cargando...`;
  _rn_datos = []; _rn_filtrados = []; _rn_pagina = 0;
  kpis.style.display  = 'none';
  wrap.style.display  = 'none';
  document.getElementById('rn-busqueda').value = '';

  const mesVal  = document.getElementById('filtro-mes').value;
  const mes     = mesVal ? parseInt(mesVal) : null;
  const anio    = parseInt(document.getElementById('filtro-anio').value);
  const cursoId = document.getElementById('rn-curso').value   || null;
  const estado  = document.getElementById('rn-estado').value  || null;

  // Rango en hora Perú (UTC-5)
  const desde = mes
    ? new Date(Date.UTC(anio, mes - 1, 1, 5, 0, 0)).toISOString()
    : new Date(Date.UTC(anio, 0, 1, 5, 0, 0)).toISOString();
  const hasta = mes
    ? new Date(Date.UTC(anio, mes, 1, 5, 0, 0)).toISOString()
    : new Date(Date.UTC(anio + 1, 0, 1, 5, 0, 0)).toISOString();

  try {
    // Paso 1: IDs de formularios tipo 'examen'/'eficacia' (filtrado opcional por curso)
    // — deben ser los mismos tipos que dan por aprobado un curso (ver main.js, esEvaluacion),
    // si no, los cursos evaluados con 'eficacia' quedaban totalmente fuera del reporte.
    const examFormIds = [];
    {
      let pg = 0;
      while (true) {
        let qf = supabase.from('formularios').select('id').in('tipo', ['examen', 'eficacia'])
          .range(pg * 1000, (pg + 1) * 1000 - 1);
        if (cursoId) qf = qf.eq('id_curso', cursoId);
        const { data: fd, error: fe } = await qf;
        if (fe) throw fe;
        if (!fd?.length) break;
        examFormIds.push(...fd.map(f => f.id));
        pg++;
      }
    }

    console.log('[RN] examFormIds:', examFormIds.length, examFormIds.slice(0, 5));

    // Paso 2: envíos aprobados en el rango → mapa 'userId|cursoId' y 'email|cursoId' → fecha_examen
    const enviosMapById    = {};  // usuario_id|id_curso → fecha
    const enviosMapByEmail = {};  // usuario_email|id_curso → fecha
    const enviosRaw = [];
    if (examFormIds.length) {
      let pg = 0;
      while (true) {
        const { data: envios, error: ee } = await supabase
          .from('envios_formulario')
          .select('usuario_id, usuario_email, id_curso, puntaje, created_at')
          .in('id_formulario', examFormIds)
          .eq('aprobado', true)
          .eq('sede', sedeAdminActiva)
          .gte('created_at', desde)
          .lt('created_at', hasta)
          .range(pg * 1000, (pg + 1) * 1000 - 1);
        if (ee) throw ee;
        if (!envios?.length) break;
        enviosRaw.push(...envios);
        for (const e of envios) {
          if (e.usuario_id) {
            const k = `${e.usuario_id}|${e.id_curso}`;
            if (!enviosMapById[k] || e.created_at < enviosMapById[k]) enviosMapById[k] = e.created_at;
          }
          if (e.usuario_email) {
            const k = `${e.usuario_email}|${e.id_curso}`;
            if (!enviosMapByEmail[k] || e.created_at < enviosMapByEmail[k]) enviosMapByEmail[k] = e.created_at;
          }
        }
        pg++;
      }
    }
    console.log('[RN] enviosMap por id:', Object.keys(enviosMapById).length,
      '| por email:', Object.keys(enviosMapByEmail).length,
      '| muestra id:', Object.entries(enviosMapById).slice(0, 3),
      '| muestra email:', Object.entries(enviosMapByEmail).slice(0, 3));

    // Paso 2.5: regularizar certificados faltantes — el certificado no se crea
    // automáticamente al aprobar el examen, solo cuando alguien lo genera/descarga,
    // así que exámenes aprobados sin certificado aún quedaban afuera de este reporte.
    if (enviosRaw.length) {
      const usuarioIdsRN = [...new Set(enviosRaw.map(e => e.usuario_id).filter(Boolean))];
      const cursoIdsRN   = [...new Set(enviosRaw.map(e => e.id_curso).filter(Boolean))];

      const { data: certsYaExisten } = await chunkedInQuery(
        usuarioIdsRN, 150,
        (chunk) => fetchAllRows(() => supabase
          .from('certificados').select('usuario_id, curso_id')
          .in('usuario_id', chunk).in('curso_id', cursoIdsRN))
      );
      const setExistentes = new Set((certsYaExisten || []).map(c => `${c.usuario_id}|${c.curso_id}`));

      const { data: perfilesRN } = await chunkedInQuery(
        usuarioIdsRN, 150,
        (chunk) => fetchAllRows(() => supabase
          .from('profiles').select('id, email, nombres, apellidos, documento_numero, cargos(nombre)')
          .in('id', chunk))
      );
      const mapaPerfilesRN = {};
      (perfilesRN || []).forEach(p => mapaPerfilesRN[p.id] = p);

      const { data: cursosRN } = await supabase
        .from('cursos').select('id, titulo, codigo_prefijo, correlativo').in('id', cursoIdsRN);
      const mapaCursosRN = {};
      (cursosRN || []).forEach(c => mapaCursosRN[c.id] = c);

      const correlativosRN = {};
      (cursosRN || []).forEach(c => correlativosRN[c.id] = Number(c.correlativo || 0));
      const nuevosRN = [];

      for (const e of enviosRaw) {
        const key = `${e.usuario_id}|${e.id_curso}`;
        if (setExistentes.has(key)) continue;
        setExistentes.add(key); // evitar duplicados si el mismo par se repite en enviosRaw
        const perfil = mapaPerfilesRN[e.usuario_id];
        const curso  = mapaCursosRN[e.id_curso];
        if (!perfil || !curso) continue;

        correlativosRN[curso.id] += 1;
        const anioCert = new Date(e.created_at).getFullYear().toString().slice(-2);
        const prefijo  = curso.codigo_prefijo || 'CERT';
        const codigo   = `${prefijo}-${anioCert}-${String(correlativosRN[curso.id]).padStart(4, '0')}`;

        nuevosRN.push({
          usuario_id: e.usuario_id,
          usuario_email: e.usuario_email || perfil.email || '',
          curso_id: curso.id,
          sede: sedeAdminActiva,
          codigo,
          nota: Number(e.puntaje || 0),
          nombres: perfil.nombres || '',
          apellidos: perfil.apellidos || '',
          dni: perfil.documento_numero || '',
          cargo: perfil.cargos?.nombre || '',
          empresa: empresaAdminNombre || '',
          fecha: e.created_at,
        });
      }

      if (nuevosRN.length) {
        const LOTE = 500;
        for (let i = 0; i < nuevosRN.length; i += LOTE) {
          const { error: errInsRN } = await supabase
            .from('certificados')
            .upsert(nuevosRN.slice(i, i + LOTE), { onConflict: 'usuario_id,curso_id', ignoreDuplicates: true });
          if (errInsRN) throw errInsRN;
        }
        for (const [cid, correlativo] of Object.entries(correlativosRN)) {
          if (correlativo !== Number(mapaCursosRN[cid]?.correlativo || 0)) {
            await supabase.from('cursos').update({ correlativo }).eq('id', cid);
          }
        }
      }
    }

    // Paso 3: certificados de la empresa (sin filtro de fecha — se filtra por fecha_examen)
    const allCerts = [];
    {
      let pg = 0;
      while (true) {
        let q = supabase.from('certificados').select('*')
          .eq('sede', sedeAdminActiva)
          .range(pg * 1000, (pg + 1) * 1000 - 1);
        if (empresaAdminNombre) q = q.eq('empresa', empresaAdminNombre);
        if (cursoId) q = q.eq('curso_id', cursoId);
        if (estado === 'aprobado')    q = q.gte('nota', NOTA_APROBATORIA);
        if (estado === 'desaprobado') q = q.lt('nota',  NOTA_APROBATORIA);
        const { data, error } = await q;
        if (error) throw error;
        if (!data?.length) break;
        allCerts.push(...data);
        pg++;
      }
    }
    console.log('[RN] certs totales empresa:', allCerts.length,
      '| muestra usuario_id:', allCerts.slice(0, 2).map(r => r.usuario_id),
      '| muestra curso_id:', allCerts.slice(0, 2).map(r => r.curso_id));

    // Paso 4: cruzar — solo certs con examen en el rango, agregar fecha_examen
    const { data: cursos } = await supabase.from('cursos').select('id, titulo');
    const mapCursos = {};
    (cursos || []).forEach(c => { mapCursos[c.id] = c.titulo; });

    // Si no hay envio_formulario que cruce (sede/usuario distinto, o formulario no
    // encontrado), no se descarta el certificado: se usa su propia fecha de creación
    // como fecha efectiva, para no perder certificados que sí muestran las cards.
    _rn_datos = allCerts
      .map(r => {
        const kId    = `${r.usuario_id}|${r.curso_id}`;
        const kEmail = `${r.usuario_email}|${r.curso_id}`;
        const fecha_examen = enviosMapById[kId] || enviosMapByEmail[kEmail] || r.fecha || null;
        return { ...r, fecha_examen, curso_nombre: mapCursos[r.curso_id] || '—' };
      })
      .filter(r => r.fecha_examen !== null && r.fecha_examen >= desde && r.fecha_examen < hasta)
      .sort((a, b) => b.fecha_examen.localeCompare(a.fecha_examen));

    console.log('[RN] resultado final:', _rn_datos.length,
      '| muestra fechas:', _rn_datos.slice(0, 5).map(r => r.fecha_examen));

    _rn_filtrados = [..._rn_datos];

    rn_renderKpis();
    rn_renderTabla();

    kpis.style.display = 'grid';
    wrap.style.display = 'block';
    document.getElementById('rn-btn-excel').disabled = (_rn_datos.length === 0);

  } catch (err) {
    toast('Error al generar reporte: ' + (err.message || err), 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = RN_SVG_SEARCH + ' Generar reporte';
  }
};

function rn_renderKpis() {
  const total  = _rn_filtrados.length;
  const ap     = _rn_filtrados.filter(r => Number(r.nota ?? 0) >= NOTA_APROBATORIA).length;
  const des    = total - ap;
  const notas  = _rn_filtrados.map(r => Number(r.nota)).filter(n => !isNaN(n) && n > 0);
  const prom   = notas.length ? (notas.reduce((a, b) => a + b, 0) / notas.length).toFixed(1) : '—';
  const porcAp = total > 0 ? ((ap / total) * 100).toFixed(0) + ' %' : '—';
  document.getElementById('rn-kpi-total').textContent = total;
  document.getElementById('rn-kpi-ap').textContent    = ap;
  document.getElementById('rn-kpi-des').textContent   = des;
  document.getElementById('rn-kpi-prom').textContent  = prom;
  document.getElementById('rn-kpi-porc').textContent  = porcAp;
}

function rn_renderTabla() {
  const tbody    = document.getElementById('rn-tbody');
  const total    = _rn_filtrados.length;
  const totalPag = Math.max(1, Math.ceil(total / RN_POR_PAGINA));
  _rn_pagina     = Math.min(_rn_pagina, totalPag - 1);
  const inicio   = _rn_pagina * RN_POR_PAGINA;
  const fin      = Math.min(inicio + RN_POR_PAGINA, total);

  if (!total) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:32px;color:var(--text-muted);">Sin resultados para los filtros seleccionados.</td></tr>`;
  } else {
    tbody.innerHTML = _rn_filtrados.slice(inicio, fin).map((r, idx) => {
      const nota     = Number(r.nota ?? 0);
      const aprobado = nota >= NOTA_APROBATORIA;
      const notaTxt  = r.nota != null ? nota.toFixed(1) : '—';
      const porcTxt  = r.nota != null ? (nota / 20 * 100).toFixed(0) + '%' : '—';
      const barW     = r.nota != null ? Math.min(100, nota / 20 * 100).toFixed(1) : 0;
      const color    = aprobado ? '#1D9E75' : '#A32D2D';
      const fecha    = r.fecha_examen
        ? new Date(r.fecha_examen).toLocaleDateString('es-PE', { day:'2-digit', month:'2-digit', year:'numeric' })
        : '—';
      const badge    = aprobado
        ? `<span class="rn2-badge rn2-badge-ap">${RN_SVG_CHECK} Aprobado</span>`
        : `<span class="rn2-badge rn2-badge-des">${RN_SVG_X} Desaprobado</span>`;
      return `<tr>
        <td style="color:var(--text-muted);font-size:0.78rem;">${inicio + idx + 1}</td>
        <td style="font-family:monospace;font-size:0.84rem;">${r.dni || '—'}</td>
        <td><strong>${r.apellidos || ''}</strong>${r.nombres ? ' ' + r.nombres : ''}</td>
        <td style="color:var(--text-secondary);font-size:0.83rem;">${r.cargo || '—'}</td>
        <td style="font-size:0.84rem;">${r.curso_nombre}</td>
        <td>
          <div class="rn2-nota-wrap">
            <span class="rn2-nota-num" style="color:${color}">${notaTxt}/20</span>
            <div class="rn2-nota-bar"><div class="rn2-nota-fill" style="width:${barW}%;background:${color}"></div></div>
            <span class="rn2-nota-pct">${porcTxt}</span>
          </div>
        </td>
        <td>${badge}</td>
        <td style="color:var(--text-muted);font-size:0.82rem;white-space:nowrap;">${fecha}</td>
        <td style="font-family:monospace;font-size:0.79rem;color:var(--text-muted);">${r.codigo || '—'}</td>
      </tr>`;
    }).join('');
  }

  document.getElementById('rn-pag-info').textContent =
    total ? `${inicio + 1}–${fin} de ${total} registros` : '0 registros';
  document.getElementById('rn-pag-num').textContent =
    total ? `Pág. ${_rn_pagina + 1} / ${totalPag}` : '';
  document.getElementById('rn-btn-prev').disabled = (_rn_pagina === 0);
  document.getElementById('rn-btn-next').disabled = (_rn_pagina >= totalPag - 1);
}

window.rn_filtrarTabla = function () {
  const q = document.getElementById('rn-busqueda').value.trim().toLowerCase();
  _rn_filtrados = q
    ? _rn_datos.filter(r =>
        (r.dni       || '').toLowerCase().includes(q) ||
        (r.nombres   || '').toLowerCase().includes(q) ||
        (r.apellidos || '').toLowerCase().includes(q))
    : [..._rn_datos];
  _rn_pagina = 0;
  rn_renderKpis();
  rn_renderTabla();
};

window.rn_cambiarPagina = function (delta) {
  const totalPag = Math.ceil(_rn_filtrados.length / RN_POR_PAGINA);
  _rn_pagina = Math.max(0, Math.min(_rn_pagina + delta, totalPag - 1));
  rn_renderTabla();
};

window.descargarReporteExcel = function () {
  if (!_rn_filtrados.length) { toast('Primero genera el reporte.', 'warning'); return; }
  const mesVal = document.getElementById('filtro-mes').value;
  const mes    = mesVal ? parseInt(mesVal) : null;
  const anio   = parseInt(document.getElementById('filtro-anio').value);
  const cab  = ['DNI','Apellidos','Nombres','Empresa','Cargo','Curso','Fecha','Nota','%','Estado','Código certificado'];
  const filas = _rn_filtrados.map(r => {
    const nota = Number(r.nota ?? 0);
    const ap   = nota >= NOTA_APROBATORIA;
    const fecha = r.fecha_examen
      ? new Date(r.fecha_examen).toLocaleDateString('es-PE', { day:'2-digit', month:'2-digit', year:'numeric' })
      : '';
    return [
      r.dni || '', r.apellidos || '', r.nombres || '',
      r.empresa || '', r.cargo || '', r.curso_nombre || '',
      fecha,
      r.nota != null ? nota : '',
      r.nota != null ? parseFloat((nota / 20 * 100).toFixed(1)) : '',
      ap ? 'Aprobado' : 'Desaprobado',
      r.codigo || ''
    ];
  });
  const XLSX = window.XLSX;
  const ws   = XLSX.utils.aoa_to_sheet([cab, ...filas]);
  ws['!cols'] = [12,20,20,24,20,32,12,8,8,14,20].map(w => ({ wch: w }));
  const wb   = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Registro de Notas');
  XLSX.writeFile(wb, mes ? `Registro_Notas_${RN_MESES[mes - 1]}_${anio}.xlsx` : `Registro_Notas_${anio}.xlsx`);
};

// ═══════════════════════════════
// 👥 Lista y edición de trabajadores
// ═══════════════════════════════
let cargosDisponibles = [];

const PAGE_SIZE = 50;
let _trabTotal = 0;

function iniciales(apellidos, nombres) {
  const a = (apellidos || '').trim()[0] || '';
  const n = (nombres || '').trim()[0] || '';
  return (a + n).toUpperCase() || '?';
}

window.cargarTrabajadores = async function (page = 0) {
  const desde = page * PAGE_SIZE;
  const busqueda = document.getElementById('buscar-apellido')?.value.trim() || '';
  const filtroEstado = document.getElementById('filtro-estado-trab')?.value || '';

  // Solo trabajadores asignados a la sede activa (perfil_sede) — si está en varias sedes,
  // aparece igual en cualquiera de ellas. Filtro con join embebido (no con .in() de IDs:
  // con sedes grandes generaba URLs de miles de caracteres y el servidor respondía 400).
  let query = supabase
    .from('profiles')
    .select('id, nombres, apellidos, email, documento_numero, telefono, cargo_id, cargo, fecha_ingreso, activo, perfil_sede!inner(sede)', { count: 'exact' })
    .eq('empresa_id', empresaAdminId)
    .eq('rol', 'trabajador')
    .eq('perfil_sede.sede', sedeAdminActiva)
    .eq('perfil_sede.activo', true)
    .order('apellidos')
    .range(desde, desde + PAGE_SIZE - 1);

  if (busqueda) {
    query = query.or(`apellidos.ilike.%${busqueda}%,documento_numero.ilike.%${busqueda}%`);
  }
  if (filtroEstado === 'activo')   query = query.eq('activo', true);
  if (filtroEstado === 'inactivo') query = query.eq('activo', false);

  const [{ data, error, count }, { data: cargos }] = await Promise.all([
    query,
    supabase.from('cargos').select('id, nombre').eq('activo', true).order('nombre'),
  ]);

  if (error) { alert('❌ Error: ' + error.message); return; }

  _trabTotal = count || 0;
  cargosDisponibles = cargos || [];
  _trabEncontrados = data || [];

  const cont = document.getElementById('galeria-trabajadores');

  if (!data || data.length === 0) {
    cont.innerHTML = `<p style="color:#888;padding:12px;">Sin trabajadores para este filtro.</p>`;
    document.getElementById('paginacion-trabajadores')?.remove();
    return;
  }

  cont.innerHTML = data.map((u, idx) => `
    <div class="trab-card">
      <div class="trab-card-top">
        <div class="trab-avatar">${iniciales(u.apellidos, u.nombres)}</div>
        <div class="trab-info">
          <div class="trab-nombre">${u.apellidos || ''} ${u.nombres || ''}</div>
          <div class="trab-meta">DNI ${u.documento_numero || '—'}${u.cargo ? ' · ' + u.cargo : ''}</div>
        </div>
        <span class="${u.activo ? 'badge-activo' : 'badge-inactivo'}">${u.activo ? 'Activo' : 'Inactivo'}</span>
      </div>
      <div class="trab-email">${u.email || '<em style="color:#aaa;">Sin correo</em>'}</div>
      <div class="trab-actions">
        <button class="btn-editar" onclick="abrirFormEdicion(${idx})">✏️ Modificar</button>
        <button class="${u.activo ? 'btn-toggle-on' : 'btn-toggle-off'}" onclick="toggleActivo('${u.id}', ${u.activo})">
          ${u.activo ? 'Desactivar' : 'Activar'}
        </button>
        <button onclick="resetearPasswordADni(${idx})" title="Deja su contraseña igual a su DNI"
                style="padding:5px 12px;background:#e65100;color:white;border:none;border-radius:5px;cursor:pointer;font-size:0.8rem;">
          🔑 Resetear contraseña
        </button>
      </div>
    </div>
  `).join('');

  // Paginación
  let pag = document.getElementById('paginacion-trabajadores');
  if (!pag) {
    pag = document.createElement('div');
    pag.id = 'paginacion-trabajadores';
    pag.style.cssText = 'display:flex;align-items:center;gap:10px;margin-top:14px;font-size:0.85rem;color:#555;';
    cont.after(pag);
  }
  const totalPages = Math.ceil(_trabTotal / PAGE_SIZE);
  pag.innerHTML = totalPages <= 1 ? `<span>${_trabTotal} trabajadores</span>` : `
    <button onclick="cargarTrabajadores(${page - 1})" ${page === 0 ? 'disabled' : ''}
      style="padding:5px 12px;border:1px solid #dde3ec;border-radius:6px;cursor:pointer;background:white;">‹</button>
    <span>Página ${page + 1} de ${totalPages} · ${_trabTotal} trabajadores</span>
    <button onclick="cargarTrabajadores(${page + 1})" ${page >= totalPages - 1 ? 'disabled' : ''}
      style="padding:5px 12px;border:1px solid #dde3ec;border-radius:6px;cursor:pointer;background:white;">›</button>
  `;
};


// ═══════════════════════════════
// ✏️ ACTUALIZACIÓN INDIVIDUAL DE TRABAJADOR
// ═══════════════════════════════
let _trabEncontrados = [];

// Reseteo de un clic: deja la contraseña del trabajador igual a su DNI completo.
// Pensado para resolver en el momento el caso típico de "no puedo ingresar".
window.resetearPasswordADni = async function (idx) {
  const t = _trabEncontrados[idx];
  if (!t) return;
  if (!await showConfirm(
    `¿Resetear la contraseña de ${t.apellidos}, ${t.nombres} a su DNI (${t.documento_numero})?`,
    { confirmText: 'Sí, resetear' }
  )) return;

  const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndyYWhqbHN0YXV0d2lueHlxY2Z4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxMTMyNjYsImV4cCI6MjA4ODY4OTI2Nn0.iAbYatXkr5BAplYDhs7vMca2ROjb11uFM0e4619sD4s';
  const { data: sessionData } = await supabase.auth.getSession();

  const res = await fetch('https://wrahjlstautwinxyqcfx.supabase.co/functions/v1/actualizar-usuario', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${sessionData.session?.access_token}`,
      'apikey': ANON_KEY,
    },
    body: JSON.stringify({
      usuario_id: t.id,
      updates: {},
      password: t.documento_numero,
    }),
  });
  const data = await res.json().catch(() => ({}));

  if (!res.ok || data?.error) {
    alert('❌ ' + (data?.error || 'Error al resetear la contraseña.'));
    return;
  }
  alert(`✅ Contraseña reseteada. Ya puede ingresar con DNI: ${t.documento_numero}`);
};

// ═══════════════════════════════
// 🛡️ ADMINISTRADORES Y GESTORES
// ═══════════════════════════════
let _staffEncontrados = [];

window.cargarStaff = async function () {
  const busqueda = document.getElementById('buscar-staff')?.value.trim() || '';
  const filtroRol = document.getElementById('filtro-rol-staff')?.value || '';

  // Join embebido en vez de .in() de IDs (con sedes grandes esa URL superaba el
  // límite del servidor y devolvía 400).
  let query = supabase
    .from('profiles')
    .select('id, nombres, apellidos, email, documento_numero, rol, activo, perfil_sede!inner(sede)')
    .eq('empresa_id', empresaAdminId)
    .in('rol', filtroRol ? [filtroRol] : ['admin', 'gestor'])
    .eq('perfil_sede.sede', sedeAdminActiva)
    .eq('perfil_sede.activo', true)
    .order('apellidos');

  if (busqueda) {
    query = query.or(`apellidos.ilike.%${busqueda}%,documento_numero.ilike.%${busqueda}%`);
  }

  const { data, error } = await query;
  if (error) { alert('❌ ' + error.message); return; }

  _staffEncontrados = data || [];
  const cont = document.getElementById('galeria-staff');

  if (!_staffEncontrados.length) {
    cont.innerHTML = '<p style="color:#888;padding:12px;">Sin cuentas para este filtro.</p>';
    return;
  }

  cont.innerHTML = _staffEncontrados.map((u, idx) => `
    <div class="trab-card">
      <div class="trab-card-top">
        <div class="trab-avatar">${iniciales(u.apellidos, u.nombres)}</div>
        <div class="trab-info">
          <div class="trab-nombre">${u.apellidos || ''} ${u.nombres || ''}</div>
          <div class="trab-meta">DNI ${u.documento_numero || '—'} · ${u.rol === 'gestor' ? 'Gestor' : 'Administrador'}</div>
        </div>
        <span class="${u.activo ? 'badge-activo' : 'badge-inactivo'}">${u.activo ? 'Activo' : 'Inactivo'}</span>
      </div>
      <div class="trab-email">${u.email || '<em style="color:#aaa;">Sin correo</em>'}</div>
      <p style="font-size:0.72rem;color:#aaa;margin:2px 0 0;">Solo el superadmin puede modificar esta cuenta (correo, contraseña, activar/desactivar).</p>
    </div>
  `).join('');
};


window.abrirFormEdicion = async function (idx) {
  const t = _trabEncontrados[idx];
  document.getElementById('edit-trab-id').value            = t.id;
  document.getElementById('edit-trab-dni').value           = t.documento_numero;
  document.getElementById('edit-trab-apellidos').value     = t.apellidos    || '';
  document.getElementById('edit-trab-nombres').value       = t.nombres      || '';
  document.getElementById('edit-trab-email').value         = t.email        || '';
  document.getElementById('edit-trab-telefono').value      = t.telefono     || '';
  document.getElementById('edit-trab-fecha-ingreso').value = t.fecha_ingreso ? t.fecha_ingreso.slice(0, 10) : '';
  document.getElementById('edit-trab-password').value      = '';
  document.getElementById('estado-edicion-trab').textContent = '';
  document.getElementById('estado-edicion-trab').style.color = '';

  const sel = document.getElementById('edit-trab-cargo');
  sel.innerHTML = '<option value="">— Sin cargo —</option>';
  const { data: cargos } = await supabase.from('cargos').select('id, nombre').eq('activo', true).order('nombre');
  (cargos || []).forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.nombre;
    if (c.id === t.cargo_id) opt.selected = true;
    sel.appendChild(opt);
  });

  const { data: sedesTrab } = await supabase
    .from('perfil_sede')
    .select('sede, activo')
    .eq('profile_id', t.id);

  const sedesActivas = (sedesTrab || []).filter(s => s.activo).map(s => s.sede);
  const contSedes = document.getElementById('edit-trab-sedes-checks');
  contSedes.innerHTML = sedesAdminDisponibles.map(s => `
    <label style="margin-right:16px; font-size:0.9rem;">
      <input type="checkbox" class="chk-edit-trab-sede" value="${s}" ${sedesActivas.includes(s) ? 'checked' : ''} />
      ${s}
    </label>`).join('');

  document.getElementById('modal-editar-trab').style.display = 'flex';
};

window.cerrarModalEditarTrab = function () {
  document.getElementById('modal-editar-trab').style.display = 'none';
};

window.guardarActualizacionIndividual = async function () {
  const usuarioId = document.getElementById('edit-trab-id').value;
  if (!usuarioId) return;

  const apellidos    = document.getElementById('edit-trab-apellidos').value.trim();
  const nombres      = document.getElementById('edit-trab-nombres').value.trim();
  const email        = document.getElementById('edit-trab-email').value.trim().toLowerCase();
  const telefono     = document.getElementById('edit-trab-telefono').value.trim();
  const cargo_id     = document.getElementById('edit-trab-cargo').value;
  const fechaIngreso = document.getElementById('edit-trab-fecha-ingreso').value;
  const password     = document.getElementById('edit-trab-password').value.trim();

  const btn    = document.getElementById('btn-guardar-edicion');
  const estado = document.getElementById('estado-edicion-trab');
  btn.disabled    = true;
  btn.textContent = '⏳ Guardando...';
  estado.textContent = '';

  const { data: cargos } = await supabase.from('cargos').select('id, nombre').eq('activo', true);
  const cargoObj = cargos?.find(c => c.id === cargo_id);

  const updates = {};
  if (apellidos)    updates.apellidos     = apellidos;
  if (nombres)      updates.nombres       = nombres;
  if (email)        updates.email         = email;
  if (telefono)     updates.telefono      = telefono;
  if (cargo_id)   { updates.cargo_id      = cargo_id; updates.cargo = cargoObj?.nombre || null; }
  if (fechaIngreso) updates.fecha_ingreso = fechaIngreso;

  const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndyYWhqbHN0YXV0d2lueHlxY2Z4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxMTMyNjYsImV4cCI6MjA4ODY4OTI2Nn0.iAbYatXkr5BAplYDhs7vMca2ROjb11uFM0e4619sD4s';

  const sedesMarcadas = Array.from(document.querySelectorAll('.chk-edit-trab-sede:checked')).map(c => c.value);
  const sedesNoMarcadas = sedesAdminDisponibles.filter(s => !sedesMarcadas.includes(s));

  const body = { usuario_id: usuarioId, updates, agregarSedes: sedesMarcadas, quitarSedes: sedesNoMarcadas };
  if (password) body.password = password;

  const { data: sessionDataAct2 } = await supabase.auth.getSession();
  const res = await fetch('https://wrahjlstautwinxyqcfx.supabase.co/functions/v1/actualizar-usuario', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${sessionDataAct2.session?.access_token}`,
      'apikey': ANON_KEY,
    },
    body: JSON.stringify(body),
  });

  let resData = {};
  try { resData = await res.json(); } catch (_) {}

  if (!res.ok || resData?.error) {
    estado.style.color  = 'red';
    estado.textContent  = '❌ ' + (resData?.error || `Error HTTP ${res.status}`);
  } else {
    estado.style.color  = 'green';
    estado.textContent  = '✅ Actualizado correctamente.';
    const idx = _trabEncontrados.findIndex(t => t.id === usuarioId);
    if (idx !== -1) {
      _trabEncontrados[idx] = { ..._trabEncontrados[idx], apellidos, nombres, email, telefono,
        cargo_id, cargo: cargoObj?.nombre || _trabEncontrados[idx].cargo, fecha_ingreso: fechaIngreso };
    }
  }

  btn.disabled    = false;
  btn.textContent = '💾 Guardar cambios';
};

window.toggleActivo = async function (id, activo) {
  await supabase.from('profiles').update({ activo: !activo }).eq('id', id);
  cargarTrabajadores();
};

// ═══════════════════════════════════════════════
// 📥 DESCARGA MASIVA DE CERTIFICADOS
// ═══════════════════════════════════════════════

window.descargarCertificadosMasivo = async function () {
  const cursoId = document.getElementById('cert-bulk-curso').value;
  const mesVal  = document.getElementById('cert-bulk-mes').value;
  const status  = document.getElementById('cert-bulk-status');

  if (!cursoId) { alert('âŒ Selecciona un curso'); return; }

  try {
    status.textContent = 'ðŸ”„ Consultando aprobados...';

    let q = supabase
      .from('envios_formulario')
      .select(`
        usuario_id, usuario_email, puntaje, created_at,
        formularios(tipo)
      `)
      .eq('id_curso', cursoId)
      .eq('aprobado', true);

    if (mesVal) {
      const [y, m] = mesVal.split('-').map(Number);
      const desde  = new Date(y, m - 1, 1).toISOString();
      const hasta  = new Date(y, m, 1).toISOString();
      q = q.gte('created_at', desde).lt('created_at', hasta);
    }

    const { data: envios, error } = await q;
    if (error) throw error;

    const usuarioIds = [...new Set((envios || []).map(e => e.usuario_id).filter(Boolean))];
    const { data: perfiles, error: perfilesError } = await supabase
      .from('profiles')
      .select('id, email, nombres, apellidos, documento_numero, documento_tipo, cargos(nombre), empresas(nombre)')
      .in('id', usuarioIds);
    if (perfilesError) throw perfilesError;

    const mapaPerfiles = {};
    for (const perfil of (perfiles || [])) {
      mapaPerfiles[perfil.id] = perfil;
    }

    const mapaMejor = {};
    for (const e of (envios || [])) {
      if (e.formularios?.tipo !== 'examen') continue;

      const perfil = mapaPerfiles[e.usuario_id] || {};
      const uid = e.usuario_id || perfil.id || perfil.documento_numero || e.usuario_email;
      if (!uid) continue;

      const puntajeActual = Number(e.puntaje || 0);
      const previo = mapaMejor[uid];
      const puntajePrevio = Number(previo?.puntaje || 0);
      const fechaActual = new Date(e.created_at || 0).getTime();
      const fechaPrevia = new Date(previo?.created_at || 0).getTime();

      if (!previo || puntajeActual > puntajePrevio || (puntajeActual === puntajePrevio && fechaActual > fechaPrevia)) {
        mapaMejor[uid] = { ...e, profileData: perfil };
      }
    }

    const aprobados = Object.values(mapaMejor);
    if (!aprobados.length) {
      status.textContent = 'âš ï¸ No se encontraron trabajadores aprobados con esos filtros.';
      return;
    }

    const { data: curso, error: cursoError } = await supabase
      .from('cursos')
      .select('id, titulo, duracion, codigo_prefijo, correlativo')
      .eq('id', cursoId)
      .single();
    if (cursoError) throw cursoError;

    const { data: certs, error: certsError } = await supabase
      .from('certificados')
      .select('usuario_id, usuario_email, codigo, nota, nombres, apellidos, dni, cargo, empresa')
      .eq('curso_id', cursoId);
    if (certsError) throw certsError;

    const mapaCertificados = {};
    let correlativoActual = Number(curso?.correlativo || 0);
    for (const c of (certs || [])) {
      mapaCertificados[c.usuario_id] = c;

      const partes = String(c.codigo || '').split('-');
      const numeroCodigo = Number(partes[partes.length - 1]);
      if (!Number.isNaN(numeroCodigo)) {
        correlativoActual = Math.max(correlativoActual, numeroCodigo);
      }
    }

    const faltantes = aprobados
      .filter(e => {
        const perfil = e.profileData || {};
        return perfil.id && !mapaCertificados[perfil.id];
      })
      .sort((a, b) => {
        const nombreA = `${a.profileData?.apellidos || ''} ${a.profileData?.nombres || ''} ${a.profileData?.documento_numero || ''}`.trim();
        const nombreB = `${b.profileData?.apellidos || ''} ${b.profileData?.nombres || ''} ${b.profileData?.documento_numero || ''}`.trim();
        return nombreA.localeCompare(nombreB, 'es');
      });

    if (faltantes.length) {
      status.textContent = `ðŸ”„ Regularizando ${faltantes.length} certificados faltantes...`;

      const anio = new Date().getFullYear().toString().slice(-2);
      const prefijo = curso?.codigo_prefijo || 'CERT';
      const nuevosCertificados = [];

      for (const e of faltantes) {
        const perfil = e.profileData || {};
        correlativoActual += 1;

        nuevosCertificados.push({
          usuario_id: perfil.id,
          usuario_email: perfil.email || e.usuario_email || '',
          curso_id: cursoId,
          sede: sedeAdminActiva,
          codigo: `${prefijo}-${anio}-${String(correlativoActual).padStart(4, '0')}`,
          nota: Number(e.puntaje || 0),
          nombres: perfil.nombres || '',
          apellidos: perfil.apellidos || '',
          dni: perfil.documento_numero || '',
          cargo: perfil.cargos?.nombre || '',
          empresa: perfil.empresas?.nombre || '',
          fecha: e.created_at,
        });
      }

      const { data: insertados, error: insertError } = await supabase
        .from('certificados')
        .insert(nuevosCertificados)
        .select('usuario_id, usuario_email, codigo, nota, nombres, apellidos, dni, cargo, empresa');
      if (insertError) throw insertError;

      const { error: updateCursoError } = await supabase
        .from('cursos')
        .update({ correlativo: correlativoActual })
        .eq('id', cursoId);
      if (updateCursoError) throw updateCursoError;

      for (const c of (insertados || [])) {
        mapaCertificados[c.usuario_id] = c;
      }
    }

    if (!window.JSZip || !window.html2pdf) {
      throw new Error('No se cargaron las librerÃ­as para generar PDFs o ZIP.');
    }

    const zip = new window.JSZip();
    const folder = zip.folder('Certificados');
    const duracion = curso?.duracion ? `${curso.duracion} hora${curso.duracion > 1 ? 's' : ''}` : '';

    status.textContent = `ðŸ“„ Generando 0 / ${aprobados.length} PDFs...`;

    for (let i = 0; i < aprobados.length; i++) {
      const e = aprobados[i];
      const perfil = e.profileData || {};
      const certInfo = mapaCertificados[perfil.id];

      if (!certInfo) {
        throw new Error(`No se pudo regularizar el certificado de ${perfil.apellidos || ''} ${perfil.nombres || ''}`.trim());
      }

      const nombreCompleto = `${certInfo.apellidos || perfil.apellidos || ''} ${certInfo.nombres || perfil.nombres || ''}`.trim().toUpperCase();
      const dni = certInfo.dni || perfil.documento_numero || '';
      const cargo = certInfo.cargo || perfil.cargos?.nombre || '';
      const notaNumerica = certInfo.nota ?? Number(e.puntaje || 0);
      const notaTexto = Number.isFinite(Number(notaNumerica)) ? Number(notaNumerica).toFixed(1) : String(notaNumerica || '');
      const codigo = certInfo.codigo || 'â€”';
      const fechaHoy = new Date(e.created_at).toLocaleDateString('es-PE', { day: '2-digit', month: 'long', year: 'numeric' });

      const html = buildHtmlCertificado({
        nombreCompleto,
        dni,
        documentoTipo: perfil.documento_tipo,
        cargo,
        cursotitulo:   curso?.titulo || '',
        duracion,
        notaTexto,
        fechaHoy,
        codigo,
      });

      const pdfBlob = await generarCertificadoPDFBlob(html);
      const nombreSeguro = nombreCompleto.replace(/[\\/:*?\"<>|]+/g, '').replace(/\s+/g, '_');
      const nombreArchivo = `${dni || 'sin_dni'}_${nombreSeguro}.pdf`;
      folder.file(nombreArchivo, pdfBlob);

      status.textContent = `ðŸ“„ Generando ${i + 1} / ${aprobados.length} PDFs...`;
    }

    status.textContent = 'ðŸ“¦ Empaquetando ZIP...';
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const url     = URL.createObjectURL(zipBlob);
    const a       = document.createElement('a');
    a.href        = url;
    a.download    = `Certificados_${curso?.titulo || cursoId}_${mesVal || 'todos'}.zip`;
    a.click();
    URL.revokeObjectURL(url);

    status.textContent = `âœ… Descargado ZIP con ${aprobados.length} certificados. ${faltantes.length ? `Se regularizaron ${faltantes.length} faltantes.` : 'No hubo faltantes.'}`;
  } catch (err) {
    console.error('Error en descarga masiva de certificados:', err);
    status.textContent = `âŒ ${err?.message || 'No se pudo generar la descarga masiva.'}`;
  }
};

window.cargarListaCursos = async function () {
  const sel = document.getElementById('select-curso-editar');
  const idSeleccionado = sel.value;
  sel.innerHTML = '<option value="">-- Selecciona un curso --</option>';

  const { data: cursos, error: errCursos } = await supabase
    .from('cursos')
    .select('id, titulo, codigo, codigo_prefijo, duracion, vigencia_meses, url_video, url_material, objetivo, activo')
    .eq('sede', sedeAdminActiva)
    .order('titulo');

  if (errCursos) { alert('❌ ' + errCursos.message); return; }
  if (!cursos?.length) {
    sel.innerHTML = '<option value="">-- No hay cursos registrados --</option>';
    return;
  }

  window.cursosCache = {};
  cursos.forEach(c => {
    window.cursosCache[c.id] = c;
    sel.innerHTML += `<option value="${c.id}">${c.titulo}${c.duracion ? ' (' + c.duracion + 'h)' : ''}</option>`;
  });
  if (idSeleccionado && window.cursosCache[idSeleccionado]) sel.value = idSeleccionado;
};

window.cargarActivarCursos = async function () {
  const cont = document.getElementById('lista-activar-cursos');
  const sedeLabel = document.getElementById('activar-cursos-sede-actual');
  if (sedeLabel) sedeLabel.textContent = sedeAdminActiva || '';

  const { data: cursos, error } = await supabase
    .from('cursos')
    .select('id, titulo, activo')
    .eq('sede', sedeAdminActiva)
    .order('titulo');

  if (error) { cont.innerHTML = `<p style="color:#c62828;">❌ ${error.message}</p>`; return; }
  if (!cursos?.length) { cont.innerHTML = '<p style="color:#888;">No hay cursos registrados en esta sede.</p>'; return; }

  cont.innerHTML = cursos.map(c => `
    <div class="trab-card">
      <div class="trab-card-top">
        <div class="trab-info">
          <div class="trab-nombre">${c.titulo}</div>
        </div>
        <span class="${c.activo ? 'badge-activo' : 'badge-inactivo'}">${c.activo ? 'Activo' : 'Inactivo'}</span>
      </div>
      <div class="trab-actions">
        <button class="${c.activo ? 'btn-toggle-on' : 'btn-toggle-off'}" onclick="toggleActivoCurso('${c.id}', ${c.activo})">
          ${c.activo ? 'Desactivar' : 'Activar'}
        </button>
      </div>
    </div>
  `).join('');
};

window.toggleActivoCurso = async function (id, activo) {
  const { error } = await supabase.from('cursos').update({ activo: !activo }).eq('id', id);
  if (error) { alert('❌ ' + error.message); return; }
  cargarActivarCursos();
};

window.abrirEdicionCurso = function (id) {
  if (!id) { cerrarPanelEditarCurso(); return; }
  const c = window.cursosCache?.[id];
  if (!c) { alert('❌ No se encontró el curso.'); return; }

  document.getElementById('editar-curso-id').value           = c.id;
  document.getElementById('editar-curso-titulo').value        = c.titulo || '';
  document.getElementById('editar-curso-codigo-prefijo').value= c.codigo_prefijo || '';
  document.getElementById('editar-curso-codigo').value        = c.codigo || '';
  document.getElementById('editar-curso-duracion').value      = c.duracion ?? '';
  document.getElementById('editar-curso-vigencia').value      = c.vigencia_meses ?? '';
  document.getElementById('editar-curso-url-material').value  = c.url_material || '';
  document.getElementById('editar-curso-objetivo').value      = c.objetivo || '';
  document.getElementById('editar-curso-pdf-file').value      = '';

  document.getElementById('panel-editar-curso').style.display = 'block';
  cargarVideosCurso(c.id);
  cargarCursosReferencia(c.id);
};

// ═══════════════════════════════
// 🔁 Reusar PDF/videos de otro curso (cualquier sede del admin)
// ═══════════════════════════════
window.cursosReferenciaCache = {};

async function cargarCursosReferencia(cursoActualId) {
  const sel = document.getElementById('reusar-curso-select');
  sel.innerHTML = '<option value="">-- Selecciona un curso de referencia --</option>';

  const { data: cursos, error } = await supabase
    .from('cursos')
    .select('id, titulo, sede, url_material, objetivo')
    .in('sede', sedesAdminDisponibles.length ? sedesAdminDisponibles : ['ANTAMINA'])
    .order('sede').order('titulo');

  if (error) return;

  window.cursosReferenciaCache = {};
  (cursos || []).filter(c => c.id !== cursoActualId).forEach(c => {
    window.cursosReferenciaCache[c.id] = c;
    sel.innerHTML += `<option value="${c.id}">${c.titulo} (${c.sede})</option>`;
  });
}

window.usarPdfDeReferencia = function () {
  const refId = document.getElementById('reusar-curso-select').value;
  if (!refId) { alert('❌ Selecciona primero un curso de referencia.'); return; }
  const ref = window.cursosReferenciaCache[refId];
  if (!ref?.url_material) { alert('❌ Ese curso no tiene un PDF cargado.'); return; }
  document.getElementById('editar-curso-url-material').value = ref.url_material;
  alert('✅ PDF copiado. No olvides hacer clic en "Guardar cambios" para aplicarlo.');
};

window.usarObjetivoDeReferencia = function () {
  const refId = document.getElementById('reusar-curso-select').value;
  if (!refId) { alert('❌ Selecciona primero un curso de referencia.'); return; }
  const ref = window.cursosReferenciaCache[refId];
  if (!ref?.objetivo) { alert('❌ Ese curso no tiene un objetivo cargado.'); return; }
  document.getElementById('editar-curso-objetivo').value = ref.objetivo;
  alert('✅ Objetivo copiado. No olvides hacer clic en "Guardar cambios" para aplicarlo.');
};

window.copiarVideosDeReferencia = async function () {
  const cursoId = document.getElementById('editar-curso-id').value;
  const refId   = document.getElementById('reusar-curso-select').value;
  if (!cursoId) { alert('❌ Primero abre un curso para editar.'); return; }
  if (!refId)   { alert('❌ Selecciona primero un curso de referencia.'); return; }

  const ref = window.cursosReferenciaCache[refId];
  if (!await showConfirm(
    `¿Copiar todos los videos de "${ref.titulo} (${ref.sede})" a este curso? Se agregarán al final de la lista actual.`,
    { confirmText: 'Sí, copiar' }
  )) return;

  const { data: videosRef, error: errRef } = await supabase
    .from('videos_curso').select('url, orden')
    .eq('id_curso', refId).order('orden');
  if (errRef) { alert('❌ ' + errRef.message); return; }
  if (!videosRef?.length) { alert('❌ Ese curso no tiene videos.'); return; }

  const { data: existentes } = await supabase
    .from('videos_curso').select('orden')
    .eq('id_curso', cursoId).order('orden', { ascending: false }).limit(1);
  let orden = existentes?.[0]?.orden || 0;

  const nuevos = videosRef.map(v => ({ id_curso: cursoId, url: v.url, orden: ++orden, activo: true }));
  const { error } = await supabase.from('videos_curso').insert(nuevos);
  if (error) { alert('❌ Error al copiar videos: ' + error.message); return; }

  alert(`✅ ${nuevos.length} video(s) copiado(s).`);
  cargarVideosCurso(cursoId);
};

// ═══════════════════════════════
// 📑 Informe externo de capacitaciones (RBD) — mensual, por sede
// ═══════════════════════════════
const RBD_NOMBRE = 'RBD CONSULTORIA EMPRESARIAL E.I.R.L.';
const RBD_RESPONSABLE = 'Ing. Samuel Justiniani – Consultor SSOMA';
const RBD_MODALIDAD = 'Virtual-asincrónico';

window.generarInformeRBD = async function () {
  const mes    = parseInt(document.getElementById('rbd-mes').value);
  const anio   = parseInt(document.getElementById('rbd-anio').value);
  const status = document.getElementById('rbd-status');

  if (!mes || !anio) { alert('❌ Selecciona mes y año.'); return; }
  if (!window.html2canvas) { alert('❌ No se cargó html2canvas (necesario para generar el informe). Recarga la página.'); return; }

  status.textContent = '⏳ Preparando datos...';

  try {
    const desde = new Date(Date.UTC(anio, mes - 1, 1)).toISOString();
    const hasta = new Date(Date.UTC(mes === 12 ? anio + 1 : anio, mes === 12 ? 0 : mes, 1)).toISOString();

    const { data: empresa } = await supabase
      .from('empresas').select('nombre, ruc').eq('id', empresaAdminId).single();

    let { data: sedeCfg } = await supabase
      .from('sede_config').select('cliente_final').eq('sede', sedeAdminActiva).maybeSingle();

    if (!sedeCfg?.cliente_final) {
      const clienteFinal = prompt(`No tengo el "Proyecto/Cliente final" para la sede ${sedeAdminActiva}. Escríbelo (se guardará para la próxima vez):`);
      if (!clienteFinal) { status.textContent = ''; return; }
      const { error: errCfg } = await supabase.from('sede_config').upsert({ sede: sedeAdminActiva, cliente_final: clienteFinal });
      if (errCfg) { alert('❌ ' + errCfg.message); return; }
      sedeCfg = { cliente_final: clienteFinal };
    }

    // Cursos de la sede
    const { data: cursosSede, error: errCursosSede } = await supabase
      .from('cursos')
      .select('id, titulo, objetivo, duracion, codigo_prefijo, correlativo')
      .eq('sede', sedeAdminActiva);
    if (errCursosSede) throw errCursosSede;
    if (!cursosSede?.length) {
      status.textContent = `⚠️ No hay cursos registrados en la sede ${sedeAdminActiva}.`;
      return;
    }
    const cursoIds = cursosSede.map(c => c.id);
    const cursoById = {};
    cursosSede.forEach(c => cursoById[c.id] = c);

    // Se cuenta por fecha de APROBACIÓN DEL EXAMEN (envios_formulario), no por fecha
    // de emisión del certificado — el certificado puede generarse/descargarse después.
    // Paginado: meses con miles de aprobados (ej. jornadas de inducción masiva)
    // superan el límite de 1000 filas por consulta.
    const { data: envios, error: errEnvios } = await fetchAllRows(() => supabase
      .from('envios_formulario')
      .select('usuario_id, usuario_email, id_curso, puntaje, created_at, formularios(tipo)')
      .in('id_curso', cursoIds)
      .eq('aprobado', true)
      .eq('estado', 'completado')
      .gte('created_at', desde)
      .lt('created_at', hasta)
      .order('created_at'));
    if (errEnvios) throw errEnvios;

    // Mejor evaluación final (examen o eficacia) por usuario + curso
    const mapaMejor = {};
    for (const e of (envios || [])) {
      const tipo = e.formularios?.tipo;
      if (tipo !== 'examen' && tipo !== 'eficacia') continue;
      const key = `${e.usuario_id}__${e.id_curso}`;
      const previo = mapaMejor[key];
      if (!previo || new Date(e.created_at) > new Date(previo.created_at)) mapaMejor[key] = e;
    }
    const aprobados = Object.values(mapaMejor);

    if (!aprobados.length) {
      status.textContent = `⚠️ No hay exámenes aprobados en ${RN_MESES[mes - 1]} ${anio} para la sede ${sedeAdminActiva}.`;
      return;
    }

    const usuarioIds = [...new Set(aprobados.map(a => a.usuario_id).filter(Boolean))];
    const { data: perfiles, error: errPerfiles } = await supabase
      .from('profiles')
      .select('id, email, nombres, apellidos, documento_numero, cargos(nombre)')
      .in('id', usuarioIds);
    if (errPerfiles) throw errPerfiles;
    const mapaPerfiles = {};
    (perfiles || []).forEach(p => mapaPerfiles[p.id] = p);

    // Filtrado también por usuario_id (no solo curso_id) y en chunks + paginado:
    // con miles de certificados en la sede, sin esto la consulta se corta en las
    // primeras 1000 filas (límite por defecto de PostgREST) y certificados ya
    // existentes quedaban afuera del mapa, haciendo que el código intentara
    // crearlos de nuevo (chocando con la restricción UNIQUE).
    const { data: certsExistentes, error: errCertsEx } = await chunkedInQuery(
      usuarioIds, 150,
      (chunk) => fetchAllRows(() => supabase
        .from('certificados')
        .select('usuario_id, curso_id, codigo, nota, nombres, apellidos, dni, cargo')
        .in('curso_id', cursoIds)
        .in('usuario_id', chunk))
    );
    if (errCertsEx) throw errCertsEx;
    const mapaCert = {};
    (certsExistentes || []).forEach(c => mapaCert[`${c.usuario_id}__${c.curso_id}`] = c);

    // Regularizar (crear) los certificados que falten para los aprobados del periodo
    status.textContent = '🔄 Regularizando certificados faltantes...';
    const correlativosPorCurso = {};
    cursosSede.forEach(c => correlativosPorCurso[c.id] = Number(c.correlativo || 0));
    const nuevosCertificados = [];

    for (const a of aprobados) {
      const key = `${a.usuario_id}__${a.id_curso}`;
      if (mapaCert[key]) continue;
      const perfil = mapaPerfiles[a.usuario_id];
      if (!perfil) continue;
      const curso = cursoById[a.id_curso];
      correlativosPorCurso[curso.id] += 1;
      const anioCert = new Date(a.created_at).getFullYear().toString().slice(-2);
      const prefijo = curso.codigo_prefijo || 'CERT';
      const codigo = `${prefijo}-${anioCert}-${String(correlativosPorCurso[curso.id]).padStart(4, '0')}`;
      nuevosCertificados.push({
        usuario_id: a.usuario_id,
        usuario_email: a.usuario_email || perfil.email || '',
        curso_id: curso.id,
        sede: sedeAdminActiva,
        codigo,
        nota: Number(a.puntaje || 0),
        nombres: perfil.nombres || '',
        apellidos: perfil.apellidos || '',
        dni: perfil.documento_numero || '',
        cargo: perfil.cargos?.nombre || '',
        empresa: empresa?.nombre || '',
        fecha: a.created_at,
      });
    }

    if (nuevosCertificados.length) {
      status.textContent = `🔄 Regularizando ${nuevosCertificados.length} certificado(s) faltante(s)...`;

      // En lotes de 500 (jornadas masivas pueden generar miles de filas nuevas de golpe).
      // upsert + ignoreDuplicates: si por una condición de carrera (dos generaciones
      // del informe a la vez, o el trabajador generando su certificado en ese momento)
      // alguno ya fue creado por otro lado, no revienta el informe entero.
      const LOTE_INSERT = 500;
      for (let i = 0; i < nuevosCertificados.length; i += LOTE_INSERT) {
        const lote = nuevosCertificados.slice(i, i + LOTE_INSERT);
        const { data: insertados, error: errInsert } = await supabase
          .from('certificados')
          .upsert(lote, { onConflict: 'usuario_id,curso_id', ignoreDuplicates: true })
          .select('usuario_id, curso_id, codigo, nota, nombres, apellidos, dni, cargo');
        if (errInsert) throw errInsert;
        (insertados || []).forEach(c => mapaCert[`${c.usuario_id}__${c.curso_id}`] = c);
      }

      // Si algún conflicto quedó sin traer sus datos (ignoreDuplicates no los devuelve),
      // los completamos con una segunda consulta puntual.
      const faltantes = nuevosCertificados
        .map(n => `${n.usuario_id}__${n.curso_id}`)
        .filter(k => !mapaCert[k]);
      if (faltantes.length) {
        const idsFaltantes = [...new Set(faltantes.map(k => k.split('__')[0]))];
        const { data: recuperados } = await chunkedInQuery(
          idsFaltantes, 150,
          (chunk) => fetchAllRows(() => supabase
            .from('certificados')
            .select('usuario_id, curso_id, codigo, nota, nombres, apellidos, dni, cargo')
            .in('usuario_id', chunk)
            .in('curso_id', cursoIds))
        );
        (recuperados || []).forEach(c => mapaCert[`${c.usuario_id}__${c.curso_id}`] = c);
      }

      for (const [cid, correlativo] of Object.entries(correlativosPorCurso)) {
        if (correlativo !== Number(cursoById[cid].correlativo || 0)) {
          await supabase.from('cursos').update({ correlativo }).eq('id', cid);
        }
      }
    }

    // Agrupar por curso, usando la fecha real de aprobación del examen
    const cursosMap = {};
    for (const a of aprobados) {
      const cert = mapaCert[`${a.usuario_id}__${a.id_curso}`];
      if (!cert) continue;
      const curso = cursoById[a.id_curso];
      if (!cursosMap[curso.id]) cursosMap[curso.id] = { curso, filas: [] };
      cursosMap[curso.id].filas.push({
        dni: cert.dni,
        apellidos: cert.apellidos,
        nombres: cert.nombres,
        cargo: cert.cargo,
        nota: cert.nota,
        codigo: cert.codigo,
        fecha: a.created_at,
        curso,
      });
    }
    const gruposCursos = Object.values(cursosMap);
    const certs = gruposCursos.flatMap(g => g.filas);

    if (certs.length > 400) {
      const seguir = await showConfirm(
        `Este período tiene ${certs.length} certificados. Puede tardar varios minutos sin cerrar la pestaña. ¿Continuar?`,
        { confirmText: 'Sí, generar' }
      );
      if (!seguir) { status.textContent = ''; return; }
    }

    const { data: contadorRow } = await supabase
      .from('informes_rbd_contador').select('ultimo_numero').eq('sede', sedeAdminActiva).maybeSingle();
    const numeroInforme = (contadorRow?.ultimo_numero || 0) + 1;

    status.textContent = '🖨️ Generando informe...';

    const A4_W = 794, A4_H = 1123;       // portada y tablas: A4 vertical
    const CERT_W = 1122, CERT_H = 794;   // certificados: horizontal (su diseño original)
    const MARGIN = 40;
    const CONTENT_W = A4_W - MARGIN * 2;
    const HEADER_H = 40;

    // Portada y tablas se dibujan como texto vectorial (no capturas de pantalla) —
    // así cada página pesa unos pocos KB en vez de ~100-300KB, y el logo/encabezado
    // se repite en cada hoja sin costo de tamaño.
    const logoImg = await new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = RBD_LOGO_URL;
    });

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'px', format: [A4_W, A4_H], orientation: 'portrait' });
    let y = 0;

    function dibujarEncabezado() {
      if (logoImg) {
        const logoH = 20;
        const logoW = logoImg.naturalWidth && logoImg.naturalHeight
          ? (logoImg.naturalWidth / logoImg.naturalHeight) * logoH : 50;
        doc.addImage(logoImg, 'PNG', MARGIN, 8, logoW, logoH);
      }
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(120);
      doc.text('SSO-DO-001  ·  Versión 01', A4_W - MARGIN, 16, { align: 'right' });
      doc.setDrawColor(210);
      doc.setLineWidth(0.75);
      doc.line(MARGIN, HEADER_H, A4_W - MARGIN, HEADER_H);
      doc.setTextColor(0);
      y = HEADER_H + 18;
    }

    function nuevaPagina() {
      doc.addPage([A4_W, A4_H], 'portrait');
      dibujarEncabezado();
    }

    function asegurarEspacio(alto) {
      if (y + alto > A4_H - 30) nuevaPagina();
    }

    function escribirParrafo(texto, { size = 9.5, bold = false, gap = 6, align = 'left', x } = {}) {
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      doc.setFontSize(size);
      const lineas = doc.splitTextToSize(texto, CONTENT_W);
      const lineH = size * 1.35;
      const posX = x !== undefined ? x : (align === 'center' ? A4_W / 2 : align === 'right' ? A4_W - MARGIN : MARGIN);
      for (const linea of lineas) {
        asegurarEspacio(lineH);
        doc.text(linea, posX, y, { align });
        y += lineH;
      }
      y += gap;
    }

    dibujarEncabezado();

    // ── Portada ──
    escribirParrafo('INFORME EXTERNO CAPACITACIONES SSOMA', { size: 15, bold: true, align: 'center', gap: 10 });
    escribirParrafo(`Informe Mensual de Capacitación N° ${String(numeroInforme).padStart(2, '0')} - ${RN_MESES[mes - 1].toUpperCase()}`, { size: 11, bold: true, gap: 16 });
    escribirParrafo('1. Datos Generales', { size: 10, bold: true, gap: 8 });
    const datosGenerales = [
      ['Consultora', RBD_NOMBRE],
      ['Empresa capacitada', empresa?.nombre || '—'],
      ['RUC', empresa?.ruc || '—'],
      ['Proyecto/Cliente final', sedeCfg.cliente_final],
      ['Periodo capacitado y evaluado', `${RN_MESES[mes - 1]} ${anio}`],
      ['Modalidad', RBD_MODALIDAD],
      ['Responsable de capacitación', RBD_RESPONSABLE],
    ];
    for (const [label, valor] of datosGenerales) {
      escribirParrafo(`${label}: ${valor}`, { size: 9.5, gap: 5 });
    }

    // ── Por curso: objetivo + fecha/duración + tabla de capacitados ──
    const COLS = [
      { label: 'DNI', w: 55 },
      { label: 'Apellidos y nombres', w: 150 },
      { label: 'Puesto', w: 105 },
      { label: 'Estado', w: 50 },
      { label: 'Nota', w: 32 },
      { label: 'Fecha', w: 58 },
      { label: 'Horas', w: 38 },
      { label: 'Cert.', w: 32 },
      { label: 'Código', w: 90 },
    ];
    const FILA_H = 13;

    function dibujarCabeceraTabla() {
      asegurarEspacio(FILA_H * 2);
      doc.setFillColor(30, 58, 95);
      doc.rect(MARGIN, y, CONTENT_W, FILA_H + 3, 'F');
      doc.setTextColor(255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      let x = MARGIN + 3;
      for (const col of COLS) {
        doc.text(col.label, x, y + FILA_H - 2);
        x += col.w;
      }
      y += FILA_H + 3;
      doc.setTextColor(0);
      doc.setFont('helvetica', 'normal');
    }

    let numCurso = 1;
    for (const grupo of gruposCursos) {
      const c = grupo.curso;
      const filas = grupo.filas;
      const fechaCurso = new Date(filas[0].fecha).toLocaleDateString('es-PE', { day: '2-digit', month: 'long', year: 'numeric' });
      const duracionTxt = c.duracion ? `${c.duracion} hora${c.duracion > 1 ? 's' : ''}` : '—';

      asegurarEspacio(40);
      escribirParrafo(`2.${numCurso}. Curso ${c.titulo}`, { size: 11, bold: true, gap: 8 });
      escribirParrafo(`2.${numCurso}.1. Objetivos`, { size: 9.5, bold: true, gap: 4 });
      escribirParrafo(c.objetivo || 'No se registró un objetivo para este curso.', { size: 9, gap: 10 });
      escribirParrafo(`2.${numCurso}.2. Fecha y duración`, { size: 9.5, bold: true, gap: 4 });
      escribirParrafo(`Realizado el ${fechaCurso} con una duración de ${duracionTxt}.`, { size: 9, gap: 10 });
      escribirParrafo(`2.${numCurso}.3. Relación de trabajadores capacitados`, { size: 9.5, bold: true, gap: 8 });

      dibujarCabeceraTabla();
      doc.setFontSize(7);
      for (const f of filas) {
        if (y + FILA_H + 2 > A4_H - 30) { nuevaPagina(); dibujarCabeceraTabla(); doc.setFontSize(7); }
        let x = MARGIN + 3;
        const valores = [
          f.dni || '',
          `${f.apellidos || ''} ${f.nombres || ''}`.trim(),
          f.cargo || '',
          'Aprobado',
          Number(f.nota).toFixed(0),
          new Date(f.fecha).toLocaleDateString('es-PE'),
          String(c.duracion || ''),
          'Sí',
          f.codigo || '',
        ];
        valores.forEach((val, i) => {
          const texto = doc.splitTextToSize(String(val), COLS[i].w - 4)[0] || '';
          doc.text(texto, x, y + FILA_H - 3);
          x += COLS[i].w;
        });
        doc.setDrawColor(230);
        doc.line(MARGIN, y + FILA_H, MARGIN + CONTENT_W, y + FILA_H);
        y += FILA_H;
      }
      y += 14;
      numCurso++;
    }

    // ── Hoja de cierre (firma) ──
    const firmaImg = await new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = FIRMA_RBD_URL;
    });
    nuevaPagina();
    y += 20;
    escribirParrafo('Esto es todo cuanto puedo manifestar.', { size: 10, gap: 8 });
    escribirParrafo('Atentamente:', { size: 10, gap: 50 });
    if (firmaImg) {
      const firmaH = 65;
      const firmaW = firmaImg.naturalWidth && firmaImg.naturalHeight
        ? (firmaImg.naturalWidth / firmaImg.naturalHeight) * firmaH : 130;
      doc.addImage(firmaImg, A4_W - MARGIN - firmaW, y, firmaW, firmaH);
      y += firmaH + 4;
    } else {
      y += 20;
    }
    doc.setDrawColor(0);
    doc.setLineWidth(0.75);
    doc.line(A4_W - MARGIN - 200, y, A4_W - MARGIN, y);
    y += 10;
    escribirParrafo('SAMUEL DANIEL JUSTINIANI ARANDA', { size: 9, bold: true, align: 'right', gap: 2 });
    escribirParrafo('Especialista SSOMA', { size: 8.5, align: 'right', gap: 1 });
    escribirParrafo('Ingeniero Metalurgista CIP:181200', { size: 8.5, align: 'right', gap: 4 });

    // ── Certificados individuales (logo y membrete RBD) — siempre en el mismo PDF.
    // Con la compresión liviana cada certificado pesa ~45-50KB, así que incluso
    // varios cientos entran sin problema en un solo archivo.
    status.textContent = `🖨️ Generando 0 / ${certs.length} certificados...`;
    for (let i = 0; i < certs.length; i++) {
      const f = certs[i];
      const c = f.curso;
      const duracionTxt = c.duracion ? `${c.duracion} hora${c.duracion > 1 ? 's' : ''}` : '';
      const nombreCompleto = `${f.apellidos || ''} ${f.nombres || ''}`.trim().toUpperCase();
      const notaTexto = Number.isFinite(Number(f.nota)) ? Number(f.nota).toFixed(1) : String(f.nota || '');
      const fechaCert = new Date(f.fecha).toLocaleDateString('es-PE', { day: '2-digit', month: 'long', year: 'numeric' });

      const htmlCert = buildHtmlCertificado({
        nombreCompleto, dni: f.dni, documentoTipo: 'DNI', cargo: f.cargo,
        cursotitulo: c.titulo, duracion: duracionTxt, notaTexto, fechaHoy: fechaCert,
        codigo: f.codigo, logoUrl: RBD_LOGO_URL, empresaNombre: RBD_NOMBRE,
      });
      const canvas = await generarCertificadoCanvas(htmlCert, true); // liviano
      doc.addPage([CERT_W, CERT_H], 'landscape');
      doc.addImage(canvas.toDataURL('image/jpeg', 0.55), 'JPEG', 0, 0, CERT_W, CERT_H);
      status.textContent = `🖨️ Generando ${i + 1} / ${certs.length} certificados...`;
    }

    status.textContent = '💾 Guardando PDF...';
    doc.save(`Informe_RBD_${sedeAdminActiva}_${RN_MESES[mes - 1]}_${anio}.pdf`);

    await supabase.from('informes_rbd_contador').upsert({ sede: sedeAdminActiva, ultimo_numero: numeroInforme });

    status.textContent = `✅ Listo: informe N° ${String(numeroInforme).padStart(2, '0')} - ${RN_MESES[mes - 1]} ${anio} (${certs.length} certificados, ${gruposCursos.length} curso(s)).`;
  } catch (err) {
    console.error('Error generando informe RBD:', err);
    status.textContent = `❌ ${err?.message || 'No se pudo generar el informe.'}`;
  }
};

window.cerrarPanelEditarCurso = function () {
  document.getElementById('panel-editar-curso').style.display = 'none';
  const sel = document.getElementById('select-curso-editar');
  if (sel) sel.value = '';
};

window.subirPdfCurso = async function () {
  const cursoId    = document.getElementById('editar-curso-id').value;
  const fileInput  = document.getElementById('editar-curso-pdf-file');
  const file       = fileInput.files[0];

  if (!cursoId) { alert('❌ Primero abre un curso para editar.'); return; }
  if (!file)    { alert('❌ Selecciona un archivo PDF.'); return; }
  if (file.type !== 'application/pdf') { alert('❌ El archivo debe ser un PDF.'); return; }

  const nombreArchivo = `${cursoId}-${file.name}`.replace(/[^a-zA-Z0-9._-]/g, '_');

  const { error: errUpload } = await supabase.storage
    .from('materiales')
    .upload(nombreArchivo, file, { upsert: true, contentType: 'application/pdf' });

  if (errUpload) { alert('❌ Error al subir el PDF: ' + errUpload.message); return; }

  const { data: pub } = supabase.storage.from('materiales').getPublicUrl(nombreArchivo);
  const url_material = pub.publicUrl;

  const { error: errUpdate } = await supabase.from('cursos')
    .update({ url_material }).eq('id', cursoId);

  if (errUpdate) { alert('❌ El PDF se subió pero no se pudo guardar la URL: ' + errUpdate.message); return; }

  document.getElementById('editar-curso-url-material').value = url_material;
  fileInput.value = '';
  alert('✅ PDF subido y guardado correctamente.');
};

window.guardarEdicionCurso = async function () {
  const id            = document.getElementById('editar-curso-id').value;
  const titulo        = document.getElementById('editar-curso-titulo').value.trim();
  const codigo_prefijo= document.getElementById('editar-curso-codigo-prefijo').value.trim().toUpperCase();
  const codigo        = document.getElementById('editar-curso-codigo').value.trim();
  const duracion      = parseInt(document.getElementById('editar-curso-duracion').value);
  const vigenciaRaw   = document.getElementById('editar-curso-vigencia').value;
  const vigencia_meses= vigenciaRaw ? parseInt(vigenciaRaw) : null;
  const url_material  = document.getElementById('editar-curso-url-material').value.trim();
  const objetivo      = document.getElementById('editar-curso-objetivo').value.trim();

  if (!titulo || !codigo_prefijo || !duracion) {
    alert('❌ Completa los campos obligatorios: título, prefijo y duración.');
    return;
  }

  const { error } = await supabase.from('cursos').update({
    titulo,
    codigo_prefijo,
    codigo:       codigo       || null,
    duracion,
    vigencia_meses,
    url_material: url_material || null,
    objetivo:     objetivo     || null,
  }).eq('id', id);

  if (error) { alert('❌ Error al guardar: ' + error.message); return; }

  alert('✅ Curso actualizado.');
  cerrarPanelEditarCurso();
  cargarListaCursos();
};

// ═══════════════════════════════
// 🎬 Videos del curso (videos_curso)
// ═══════════════════════════════
window.cargarVideosCurso = async function (cursoId) {
  const cont = document.getElementById('lista-videos-curso');
  cont.innerHTML = '<p style="color:#888;font-size:0.82rem;">Cargando videos...</p>';

  const { data: videos, error } = await supabase
    .from('videos_curso').select('*')
    .eq('id_curso', cursoId).order('orden');

  if (error) { cont.innerHTML = `<p style="color:red;font-size:0.82rem;">❌ ${error.message}</p>`; return; }
  if (!videos?.length) { cont.innerHTML = '<p style="color:#888;font-size:0.82rem;">Este curso no tiene videos aún.</p>'; return; }

  cont.innerHTML = videos.map(v => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;border:1px solid #eee;border-radius:6px;margin-bottom:6px;font-size:0.82rem;">
      <a href="${v.url}" target="_blank" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:260px;">${v.url}</a>
      <button onclick="eliminarVideoCurso(${v.id}, '${cursoId}')"
              style="background:#dc3545;color:white;border:none;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:0.78rem;">
        Eliminar
      </button>
    </div>`).join('');
};

window.agregarVideoCurso = async function () {
  const cursoId  = document.getElementById('editar-curso-id').value;
  const urlCruda = document.getElementById('nuevo-video-url').value.trim();

  if (!cursoId)  { alert('❌ Primero guarda o abre un curso.'); return; }
  if (!urlCruda) { alert('❌ Pega el link de YouTube.'); return; }

  const videoId = extraerIdYoutube(urlCruda);
  if (!videoId) {
    alert('❌ No reconozco ese link de YouTube. Pega el link que te da el botón "Compartir" del video.');
    return;
  }
  const url = `https://www.youtube.com/embed/${videoId}`;

  const { data: existentes } = await supabase
    .from('videos_curso').select('orden')
    .eq('id_curso', cursoId).order('orden', { ascending: false }).limit(1);
  const orden = (existentes?.[0]?.orden || 0) + 1;

  const { error } = await supabase.from('videos_curso')
    .insert([{ id_curso: cursoId, url, orden, activo: true }]);

  if (error) { alert('❌ Error al agregar video: ' + error.message); return; }

  document.getElementById('nuevo-video-url').value = '';
  cargarVideosCurso(cursoId);
};

window.eliminarVideoCurso = async function (id, cursoId) {
  if (!confirm('¿Eliminar este video del curso?')) return;
  const { error } = await supabase.from('videos_curso').delete().eq('id', id);
  if (error) { alert('❌ Error al eliminar: ' + error.message); return; }
  cargarVideosCurso(cursoId);
};

// ═══════════════════════════════════════════════
// 📝 GESTIÓN DE FORMULARIOS (EXAMEN / EFICACIA)
// ═══════════════════════════════════════════════

window.initSelectCursoForm = async function initSelectCursoForm() {
  const sel = document.getElementById('select-curso-form');
  if (!sel || sel.options.length > 1) return;
  const { data } = await supabase.from('cursos').select('id, titulo').eq('activo', true).eq('sede', sedeAdminActiva).order('titulo');
  data?.forEach(c => { sel.innerHTML += `<option value="${c.id}">${c.titulo}</option>`; });
  initSelectBuscable('select-curso-form');
}

let _cursoFormularioActivo = null;
let _tipoFormularioActivo = 'examen';

window.cargarFormulariosCurso = async function () {
  await initSelectCursoForm();
  const sel = document.getElementById('select-curso-form');
  const cursoId = sel.value;
  if (!cursoId) { document.getElementById('contenedor-formularios').innerHTML = ''; return; }
  _cursoFormularioActivo = cursoId;

  const { data: forms } = await supabase
    .from('formularios').select('*')
    .eq('id_curso', cursoId).in('tipo', ['examen', 'eficacia']);

  const cont = document.getElementById('contenedor-formularios');
  const tabBtn = (tipo, texto) => `
    <button onclick="cambiarTipoFormulario('${tipo}')"
      style="padding:9px 16px; border:none; border-bottom:2px solid ${_tipoFormularioActivo === tipo ? '#1e3a5f' : 'transparent'};
             background:none; cursor:pointer; font-size:0.88rem; font-weight:${_tipoFormularioActivo === tipo ? '600' : '500'};
             color:${_tipoFormularioActivo === tipo ? '#1e3a5f' : '#667'};">
      ${texto}
    </button>`;

  cont.innerHTML = `
    <div style="display:flex; gap:4px; border-bottom:1px solid #e5e8ec; margin-bottom:14px;">
      ${tabBtn('examen', '📝 Examen')}
      ${tabBtn('eficacia', '✅ Evaluación de la eficacia')}
    </div>
    <div id="bloque-formulario-actual"></div>`;

  renderBloqueFormulario(cursoId, _tipoFormularioActivo, forms?.find(f => f.tipo === _tipoFormularioActivo));
};

window.cambiarTipoFormulario = function (tipo) {
  _tipoFormularioActivo = tipo;
  cargarFormulariosCurso();
};

async function renderBloqueFormulario(cursoId, tipo, form) {
  const bloque = document.getElementById('bloque-formulario-actual');
  if (!bloque) return;

  if (!form) {
    bloque.innerHTML = `<p style="color:#888;font-size:0.85rem;">
      No existe aún para este curso.
      <button onclick="crearFormulario('${cursoId}','${tipo}')" class="btn-primary" style="font-size:0.85rem; margin-left:8px;">+ Crear</button>
    </p>`;
    return;
  }

  bloque.innerHTML = `
    <div style="display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px;">
      <a href="#" onclick="descargarPlantillaPreguntas(event)" style="font-size:0.8rem;color:#666;text-decoration:underline;">⬇️ Plantilla Excel</a>
      <input type="file" id="import-preg-${form.id}" accept=".xlsx,.xls" style="display:none;"
        onchange="importarPreguntasExcel(${form.id},'${tipo}', this)" />
      <button onclick="document.getElementById('import-preg-${form.id}').click()" class="btn-secondary" style="font-size:0.85rem;">📥 Importar Excel</button>
      <button onclick="abrirModalNuevaPregunta(${form.id},'${tipo}')" class="btn-primary" style="font-size:0.85rem;">+ Nueva pregunta</button>
    </div>
    <div id="progreso-import-preg-${form.id}" style="font-size:0.82rem;color:#666;margin-bottom:8px;"></div>
    <div id="lista-preguntas-${form.id}"><em style="color:#888;font-size:0.85rem;">Cargando...</em></div>`;
  cargarPreguntas(form.id, tipo);
}

window.crearFormulario = async function (cursoId, tipo) {
  const label = tipo === 'examen' ? 'Examen' : 'Evaluación de la eficacia';
  const { error } = await supabase.from('formularios').insert([{ tipo, titulo: label, id_curso: cursoId, activo: true }]);
  if (error) { alert('❌ ' + error.message); return; }
  cargarFormulariosCurso();
};

// ── Nueva pregunta: modal con la pregunta y hasta 5 opciones (marcando la correcta) a la vez ──
window.abrirModalNuevaPregunta = function (formularioId, tipo) {
  document.getElementById('mnp-formulario-id').value = formularioId;
  document.getElementById('mnp-tipo').value = tipo;
  document.getElementById('mnp-texto').value = '';
  document.getElementById('mnp-puntaje').value = 1;
  for (let i = 1; i <= 5; i++) {
    document.getElementById(`mnp-op-${i}`).value = '';
    document.getElementById(`mnp-correcta-${i}`).checked = false;
  }
  document.getElementById('modal-nueva-pregunta').style.display = 'flex';
  document.getElementById('mnp-texto').focus();
};

window.cerrarModalNuevaPregunta = function () {
  document.getElementById('modal-nueva-pregunta').style.display = 'none';
};

window.guardarNuevaPreguntaCompleta = async function () {
  const formularioId = document.getElementById('mnp-formulario-id').value;
  const tipo = document.getElementById('mnp-tipo').value;
  const texto = document.getElementById('mnp-texto').value.trim();
  const pts = parseFloat(document.getElementById('mnp-puntaje').value) || 1;
  if (!texto) { alert('❌ Escribe el texto de la pregunta.'); return; }

  const opciones = [];
  for (let i = 1; i <= 5; i++) {
    const val = document.getElementById(`mnp-op-${i}`).value.trim();
    if (val) opciones.push({ texto: val, correcta: document.getElementById(`mnp-correcta-${i}`).checked, orden: i });
  }
  if (opciones.length && !opciones.some(o => o.correcta)) {
    alert('❌ Marca cuál opción es la correcta.');
    return;
  }

  const { data: ult } = await supabase.from('preguntas').select('orden')
    .eq('id_formulario', formularioId).order('orden', { ascending: false }).limit(1);
  const orden = (ult?.[0]?.orden || 0) + 1;

  const { data: nuevaPregunta, error } = await supabase.from('preguntas')
    .insert([{ id_formulario: formularioId, pregunta: texto, orden, puntaje: pts }])
    .select().single();
  if (error || !nuevaPregunta) { alert('❌ ' + (error?.message || 'No se pudo crear la pregunta.')); return; }

  if (opciones.length) {
    const { error: errOp } = await supabase.from('opciones_pregunta').insert(
      opciones.map(o => ({ id_pregunta: nuevaPregunta.id, opcion: o.texto, orden: o.orden, es_correcta: o.correcta }))
    );
    if (errOp) { alert('⚠️ La pregunta se creó, pero hubo un error al guardar las opciones: ' + errOp.message); }
  }

  cerrarModalNuevaPregunta();
  cargarPreguntas(formularioId, tipo);
};

window.descargarPlantillaPreguntas = function (e) {
  e?.preventDefault();
  const XLSX = window.XLSX;
  const datos = [
    ['Pregunta', 'Puntaje', 'Opción 1', 'Opción 2', 'Opción 3', 'Opción 4', 'Opción 5', 'Correcta (1-5)'],
    ['¿Cuál es el equipo de protección obligatorio para trabajos en altura?', 1, 'Arnés', 'Guantes', 'Botas', 'Casco', '', 1],
  ];
  const ws = XLSX.utils.aoa_to_sheet(datos);
  ws['!cols'] = [{ wch: 45 }, { wch: 10 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 14 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Preguntas');
  XLSX.writeFile(wb, 'plantilla_preguntas.xlsx');
};

// Importa preguntas de opción múltiple en bloque desde Excel.
// Columnas: Pregunta, Puntaje, Opción 1-5 (deja vacías las que no uses), Correcta (1-5).
window.importarPreguntasExcel = async function (formularioId, tipo, inputEl) {
  const file = inputEl.files[0];
  if (!file) return;

  const progreso = document.getElementById(`progreso-import-preg-${formularioId}`);
  if (progreso) progreso.textContent = '⏳ Leyendo Excel...';

  const XLSX = window.XLSX;
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const filas = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }).slice(1).filter(f => f?.[0]);

  if (!filas.length) {
    if (progreso) progreso.textContent = '❌ El Excel está vacío o no tiene el formato esperado.';
    inputEl.value = '';
    return;
  }

  const { data: ult } = await supabase.from('preguntas').select('orden')
    .eq('id_formulario', formularioId).order('orden', { ascending: false }).limit(1);
  let orden = ult?.[0]?.orden || 0;

  let ok = 0, errores = 0;
  for (let i = 0; i < filas.length; i++) {
    if (progreso) progreso.textContent = `⏳ Importando ${i + 1} de ${filas.length}...`;
    const [pregunta, puntaje, op1, op2, op3, op4, op5, correcta] = filas[i];
    if (!pregunta) continue;
    orden++;

    const { data: nuevaPregunta, error } = await supabase.from('preguntas')
      .insert([{ id_formulario: formularioId, pregunta: String(pregunta).trim(), orden, puntaje: parseFloat(puntaje) || 1 }])
      .select().single();

    if (error || !nuevaPregunta) { errores++; continue; }

    const opciones = [op1, op2, op3, op4, op5]
      .map((texto, idx) => texto ? {
        id_pregunta: nuevaPregunta.id,
        opcion: String(texto).trim(),
        orden: idx + 1,
        es_correcta: parseInt(correcta) === idx + 1,
      } : null)
      .filter(Boolean);

    if (opciones.length) {
      const { error: errOp } = await supabase.from('opciones_pregunta').insert(opciones);
      if (errOp) { errores++; continue; }
    }
    ok++;
  }

  if (progreso) progreso.textContent = `✅ ${ok} pregunta(s) importada(s).${errores ? ` ❌ ${errores} con error.` : ''}`;
  inputEl.value = '';
  cargarPreguntas(formularioId, tipo);
};

window.guardarNuevaPregunta = async function (formularioId, tipo) {
  const texto = document.getElementById(`txt-pregunta-${formularioId}`).value.trim();
  const pts   = parseFloat(document.getElementById(`pts-pregunta-${formularioId}`).value) || 1;
  if (!texto) { alert('Escribe el texto de la pregunta.'); return; }

  const { data: ult } = await supabase.from('preguntas').select('orden')
    .eq('id_formulario', formularioId).order('orden', { ascending: false }).limit(1);
  const orden = (ult?.[0]?.orden || 0) + 1;

  const { error } = await supabase.from('preguntas').insert([{ id_formulario: formularioId, pregunta: texto, orden, puntaje: pts }]);
  if (error) { alert('❌ ' + error.message); return; }
  document.getElementById(`txt-pregunta-${formularioId}`).value = '';
  document.getElementById(`form-nueva-pregunta-${formularioId}`).style.display = 'none';
  cargarPreguntas(formularioId, tipo);
};

async function cargarPreguntas(formularioId, tipo) {
  const { data: preguntas } = await supabase
    .from('preguntas').select('*, opciones_pregunta(*)')
    .eq('id_formulario', formularioId).order('orden');

  const cont = document.getElementById(`lista-preguntas-${formularioId}`);
  if (!cont) return;

  if (!preguntas?.length) {
    cont.innerHTML = '<p style="color:#888;font-size:0.85rem;">Sin preguntas. Agrega la primera.</p>';
    return;
  }

  cont.innerHTML = preguntas.map((p, i) => {
    const opciones = (p.opciones_pregunta || []).sort((a, b) => a.orden - b.orden).map(o => `
      <div style="display:flex;align-items:center;gap:8px;padding:5px 8px;margin-bottom:4px;
        background:${o.es_correcta ? '#d4edda' : '#f8f9fa'};border-radius:6px;font-size:0.85rem;">
        <span id="opcion-view-${o.id}" style="flex:1;">${o.opcion}</span>
        <input id="opcion-edit-${o.id}" type="text" value="${o.opcion.replace(/"/g, '&quot;')}"
          style="display:none;flex:1;padding:4px 7px;border:1px solid #ddd;border-radius:4px;font-size:0.85rem;" />
        <button id="opcion-btn-editar-${o.id}" onclick="editarOpcion(${o.id})"
          style="background:transparent;border:1px solid #ccc;border-radius:4px;padding:3px 7px;cursor:pointer;font-size:0.78rem;">✏️</button>
        <button id="opcion-btn-guardar-${o.id}" onclick="guardarEdicionOpcion(${o.id},${p.id},${formularioId},'${tipo}')"
          style="display:none;background:#1e3a5f;color:white;border:none;border-radius:4px;padding:3px 8px;cursor:pointer;font-size:0.78rem;">Guardar</button>
        <button id="opcion-btn-cancelar-${o.id}" onclick="cancelarEdicionOpcion(${o.id})"
          style="display:none;background:#e0e0e0;border:none;border-radius:4px;padding:3px 7px;cursor:pointer;font-size:0.78rem;">✕</button>
        <button onclick="toggleCorrecta(${o.id},${p.id},${formularioId},'${tipo}')"
          style="background:${o.es_correcta ? '#28a745' : '#e0e0e0'};color:${o.es_correcta ? 'white' : '#555'};
          border:none;border-radius:4px;padding:3px 8px;cursor:pointer;font-size:0.78rem;">
          ${o.es_correcta ? '✓ Correcta' : 'Marcar'}</button>
        <button onclick="eliminarOpcion(${o.id},${p.id},${formularioId},'${tipo}')"
          style="background:#dc3545;color:white;border:none;border-radius:4px;padding:3px 7px;cursor:pointer;font-size:0.78rem;">✕</button>
      </div>`).join('');

    return `
      <div style="border-left:3px solid #1e3a5f;padding:10px 14px;margin-bottom:12px;background:#fafafa;border-radius:0 8px 8px 0;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
          <div id="pregunta-view-${p.id}" style="flex:1;">
            <span style="font-weight:600;color:#1e3a5f;font-size:0.85rem;">${i + 1}.</span>
            <span style="font-size:0.9rem;margin-left:6px;">${p.pregunta}</span>
            <span style="color:#888;font-size:0.78rem;margin-left:8px;">(${p.puntaje} pt${p.puntaje !== 1 ? 's' : ''})</span>
          </div>
          <div id="pregunta-edit-${p.id}" style="display:none;flex:1;gap:6px;align-items:center;flex-wrap:wrap;">
            <input id="txt-editar-pregunta-${p.id}" type="text" value="${p.pregunta.replace(/"/g, '&quot;')}"
              style="flex:1;min-width:200px;padding:6px 9px;border:1px solid #ddd;border-radius:5px;font-size:0.85rem;" />
            <input id="pts-editar-pregunta-${p.id}" type="number" min="1" value="${p.puntaje}"
              style="width:70px;padding:6px 9px;border:1px solid #ddd;border-radius:5px;font-size:0.85rem;" />
          </div>
          <div style="display:flex;gap:6px;margin-left:8px;white-space:nowrap;">
            <button id="pregunta-btn-editar-${p.id}" onclick="editarPregunta(${p.id})"
              style="background:transparent;border:1px solid #ccc;border-radius:5px;padding:4px 9px;cursor:pointer;font-size:0.8rem;">✏️ Editar</button>
            <button id="pregunta-btn-guardar-${p.id}" onclick="guardarEdicionPregunta(${p.id},${formularioId},'${tipo}')"
              style="display:none;background:#1e3a5f;color:white;border:none;border-radius:5px;padding:4px 9px;cursor:pointer;font-size:0.8rem;">Guardar</button>
            <button id="pregunta-btn-cancelar-${p.id}" onclick="cancelarEdicionPregunta(${p.id})"
              style="display:none;background:#e0e0e0;border:none;border-radius:5px;padding:4px 9px;cursor:pointer;font-size:0.8rem;">Cancelar</button>
            <button onclick="eliminarPregunta(${p.id},${formularioId},'${tipo}')"
              style="background:#dc3545;color:white;border:none;border-radius:5px;padding:4px 9px;cursor:pointer;font-size:0.8rem;">
              🗑️ Eliminar</button>
          </div>
        </div>
        <div>${opciones || '<em style="color:#aaa;font-size:0.82rem;">Sin opciones</em>'}</div>
        <div id="form-opcion-${p.id}" style="display:none;margin-top:8px;">
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
            <input id="txt-opcion-${p.id}" type="text" placeholder="Texto de la opción *"
              style="flex:1;min-width:180px;padding:6px 9px;border:1px solid #ddd;border-radius:5px;font-size:0.85rem;" />
            <button onclick="guardarNuevaOpcion(${p.id},${formularioId},'${tipo}')" class="btn-primary" style="font-size:0.82rem;padding:6px 12px;">Guardar</button>
            <button onclick="document.getElementById('form-opcion-${p.id}').style.display='none'"
              style="background:#e0e0e0;border:none;border-radius:5px;padding:6px 10px;cursor:pointer;font-size:0.82rem;">✕</button>
          </div>
        </div>
        <button onclick="document.getElementById('form-opcion-${p.id}').style.display='flex';document.getElementById('txt-opcion-${p.id}').focus()"
          style="margin-top:8px;background:transparent;border:1px dashed #aaa;border-radius:5px;padding:4px 10px;cursor:pointer;font-size:0.8rem;color:#666;">
          + Agregar opción</button>
      </div>`;
  }).join('');
}

window.editarPregunta = function (preguntaId) {
  document.getElementById(`pregunta-view-${preguntaId}`).style.display = 'none';
  document.getElementById(`pregunta-edit-${preguntaId}`).style.display = 'flex';
  document.getElementById(`pregunta-btn-editar-${preguntaId}`).style.display = 'none';
  document.getElementById(`pregunta-btn-guardar-${preguntaId}`).style.display = 'inline-block';
  document.getElementById(`pregunta-btn-cancelar-${preguntaId}`).style.display = 'inline-block';
  document.getElementById(`txt-editar-pregunta-${preguntaId}`).focus();
};

window.cancelarEdicionPregunta = function (preguntaId) {
  document.getElementById(`pregunta-view-${preguntaId}`).style.display = 'block';
  document.getElementById(`pregunta-edit-${preguntaId}`).style.display = 'none';
  document.getElementById(`pregunta-btn-editar-${preguntaId}`).style.display = 'inline-block';
  document.getElementById(`pregunta-btn-guardar-${preguntaId}`).style.display = 'none';
  document.getElementById(`pregunta-btn-cancelar-${preguntaId}`).style.display = 'none';
};

window.guardarEdicionPregunta = async function (preguntaId, formularioId, tipo) {
  const texto = document.getElementById(`txt-editar-pregunta-${preguntaId}`).value.trim();
  const pts   = parseFloat(document.getElementById(`pts-editar-pregunta-${preguntaId}`).value) || 1;
  if (!texto) { alert('❌ Escribe el texto de la pregunta.'); return; }

  const { error } = await supabase.from('preguntas').update({ pregunta: texto, puntaje: pts }).eq('id', preguntaId);
  if (error) { alert('❌ ' + error.message); return; }
  cargarPreguntas(formularioId, tipo);
};

window.editarOpcion = function (opcionId) {
  document.getElementById(`opcion-view-${opcionId}`).style.display = 'none';
  document.getElementById(`opcion-edit-${opcionId}`).style.display = 'block';
  document.getElementById(`opcion-btn-editar-${opcionId}`).style.display = 'none';
  document.getElementById(`opcion-btn-guardar-${opcionId}`).style.display = 'inline-block';
  document.getElementById(`opcion-btn-cancelar-${opcionId}`).style.display = 'inline-block';
  document.getElementById(`opcion-edit-${opcionId}`).focus();
};

window.cancelarEdicionOpcion = function (opcionId) {
  document.getElementById(`opcion-view-${opcionId}`).style.display = 'block';
  document.getElementById(`opcion-edit-${opcionId}`).style.display = 'none';
  document.getElementById(`opcion-btn-editar-${opcionId}`).style.display = 'inline-block';
  document.getElementById(`opcion-btn-guardar-${opcionId}`).style.display = 'none';
  document.getElementById(`opcion-btn-cancelar-${opcionId}`).style.display = 'none';
};

window.guardarEdicionOpcion = async function (opcionId, preguntaId, formularioId, tipo) {
  const texto = document.getElementById(`opcion-edit-${opcionId}`).value.trim();
  if (!texto) { alert('❌ Escribe el texto de la opción.'); return; }

  const { error } = await supabase.from('opciones_pregunta').update({ opcion: texto }).eq('id', opcionId);
  if (error) { alert('❌ ' + error.message); return; }
  cargarPreguntas(formularioId, tipo);
};

window.eliminarPregunta = async function (preguntaId, formularioId, tipo) {
  if (!await showConfirm('¿Eliminar esta pregunta y todas sus opciones?', { confirmText: 'Eliminar' })) return;
  await supabase.from('opciones_pregunta').delete().eq('id_pregunta', preguntaId);
  await supabase.from('preguntas').delete().eq('id', preguntaId);
  cargarPreguntas(formularioId, tipo);
};

window.guardarNuevaOpcion = async function (preguntaId, formularioId, tipo) {
  const texto = document.getElementById(`txt-opcion-${preguntaId}`).value.trim();
  if (!texto) { alert('Escribe el texto de la opción.'); return; }

  const { data: ult } = await supabase.from('opciones_pregunta').select('orden')
    .eq('id_pregunta', preguntaId).order('orden', { ascending: false }).limit(1);
  const orden = (ult?.[0]?.orden || 0) + 1;

  const { error } = await supabase.from('opciones_pregunta').insert([{ id_pregunta: preguntaId, opcion: texto, orden, es_correcta: false }]);
  if (error) { alert('❌ ' + error.message); return; }
  document.getElementById(`txt-opcion-${preguntaId}`).value = '';
  document.getElementById(`form-opcion-${preguntaId}`).style.display = 'none';
  cargarPreguntas(formularioId, tipo);
};

window.eliminarOpcion = async function (opcionId, preguntaId, formularioId, tipo) {
  await supabase.from('opciones_pregunta').delete().eq('id', opcionId);
  cargarPreguntas(formularioId, tipo);
};

window.toggleCorrecta = async function (opcionId, preguntaId, formularioId, tipo) {
  const { data: op } = await supabase.from('opciones_pregunta').select('es_correcta').eq('id', opcionId).single();
  if (op?.es_correcta) {
    await supabase.from('opciones_pregunta').update({ es_correcta: false }).eq('id', opcionId);
  } else {
    await supabase.from('opciones_pregunta').update({ es_correcta: false }).eq('id_pregunta', preguntaId);
    await supabase.from('opciones_pregunta').update({ es_correcta: true  }).eq('id', opcionId);
  }
  cargarPreguntas(formularioId, tipo);
};

// ═══════════════════════════════════════════════
// 📋 ENCUESTA GLOBAL (LIKERT)
// ═══════════════════════════════════════════════

const OPCIONES_LIKERT = [
  { opcion: 'Totalmente de acuerdo',           puntaje: 5, orden: 1 },
  { opcion: 'De acuerdo',                       puntaje: 4, orden: 2 },
  { opcion: 'Ni de acuerdo ni en desacuerdo',   puntaje: 3, orden: 3 },
  { opcion: 'En desacuerdo',                    puntaje: 2, orden: 4 },
  { opcion: 'Totalmente en desacuerdo',         puntaje: 1, orden: 5 },
];

window.cargarEncuestaGlobal = async function () {
  let { data: form } = await supabase
    .from('formularios').select('*').eq('tipo', 'encuesta').is('id_curso', null).maybeSingle();

  if (!form) {
    const { data: nuevo } = await supabase
      .from('formularios').insert([{ tipo: 'encuesta', titulo: 'Encuesta de satisfacción', activo: true }]).select().single();
    form = nuevo;
  }
  if (!form) { alert('❌ Error al cargar la encuesta.'); return; }

  const { data: preguntas } = await supabase
    .from('preguntas').select('id, pregunta, orden').eq('id_formulario', form.id).order('orden');

  const cont = document.getElementById('contenedor-encuesta-global');
  cont.innerHTML = `
    <div style="border:1px solid #e0e0e0;border-radius:10px;padding:16px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
        <span style="font-size:0.85rem;color:#555;">${preguntas?.length || 0} preguntas · Opciones Likert auto-generadas</span>
        <button onclick="abrirModalPreguntaEncuesta(${form.id})" class="btn-primary" style="font-size:0.85rem;">+ Nueva pregunta</button>
      </div>
      <div id="lista-preguntas-encuesta">
        ${preguntas?.length
          ? preguntas.map((p, i) => `
            <div style="border-left:3px solid #f0ad4e;padding:8px 14px;margin-bottom:8px;background:#fffdf5;border-radius:0 8px 8px 0;display:flex;justify-content:space-between;align-items:center;">
              <span style="font-size:0.88rem;"><b>${i+1}.</b> ${p.pregunta}</span>
              <button onclick="eliminarPreguntaEncuesta(${p.id},${form.id})"
                style="background:#dc3545;color:white;border:none;border-radius:5px;padding:4px 9px;cursor:pointer;font-size:0.8rem;margin-left:10px;">🗑️</button>
            </div>`).join('')
          : '<p style="color:#888;font-size:0.85rem;">Sin preguntas aún.</p>'}
      </div>
    </div>`;
};

window.abrirModalPreguntaEncuesta = function (formId) {
  document.getElementById('mpe-formulario-id').value = formId;
  document.getElementById('mpe-texto').value = '';
  document.getElementById('modal-nueva-pregunta-encuesta').style.display = 'flex';
  document.getElementById('mpe-texto').focus();
};

window.cerrarModalPreguntaEncuesta = function () {
  document.getElementById('modal-nueva-pregunta-encuesta').style.display = 'none';
};

window.guardarPreguntaEncuesta = async function () {
  const formularioId = document.getElementById('mpe-formulario-id').value;
  const texto = document.getElementById('mpe-texto').value.trim();
  if (!texto) { alert('❌ Escribe el texto de la pregunta.'); return; }

  const { data: ult } = await supabase.from('preguntas').select('orden')
    .eq('id_formulario', formularioId).order('orden', { ascending: false }).limit(1);
  const orden = (ult?.[0]?.orden || 0) + 1;

  const { data: nueva, error } = await supabase
    .from('preguntas').insert([{ id_formulario: formularioId, pregunta: texto, orden, puntaje: 5 }]).select().single();
  if (error || !nueva) { alert('❌ ' + error?.message); return; }

  await supabase.from('opciones_pregunta').insert(
    OPCIONES_LIKERT.map(o => ({ id_pregunta: nueva.id, ...o, es_correcta: false }))
  );
  cerrarModalPreguntaEncuesta();
  cargarEncuestaGlobal();
};

window.eliminarPreguntaEncuesta = async function (preguntaId, formularioId) {
  if (!await showConfirm('¿Eliminar esta pregunta?', { confirmText: 'Eliminar' })) return;
  await supabase.from('opciones_pregunta').delete().eq('id_pregunta', preguntaId);
  await supabase.from('preguntas').delete().eq('id', preguntaId);
  cargarEncuestaGlobal();
};

// ═══════════════════════════════════════════════
// 🦺 PROGRAMA ANUAL SST
// ═══════════════════════════════════════════════

let filasProgramaSST = [];

window.initSelectorAnioSST = function initSelectorAnioSST() {
  const spanSede = document.getElementById('sst-sede-actual');
  if (spanSede) spanSede.textContent = sedeAdminActiva || '—';

  const anioActual = new Date().getFullYear();
  const mesCurrent = new Date().getMonth() + 1;
  ['sst-anio', 'ver-sst-anio', 'seg-anio', 'stats-anio'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    sel.innerHTML = '';
    for (let a = anioActual - 1; a <= anioActual + 2; a++) {
      const opt = document.createElement('option');
      opt.value = a;
      opt.textContent = a;
      if (a === anioActual) opt.selected = true;
      sel.appendChild(opt);
    }
  });
  const selMes = document.getElementById('seg-mes');
  if (selMes) selMes.value = mesCurrent;

  // Mostrar en automático según la pestaña activa — sin necesidad de tocar nada más.
  if (document.getElementById('tab-programa-sst-ver')?.classList.contains('activo')) {
    window.verProgramaSST?.();
  }
  if (document.getElementById('tab-programa-sst-seguimiento')?.classList.contains('activo')) {
    window.cargarSeguimientoMes?.();
  }
}

window.previsualizarProgramaSST = function () {
  const archivo = document.getElementById('archivo-sst').files[0];
  if (!archivo) return;

  const reader = new FileReader();
  reader.onload = e => {
    const XLSX = window.XLSX;
    const wb = XLSX.read(e.target.result, { type: 'array' });
    // Buscar hoja con el nombre de la sede activa, o la primera hoja
    const nombreHoja = wb.SheetNames.find(n => n.toUpperCase().includes((sedeAdminActiva || '').toUpperCase())) || wb.SheetNames[0];
    const ws = wb.Sheets[nombreHoja];
    const filas = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    // Buscar fila de encabezado (contiene "Curso" y "Ene" o "Enero")
    let idxHeader = -1;
    for (let i = 0; i < filas.length; i++) {
      const fila = filas[i].map(c => String(c).trim().toLowerCase());
      if (fila.some(c => c === 'curso') && fila.some(c => c.startsWith('ene'))) {
        idxHeader = i;
        break;
      }
    }
    if (idxHeader === -1) {
      alert('❌ No se encontró la fila de encabezados. Asegúrate de que el Excel tenga las columnas: Curso, Ene, Feb...');
      return;
    }

    const headers = filas[idxHeader].map(c => String(c).trim().toLowerCase());
    const col = name => headers.indexOf(name);

    // Mapear columnas
    const iRequisito = headers.findIndex(h => h.includes('requisito'));
    const iNum       = headers.findIndex(h => h === 'n°' || h === 'n' || h === 'nro' || h === '#');
    const iCurso     = col('curso');
    const iEncargado = headers.findIndex(h => h.includes('encargado'));
    const iPuesto    = headers.findIndex(h => h.includes('puesto'));
    const iTipo      = headers.findIndex(h => h.includes('tipo'));
    const iExpositor = headers.findIndex(h => h.includes('expositor'));
    const iFrecuencia= headers.findIndex(h => h.includes('frecuencia'));
    const iDuracion  = headers.findIndex(h => h.includes('duración') || h.includes('duracion') || h.includes('hr'));
    const meses = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
    const iMeses = meses.map(m => headers.findIndex(h => h.startsWith(m)));

    filasProgramaSST = [];
    for (let i = idxHeader + 1; i < filas.length; i++) {
      const f = filas[i];
      const curso = String(f[iCurso] || '').trim();
      if (!curso) continue;
      const mesesProg = meses.map((_m, idx) => {
        const v = String(f[iMeses[idx]] || '').trim().toUpperCase();
        return v === 'P' || v === 'R' || v === 'E';
      });
      filasProgramaSST.push({
        requisito:  iRequisito >= 0 ? String(f[iRequisito] || '').trim() : '',
        numero:     iNum >= 0 ? (parseInt(f[iNum]) || null) : null,
        curso,
        encargado:  iEncargado >= 0 ? String(f[iEncargado] || '').trim() : '',
        puesto:     iPuesto >= 0 ? String(f[iPuesto] || '').trim() : '',
        tipo_curso: iTipo >= 0 ? String(f[iTipo] || '').trim() : '',
        expositor:  iExpositor >= 0 ? String(f[iExpositor] || '').trim() : '',
        frecuencia: iFrecuencia >= 0 ? String(f[iFrecuencia] || '').trim() : '',
        duracion_hr:iDuracion >= 0 ? (parseFloat(f[iDuracion]) || null) : null,
        ene: mesesProg[0], feb: mesesProg[1], mar: mesesProg[2], abr: mesesProg[3],
        may: mesesProg[4], jun: mesesProg[5], jul: mesesProg[6], ago: mesesProg[7],
        sep: mesesProg[8], oct: mesesProg[9], nov: mesesProg[10], dic: mesesProg[11],
      });
    }

    // Preview
    const tbody = document.getElementById('tbody-sst');
    tbody.innerHTML = '';
    filasProgramaSST.forEach(f => {
      const mesesCeldas = [f.ene,f.feb,f.mar,f.abr,f.may,f.jun,f.jul,f.ago,f.sep,f.oct,f.nov,f.dic]
        .map(v => `<td style="text-align:center;padding:6px 8px;">${v ? '✔' : ''}</td>`).join('');
      tbody.insertAdjacentHTML('beforeend', `
        <tr style="border-bottom:1px solid #eee;">
          <td style="padding:6px 8px;">${f.requisito}</td>
          <td style="padding:6px 8px;">${f.numero ?? ''}</td>
          <td style="padding:6px 8px;font-weight:500;">${f.curso}</td>
          <td style="padding:6px 8px;">${f.tipo_curso}</td>
          <td style="padding:6px 8px;">${f.encargado}</td>
          <td style="padding:6px 8px;text-align:center;">${f.duracion_hr ?? ''}</td>
          ${mesesCeldas}
        </tr>`);
    });

    document.getElementById('preview-resumen-sst').textContent =
      `${filasProgramaSST.length} cursos encontrados en hoja "${nombreHoja}". Revisa antes de guardar.`;
    document.getElementById('preview-sst').style.display = 'block';
  };
  reader.readAsArrayBuffer(archivo);
};

window.importarProgramaSST = async function () {
  if (!filasProgramaSST.length) return;
  if (!empresaAdminId) { alert('❌ Sin empresa asignada.'); return; }

  const anio = parseInt(document.getElementById('sst-anio').value);
  const progreso = document.getElementById('progreso-sst');
  progreso.textContent = 'Guardando...';

  // Eliminar programa anterior del mismo año para esta empresa y sede
  await supabase.from('programa_capacitaciones')
    .delete()
    .eq('empresa_id', empresaAdminId)
    .eq('anio', anio)
    .eq('sede', sedeAdminActiva);

  const registros = filasProgramaSST.map(f => ({
    ...f,
    empresa_id: empresaAdminId,
    sede: sedeAdminActiva,
    anio,
  }));

  const { error } = await supabase.from('programa_capacitaciones').insert(registros);
  if (error) {
    progreso.textContent = '❌ Error: ' + error.message;
    return;
  }

  progreso.textContent = `✅ ${registros.length} cursos guardados correctamente.`;
  document.getElementById('preview-sst').style.display = 'none';
  document.getElementById('archivo-sst').value = '';
  filasProgramaSST = [];
};

const TIPO_COLOR_SST = { 'Seguridad': '#1e3a5f', 'Salud': '#198754', 'Medio ambiente': '#8a6d3b' };

window.verProgramaSST = async function () {
  const anio = parseInt(document.getElementById('ver-sst-anio').value);
  const tipo  = document.getElementById('ver-sst-tipo').value;
  const cont  = document.getElementById('lista-programa-sst');
  cont.innerHTML = '<p style="color:#888;">Cargando...</p>';

  let query = supabase.from('programa_capacitaciones')
    .select('*')
    .eq('empresa_id', empresaAdminId)
    .eq('anio', anio)
    .eq('sede', sedeAdminActiva)
    .order('numero');

  if (tipo) query = query.eq('tipo_curso', tipo);

  const { data, error } = await query;
  if (error || !data?.length) {
    cont.innerHTML = `<p style="color:#888;">No hay programa guardado para ${anio} en ${sedeAdminActiva}.</p>`;
    return;
  }

  const mesesNom = ['E','F','M','A','My','Jn','Jl','Ag','S','O','N','D'];
  const mesesKey = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  const colorTipo = c => TIPO_COLOR_SST[c] || '#666';

  const filas = data.map(f => `
    <tr>
      <td>${f.requisito || '—'}</td>
      <td>${f.numero ?? '—'}</td>
      <td style="font-weight:600;">${f.curso}</td>
      <td>${f.tipo_curso ? `<span style="background:${colorTipo(f.tipo_curso)};color:white;padding:2px 9px;border-radius:10px;font-size:0.72rem;white-space:nowrap;">${f.tipo_curso}</span>` : '—'}</td>
      <td>${f.encargado || '—'}</td>
      <td>${f.duracion_hr ? f.duracion_hr + 'h' : '—'}</td>
      ${mesesKey.map((m, i) => `
        <td title="${MESES_NOM[i]}" style="text-align:center; font-weight:600;
          background:${f[m] ? '#d4edda' : ''}; color:${f[m] ? '#155724' : '#ccc'};">
          ${f[m] ? '✓' : '—'}
        </td>`).join('')}
    </tr>`).join('');

  cont.innerHTML = `
    <p style="font-size:0.85rem;color:#555;margin-bottom:12px;">${data.length} cursos — Año ${anio} · ${sedeAdminActiva}</p>
    <div class="preview-table-wrap">
      <table style="min-width:900px;">
        <thead>
          <tr>
            <th>Requisito</th><th>N°</th><th>Curso</th><th>Tipo</th><th>Encargado</th><th>Duración</th>
            ${mesesNom.map(m => `<th style="text-align:center;">${m}</th>`).join('')}
          </tr>
        </thead>
        <tbody>${filas}</tbody>
      </table>
    </div>`;
};

window.eliminarProgramaSST = async function () {
  const anio = parseInt(document.getElementById('ver-sst-anio').value);
  if (!await showConfirm(`¿Eliminar todo el programa SST del año ${anio} para ${sedeAdminActiva}?\nEsta acción no se puede deshacer.`, { confirmText: 'Eliminar' })) return;
  const { error } = await supabase.from('programa_capacitaciones')
    .delete()
    .eq('empresa_id', empresaAdminId)
    .eq('anio', anio)
    .eq('sede', sedeAdminActiva);
  if (error) { alert('❌ ' + error.message); return; }
  document.getElementById('lista-programa-sst').innerHTML = '<p style="color:#888;">Programa eliminado.</p>';
};

// ─── PLANTILLA EXCEL SST ─────────────────────────────────────────────────────
window.descargarPlantillaSST = function (e) {
  e.preventDefault();
  const XLSX = window.XLSX;
  const cabecera = [
    'Requisito', 'N°', 'Curso', 'Sede', 'Encargado Gest. Capacitación',
    'Puesto', 'Tipo de Curso', 'Expositor', 'Frecuencia', 'Duración (HR)',
    'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'
  ];
  const ejemplo = [
    'ANEXO 6 DS 023-2017 EM', 1, 'Trabajos en altura', sedeAdminActiva || 'ANTAMINA', 'RRHH/SEMAS',
    'PROYECTOS - Residente, Supervisores, Técnicos', 'Seguridad', 'Externo', 'Anual', 4,
    '', '', 'P', '', '', '', 'P', '', '', '', '', ''
  ];
  const instrucciones = [
    ['INSTRUCCIONES:'],
    ['- En las columnas de meses (Ene-Dic) escribe P = Programado.'],
    ['- Tipo de Curso: Seguridad / Salud / Medio ambiente'],
    ['- No modifiques los encabezados de la fila 4.'],
    [],
  ];
  const ws = XLSX.utils.aoa_to_sheet([
    ['PROGRAMA ANUAL DE CAPACITACIONES SST'],
    ['Plantilla para carga en el sistema'],
    [],
    cabecera,
    ejemplo,
  ]);
  // Ancho de columnas
  ws['!cols'] = [18,5,35,12,20,30,14,10,10,10,...Array(12).fill(5)].map(w => ({ wch: w }));
  // Hoja instrucciones
  const wsInstr = XLSX.utils.aoa_to_sheet(instrucciones);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, (sedeAdminActiva || 'ANTAMINA').substring(0, 31));
  XLSX.utils.book_append_sheet(wb, wsInstr, 'Instrucciones');
  XLSX.writeFile(wb, 'plantilla_programa_sst.xlsx');
};

// ─── SEGUIMIENTO MENSUAL ──────────────────────────────────────────────────────
let datosSeguimiento = []; // {programa_id, curso, tipo_curso, encargado, seguimiento_id?, estado, n_programados, n_asistentes, observacion}

const MESES_KEY = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
const MESES_NOM = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

window.cargarSeguimientoMes = async function () {
  const anio = parseInt(document.getElementById('seg-anio').value);
  const mes  = parseInt(document.getElementById('seg-mes').value);
  const mesKey = MESES_KEY[mes - 1];
  const cont = document.getElementById('tabla-seguimiento');
  cont.innerHTML = '<p style="color:#888;">Cargando...</p>';

  // Cursos programados para ese mes
  const { data: programados, error } = await supabase
    .from('programa_capacitaciones')
    .select('id, curso, tipo_curso, encargado, duracion_hr')
    .eq('empresa_id', empresaAdminId)
    .eq('anio', anio)
    .eq('sede', sedeAdminActiva)
    .eq(mesKey, true)
    .order('tipo_curso');

  if (error || !programados?.length) {
    cont.innerHTML = '<p style="color:#888;">No hay cursos programados para este mes.</p>';
    document.getElementById('btn-guardar-seguimiento').style.display = 'none';
    return;
  }

  // Seguimientos ya guardados
  const { data: seguimientos } = await supabase
    .from('seguimiento_sst')
    .select('*')
    .eq('empresa_id', empresaAdminId)
    .eq('anio', anio)
    .eq('mes', mes)
    .eq('sede', sedeAdminActiva);

  const segMap = {};
  (seguimientos || []).forEach(s => { segMap[s.programa_id] = s; });

  datosSeguimiento = programados.map(p => ({
    programa_id: p.id,
    curso: p.curso,
    tipo_curso: p.tipo_curso,
    encargado: p.encargado,
    duracion_hr: p.duracion_hr,
    seguimiento_id: segMap[p.id]?.id || null,
    estado: segMap[p.id]?.estado || 'Programado',
    n_programados: segMap[p.id]?.n_programados || '',
    n_asistentes: segMap[p.id]?.n_asistentes || '',
    observacion: segMap[p.id]?.observacion || '',
  }));

  const colorEstado = { 'Ejecutado': '#198754', 'Reprogramado': '#fd7e14', 'Cancelado': '#dc3545', 'Programado': '#6c757d' };

  const filas = datosSeguimiento.map((d, i) => `
    <tr style="border-bottom:1px solid #eee;">
      <td style="padding:7px 8px;font-weight:500;font-size:0.82rem;">${d.curso}</td>
      <td style="padding:7px 8px;font-size:0.82rem;">${d.tipo_curso || ''}</td>
      <td style="padding:7px 8px;font-size:0.82rem;">${d.encargado || ''}</td>
      <td style="padding:7px 8px;">
        <select data-i="${i}" data-campo="estado" onchange="actualizarCampoSeg(this)"
          style="padding:5px 8px;border:1px solid #ddd;border-radius:5px;font-size:0.82rem;color:${colorEstado[d.estado]};">
          <option ${d.estado==='Programado'?'selected':''}>Programado</option>
          <option ${d.estado==='Ejecutado'?'selected':''}>Ejecutado</option>
          <option ${d.estado==='Reprogramado'?'selected':''}>Reprogramado</option>
          <option ${d.estado==='Cancelado'?'selected':''}>Cancelado</option>
        </select>
      </td>
      <td style="padding:7px 8px;">
        <input type="number" data-i="${i}" data-campo="n_programados" onchange="actualizarCampoSeg(this)"
          value="${d.n_programados}" min="0" placeholder="Prog."
          style="width:60px;padding:5px;border:1px solid #ddd;border-radius:5px;font-size:0.82rem;" />
      </td>
      <td style="padding:7px 8px;">
        <input type="number" data-i="${i}" data-campo="n_asistentes" onchange="actualizarCampoSeg(this)"
          value="${d.n_asistentes}" min="0" placeholder="Asist."
          style="width:60px;padding:5px;border:1px solid #ddd;border-radius:5px;font-size:0.82rem;" />
      </td>
      <td style="padding:7px 8px;">
        <input type="text" data-i="${i}" data-campo="observacion" onchange="actualizarCampoSeg(this)"
          value="${d.observacion}" placeholder="Observación"
          style="width:130px;padding:5px;border:1px solid #ddd;border-radius:5px;font-size:0.82rem;" />
      </td>
    </tr>`).join('');

  cont.innerHTML = `
    <div style="overflow-x:auto;">
      <table style="border-collapse:collapse;width:100%;font-size:0.82rem;min-width:750px;">
        <thead><tr style="background:#1e3a5f;color:white;">
          <th style="padding:8px 10px;text-align:left;">Curso</th>
          <th style="padding:8px 10px;">Tipo</th>
          <th style="padding:8px 10px;">Encargado</th>
          <th style="padding:8px 10px;">Estado</th>
          <th style="padding:8px 10px;">Prog.</th>
          <th style="padding:8px 10px;">Asist.</th>
          <th style="padding:8px 10px;">Observación</th>
        </tr></thead>
        <tbody>${filas}</tbody>
      </table>
    </div>`;
  document.getElementById('btn-guardar-seguimiento').style.display = 'block';
  document.getElementById('progreso-seguimiento').textContent = '';
};

window.actualizarCampoSeg = function (el) {
  const i = parseInt(el.dataset.i);
  const campo = el.dataset.campo;
  datosSeguimiento[i][campo] = el.value;
};

window.guardarSeguimiento = async function () {
  const anio = parseInt(document.getElementById('seg-anio').value);
  const mes  = parseInt(document.getElementById('seg-mes').value);
  const prog = document.getElementById('progreso-seguimiento');
  prog.textContent = 'Guardando...';

  const registros = datosSeguimiento.map(d => ({
    empresa_id: empresaAdminId,
    programa_id: d.programa_id,
    anio, mes, sede: sedeAdminActiva,
    estado: d.estado,
    n_programados: d.n_programados !== '' ? parseInt(d.n_programados) : null,
    n_asistentes:  d.n_asistentes  !== '' ? parseInt(d.n_asistentes)  : null,
    observacion: d.observacion || null,
  }));

  const { error } = await supabase.from('seguimiento_sst')
    .upsert(registros, { onConflict: 'empresa_id,programa_id,anio,mes' });

  prog.textContent = error ? '❌ ' + error.message : `✅ ${registros.length} cursos guardados.`;
};

// ─── ESTADÍSTICAS SST ─────────────────────────────────────────────────────────
let chartMensual = null, chartTipo = null, chartEncargado = null;

window.cargarEstadisticasSST = async function () {
  const anio = parseInt(document.getElementById('stats-anio').value);

  const [{ data: programa }, { data: seguimientos }] = await Promise.all([
    supabase.from('programa_capacitaciones').select('id,tipo_curso,encargado,ene,feb,mar,abr,may,jun,jul,ago,sep,oct,nov,dic')
      .eq('empresa_id', empresaAdminId).eq('anio', anio).eq('sede', sedeAdminActiva),
    supabase.from('seguimiento_sst').select('*')
      .eq('empresa_id', empresaAdminId).eq('anio', anio),
  ]);

  if (!programa?.length) {
    document.getElementById('sst-kpis').innerHTML = '<p style="color:#888;">No hay programa cargado para este año.</p>';
    return;
  }

  const segMap = {};
  (seguimientos || []).forEach(s => {
    if (!segMap[s.programa_id]) segMap[s.programa_id] = {};
    segMap[s.programa_id][s.mes] = s;
  });

  // Calcular cumplimiento por mes
  const mesData = MESES_KEY.map((key, idx) => {
    const programadosMes = programa.filter(p => p[key]);
    const ejecutadosMes  = programadosMes.filter(p => segMap[p.id]?.[idx+1]?.estado === 'Ejecutado');
    return { programados: programadosMes.length, ejecutados: ejecutadosMes.length };
  });

  const totalProg = mesData.reduce((s, m) => s + m.programados, 0);
  const totalEjec = mesData.reduce((s, m) => s + m.ejecutados, 0);
  const pctAnual  = totalProg > 0 ? Math.round(totalEjec / totalProg * 100) : 0;

  // Mes actual
  const mesActual = new Date().getMonth(); // 0-based
  const pctMesActual = mesData[mesActual].programados > 0
    ? Math.round(mesData[mesActual].ejecutados / mesData[mesActual].programados * 100) : 0;

  // KPIs
  const kpiColor = pct => pct >= 80 ? '#198754' : pct >= 50 ? '#fd7e14' : '#dc3545';
  document.getElementById('sst-kpis').innerHTML = [
    ['Cumplimiento Anual', `${pctAnual}%`, kpiColor(pctAnual)],
    [`Cumplimiento ${MESES_NOM[mesActual]}`, `${pctMesActual}%`, kpiColor(pctMesActual)],
    ['Cursos programados (año)', totalProg, '#1e3a5f'],
    ['Cursos ejecutados (año)', totalEjec, '#1e3a5f'],
    ['Pendientes', totalProg - totalEjec, '#6c757d'],
  ].map(([label, val, color]) => `
    <div style="background:#f8f9fa;border-radius:10px;padding:14px 20px;min-width:140px;text-align:center;border-top:4px solid ${color};">
      <div style="font-size:1.6rem;font-weight:700;color:${color};">${val}</div>
      <div style="font-size:0.78rem;color:#555;margin-top:4px;">${label}</div>
    </div>`).join('');

  // Gráfico mensual
  const ctxM = document.getElementById('chart-sst-mensual').getContext('2d');
  if (chartMensual) chartMensual.destroy();
  chartMensual = new Chart(ctxM, {
    type: 'bar',
    data: {
      labels: MESES_NOM.map(m => m.substring(0,3)),
      datasets: [
        { label: 'Programados', data: mesData.map(m => m.programados), backgroundColor: '#1e3a5faa' },
        { label: 'Ejecutados',  data: mesData.map(m => m.ejecutados),  backgroundColor: '#198754aa' },
      ]
    },
    options: { responsive: true, plugins: { legend: { position: 'top' } }, scales: { y: { beginAtZero: true } } }
  });

  // Agrupación por tipo
  const tipos = ['Seguridad', 'Salud', 'Medio ambiente'];
  const tipoData = tipos.map(t => {
    const cursosTipo = programa.filter(p => p.tipo_curso === t);
    const progTipo = cursosTipo.reduce((s, p) => s + MESES_KEY.filter(k => p[k]).length, 0);
    const ejecTipo = cursosTipo.reduce((s, p) => {
      return s + MESES_KEY.filter((k, idx) => p[k] && segMap[p.id]?.[idx+1]?.estado === 'Ejecutado').length;
    }, 0);
    return { prog: progTipo, ejec: ejecTipo };
  });

  const ctxT = document.getElementById('chart-sst-tipo').getContext('2d');
  if (chartTipo) chartTipo.destroy();
  chartTipo = new Chart(ctxT, {
    type: 'doughnut',
    data: {
      labels: tipos,
      datasets: [{ data: tipoData.map(t => t.prog), backgroundColor: ['#1e3a5f','#198754','#0d6efd'] }]
    },
    options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
  });

  // Agrupación por encargado
  const encargados = [...new Set(programa.map(p => p.encargado).filter(Boolean))];
  const encData = encargados.map(enc => {
    const cursosEnc = programa.filter(p => p.encargado === enc);
    return cursosEnc.reduce((s, p) => s + MESES_KEY.filter(k => p[k]).length, 0);
  });

  const ctxE = document.getElementById('chart-sst-encargado').getContext('2d');
  if (chartEncargado) chartEncargado.destroy();
  chartEncargado = new Chart(ctxE, {
    type: 'doughnut',
    data: {
      labels: encargados,
      datasets: [{ data: encData, backgroundColor: ['#1e3a5f','#198754','#0d6efd','#fd7e14','#6f42c1'] }]
    },
    options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
  });

  // Cursos pendientes mes actual
  const pendientes = programa.filter(p => {
    const key = MESES_KEY[mesActual];
    return p[key] && segMap[p.id]?.[mesActual+1]?.estado !== 'Ejecutado';
  });
  document.getElementById('sst-pendientes').innerHTML = pendientes.length === 0
    ? `<p style="color:#198754;font-weight:600;">✅ Todos los cursos de ${MESES_NOM[mesActual]} están ejecutados.</p>`
    : `<h3 style="font-size:0.95rem;color:#dc3545;margin-bottom:8px;">⚠️ Pendientes en ${MESES_NOM[mesActual]} (${pendientes.length})</h3>
       <ul style="margin:0;padding-left:18px;font-size:0.85rem;color:#555;">
         ${pendientes.map(p => `<li>${p.tipo_curso ? `<strong>[${p.tipo_curso}]</strong> ` : ''}${programa.find(x=>x.id===p.id)?.curso || ''}</li>`).join('')}
       </ul>`;
};

// ═══════════════════════════════════════════════
// ✅ CURSOS OBLIGATORIOS POR CARGO
// ═══════════════════════════════════════════════

window.initCursosObligatorios = async function () {
  document.getElementById('obl-sede-actual').textContent = sedeAdminActiva || '—';

  const [{ data: cargos }, { data: cursos }, { data: rutas }] = await Promise.all([
    supabase.from('cargos').select('id, nombre').eq('activo', true).order('nombre'),
    supabase.from('cursos').select('id, titulo').eq('activo', true).eq('sede', sedeAdminActiva).order('titulo'),
    supabase.from('rutas_aprendizaje').select('id, cargo_id, ruta_cursos(curso_id)')
      .eq('empresa_id', empresaAdminId).eq('sede', sedeAdminActiva),
  ]);

  window._cargosObl = cargos || [];
  window._cursosObl = cursos || [];
  window._rutaPorCargo = {};
  window._cursosPorCargo = {};
  (rutas || []).forEach(r => {
    window._rutaPorCargo[r.cargo_id] = r.id;
    window._cursosPorCargo[r.cargo_id] = new Set((r.ruta_cursos || []).map(rc => rc.curso_id));
  });

  renderMatrizObligatorios();
};

function renderMatrizObligatorios() {
  const cargos = window._cargosObl, cursos = window._cursosObl;
  const cont = document.getElementById('matriz-obligatorios');

  if (!cargos.length || !cursos.length) {
    cont.innerHTML = '<p style="color:#888;">Necesitas al menos un cargo y un curso activo en esta sede para configurar esto.</p>';
    return;
  }

  const header = cursos.map(c => `<th title="${c.titulo}">${c.titulo}</th>`).join('');
  const filas = cargos.map(cg => {
    // Si el cargo no tiene ruta configurada, ve TODOS los cursos por defecto
    // (ver cargarCursos en main.js): se muestran todas las casillas marcadas
    // para reflejar ese comportamiento real.
    const marcados = window._rutaPorCargo[cg.id]
      ? window._cursosPorCargo[cg.id]
      : new Set(cursos.map(c => c.id));
    const celdas = cursos.map(c => `
      <td>
        <input type="checkbox" ${marcados.has(c.id) ? 'checked' : ''}
          onchange="toggleCargoCurso('${cg.id}','${c.id}', this.checked)" />
      </td>`).join('');
    return `<tr><td title="${cg.nombre}">${cg.nombre}</td>${celdas}</tr>`;
  }).join('');

  cont.innerHTML = `
    <div class="tabla-matriz-wrap">
      <table class="tabla-matriz">
        <thead><tr><th>Cargo</th>${header}</tr></thead>
        <tbody>${filas}</tbody>
      </table>
    </div>`;
}

window.toggleCargoCurso = async function (cargoId, cursoId, marcado) {
  let rutaId = window._rutaPorCargo[cargoId];

  if (!rutaId) {
    // El cargo no tenía ruta: veía TODOS los cursos por defecto. Al tocar una
    // casilla se crea la ruta explícita, preservando ese mismo conjunto
    // (todos los cursos) salvo el que se acaba de desmarcar.
    const cargo = window._cargosObl.find(c => c.id === cargoId);
    const { data, error } = await supabase.from('rutas_aprendizaje').insert({
      empresa_id: empresaAdminId,
      sede: sedeAdminActiva,
      cargo_id: cargoId,
      nombre: `Obligatorios · ${cargo?.nombre || ''}`,
    }).select().single();
    if (error) { alert('❌ ' + error.message); return; }
    rutaId = data.id;
    window._rutaPorCargo[cargoId] = rutaId;

    const idsIniciales = new Set(window._cursosObl.map(c => c.id));
    if (!marcado) idsIniciales.delete(cursoId);
    window._cursosPorCargo[cargoId] = idsIniciales;

    if (idsIniciales.size) {
      const { error: errIns } = await supabase.from('ruta_cursos').insert(
        [...idsIniciales].map(id => ({ ruta_id: rutaId, curso_id: id, obligatorio: true }))
      );
      if (errIns) { alert('❌ ' + errIns.message); return; }
    }
    return;
  }

  if (marcado) {
    const { error } = await supabase.from('ruta_cursos').insert({ ruta_id: rutaId, curso_id: cursoId, obligatorio: true });
    if (error) { alert('❌ ' + error.message); return; }
    window._cursosPorCargo[cargoId].add(cursoId);
  } else {
    await supabase.from('ruta_cursos').delete().eq('ruta_id', rutaId).eq('curso_id', cursoId);
    window._cursosPorCargo[cargoId].delete(cursoId);
  }
};

let _debounceExcepcion = null;
window.buscarExcepcionDebounced = function () {
  clearTimeout(_debounceExcepcion);
  _debounceExcepcion = setTimeout(() => buscarTrabajadorExcepcion(), 350);
};

window.buscarTrabajadorExcepcion = async function () {
  const q = document.getElementById('buscar-excepcion-input').value.trim();
  const cont0 = document.getElementById('resultado-excepcion');
  if (!q) { cont0.innerHTML = ''; document.getElementById('panel-excepciones').style.display = 'none'; return; }

  let query = supabase.from('profiles')
    .select('id, nombres, apellidos, documento_numero, cargo_id')
    .eq('empresa_id', empresaAdminId).eq('rol', 'trabajador').order('apellidos').limit(10);
  query = /^\d/.test(q) ? query.ilike('documento_numero', `%${q}%`) : query.ilike('apellidos', `%${q}%`);

  const { data } = await query;
  const cont = document.getElementById('resultado-excepcion');
  document.getElementById('panel-excepciones').style.display = 'none';

  if (!data?.length) { cont.innerHTML = '<p style="color:#888;">No se encontraron trabajadores.</p>'; return; }

  window._trabExcepcion = data;
  cont.innerHTML = data.map((t, idx) => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:white;border:1px solid #ddd;border-radius:7px;margin-bottom:6px;">
      <span>${t.apellidos}, ${t.nombres} · DNI ${t.documento_numero}</span>
      <button onclick="abrirExcepcionesTrabajador(${idx})" style="padding:6px 12px;background:#1e3a5f;color:white;border:none;border-radius:6px;cursor:pointer;font-size:0.82rem;">Ver cursos</button>
    </div>`).join('');
};

window.abrirExcepcionesTrabajador = async function (idx) {
  const t = window._trabExcepcion[idx];
  const { data: individuales } = await supabase
    .from('curso_asignacion_individual').select('curso_id').eq('profile_id', t.id);

  const marcadosCargo = window._cursosPorCargo?.[t.cargo_id] || new Set();
  const marcadosIndividual = new Set((individuales || []).map(i => i.curso_id));

  const cont = document.getElementById('panel-excepciones');
  cont.style.display = 'block';
  cont.innerHTML = `
    <h3 style="font-size:0.95rem;font-weight:600;color:#1e3a5f;margin-bottom:10px;">
      Cursos extra para ${t.apellidos}, ${t.nombres}
    </h3>
    <p style="color:#888;font-size:0.8rem;margin-bottom:10px;">
      Los ya marcados por su cargo no se pueden quitar aquí — eso se cambia en la matriz de arriba.
    </p>
    <div style="display:flex;flex-direction:column;gap:6px;">
      ${(window._cursosObl || []).map(c => {
        const porCargo = marcadosCargo.has(c.id);
        const porIndividual = marcadosIndividual.has(c.id);
        return `<label style="display:flex;align-items:center;gap:8px;font-size:0.88rem;${porCargo ? 'color:#aaa;' : ''}">
          <input type="checkbox" ${porCargo || porIndividual ? 'checked' : ''} ${porCargo ? 'disabled' : ''}
            onchange="toggleExcepcionIndividual('${t.id}','${c.id}', this.checked)" />
          ${c.titulo}${porCargo ? ' (ya la tiene por su cargo)' : ''}
        </label>`;
      }).join('')}
    </div>`;
};

window.toggleExcepcionIndividual = async function (profileId, cursoId, marcado) {
  if (marcado) {
    const { error } = await supabase.from('curso_asignacion_individual').insert({ profile_id: profileId, curso_id: cursoId });
    if (error) { alert('❌ ' + error.message); return; }
  } else {
    await supabase.from('curso_asignacion_individual').delete().eq('profile_id', profileId).eq('curso_id', cursoId);
  }
};




// ═══════════════════════════════════════════════
// ⏳ SPINNERS EN BOTONES — aplicar withLoading
// ═══════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  const wrap = (selector, fn, texto) => {
    const btn = document.querySelector(selector);
    if (btn && window[fn]) window[fn] = withLoading(btn, window[fn], texto);
  };
  wrap('button[onclick="crearUsuario()"]',        'crearUsuario',        'Creando...');
  wrap('button[onclick="subirCurso()"]',           'subirCurso',          'Subiendo...');
  wrap('button[onclick="guardarSeguimiento()"]',   'guardarSeguimiento',  'Guardando...');
  wrap('button[onclick="importarProgramaSST()"]',  'importarProgramaSST', 'Importando...');

  // Validación en tiempo real — formulario crear usuario
  fieldValidation([
    {
      id: 'nuevo-dni',
      validate: v => !v ? 'El documento es obligatorio.'
                  : v.length < 8 ? 'Mínimo 8 caracteres.' : null,
    },
    {
      id: 'nuevo-email',
      validate: v => v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
                  ? 'Correo no válido.' : null,
    },
    {
      id: 'gestor-email',
      validate: v => !v ? 'El correo es obligatorio para gestores.'
                  : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? 'Correo no válido.' : null,
    },
  ]);

  // Validación en tiempo real — formulario subir curso
  fieldValidation([
    { id: 'titulo-curso',    validate: v => !v.trim() ? 'El título es obligatorio.' : null },
    { id: 'codigo-prefijo',  validate: v => !v.trim() ? 'El prefijo es obligatorio.'
                                          : v.trim().length > 6 ? 'Máximo 6 caracteres.' : null },
    { id: 'duracion-curso',  validate: v => !v ? 'La duración es obligatoria.'
                                          : +v <= 0 ? 'Debe ser mayor a 0.' : null },
  ]);
});
