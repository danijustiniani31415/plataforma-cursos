import { supabase } from './src/supabaseClient.js';
import { alertToToast, withLoading, showConfirm, fieldValidation } from './toast.js';
import { buildHtmlCertificado, generarCertificadoPDFBlob } from './certificado.js';
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

// Select buscable con Tom Select
function initSelectBuscable(id) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el.tomselect) { el.tomselect.sync(); return; }
  new window.TomSelect(el, { allowEmptyOption: true, maxOptions: 300 });
}

let empresaAdminId = null;
let empresaAdminNombre = null;
let empresaAdminRuc = null;
let sedeAdminActiva = null;
let sedesAdminDisponibles = [];
let currentUserId = null;

function pintarCheckboxesSedes() {
  const cont = document.getElementById('nuevo-sedes-checks');
  if (!cont) return;
  const lista = sedesAdminDisponibles.length ? sedesAdminDisponibles : ['ANTAMINA'];
  cont.innerHTML = lista.map(s => `
    <label style="margin-right:16px; font-size:0.9rem;">
      <input type="checkbox" class="chk-nuevo-sede" value="${s}" ${s === sedeAdminActiva ? 'checked' : ''} />
      ${s}
    </label>`).join('');
}

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
      sel.style.display = 'block';
      sel.style.width = '100%';
      sel.style.marginTop = '6px';
      sel.style.padding = '6px 8px';
      sel.style.borderRadius = '6px';
      sel.style.border = '1px solid rgba(255,255,255,0.25)';
      sel.style.background = 'rgba(255,255,255,0.08)';
      sel.style.color = '#fff';
      sel.style.fontSize = '0.76rem';
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

  if (perfil?.empresa_id) {
    empresaAdminId = perfil.empresa_id;
    empresaAdminNombre = perfil.empresas?.nombre;
    empresaAdminRuc = perfil.empresas?.ruc;

    document.getElementById('info-empresa-header').textContent = `🏢 ${empresaAdminNombre}`;
    await resolverSedeAdmin(user.id);
    document.getElementById('info-empresa').innerHTML = `
      <div class="info-box" style="margin-bottom:16px;">
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

  // Cargar cargos
  const { data: cargos } = await supabase
    .from('cargos')
    .select('*')
    .eq('activo', true)
    .order('nombre');

  const selCargo = document.getElementById('nuevo-cargo');
  selCargo.innerHTML = '<option value="">-- Selecciona cargo --</option>';
  cargos?.forEach(c => {
    selCargo.innerHTML += `<option value="${c.id}">${c.nombre}</option>`;
  });

  configurarRENIEC('nuevo-dni', 'nuevo-doc-tipo', 'nuevo-nombres', 'nuevo-apellidos');
  configurarRENIEC('gestor-dni', 'gestor-doc-tipo', 'gestor-nombres', 'gestor-apellidos');

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
// 👥 Crear nuevo usuario
// ═══════════════════════════════
window.crearUsuario = async function () {
  const email         = document.getElementById("nuevo-email").value.trim();
  const dni           = document.getElementById("nuevo-dni").value.trim();
  const nombres       = document.getElementById("nuevo-nombres").value.trim();
  const apellidos     = document.getElementById("nuevo-apellidos").value.trim();
  const doc_tipo      = document.getElementById("nuevo-doc-tipo").value;
  const telefono      = document.getElementById("nuevo-telefono").value.trim();
  const cargo_id      = document.getElementById("nuevo-cargo").value;
  const fecha_ingreso = document.getElementById("nuevo-fecha-ingreso").value;

  if (!dni || !nombres || !apellidos) {
    alert("❌ Completa los campos obligatorios: nombres, apellidos y documento.");
    return;
  }

  const emailFinal = email || null;

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    alert("❌ Ingresa un correo electrónico válido.");
    return;
  }

  if (!empresaAdminId) {
    alert("❌ Tu usuario no tiene empresa asignada. Contacta al superadmin.");
    return;
  }

  const sedesElegidas = Array.from(document.querySelectorAll('.chk-nuevo-sede:checked')).map(c => c.value);
  if (sedesElegidas.length === 0) {
    alert("❌ Selecciona al menos una sede.");
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
      cargo_id:         cargo_id || null,
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
  document.getElementById('nuevo-cargo').value = '';
};

window.crearGestor = async function () {
  const email         = document.getElementById("gestor-email").value.trim();
  const dni           = document.getElementById("gestor-dni").value.trim();
  const nombres       = document.getElementById("gestor-nombres").value.trim();
  const apellidos     = document.getElementById("gestor-apellidos").value.trim();
  const doc_tipo      = document.getElementById("gestor-doc-tipo").value;

  if (!dni || !nombres || !apellidos) {
    alert("❌ Completa los campos obligatorios: nombres, apellidos y documento.");
    return;
  }

  const emailFinal = email || null;

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    alert("❌ Ingresa un correo electrónico válido.");
    return;
  }

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

  const { error } = await supabase.from("cursos").insert([{
    titulo,
    codigo_prefijo: prefijo,
    codigo,
    duracion,
    vigencia_meses,
    activo:       true,
    sede:         sedeAdminActiva
  }]);

  if (error) {
    alert("❌ Error al subir curso: " + error.message);
  } else {
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
window.resetearContrasena = async function (emailDirecto) {
  const emailIngresado = (emailDirecto || document.getElementById("email-reset")?.value || "").trim();

  if (!emailIngresado) {
    alert("Ingresa el correo.");
    return;
  }

  // Buscar el perfil por email personal para obtener el email de Auth (DNI@cvglobal.pe)
  const { data: perfil } = await supabase
    .from('profiles')
    .select('documento_numero')
    .eq('email', emailIngresado)
    .maybeSingle();

  const authEmail = perfil?.documento_numero
    ? `${perfil.documento_numero}@cvglobal.pe`
    : emailIngresado;

  const { error } = await supabase.auth.resetPasswordForEmail(authEmail, {
    redirectTo: "https://cursossstcvglobal.netlify.app/cambiar-clave.html"
  });

  if (error) {
    alert("❌ Error: " + error.message);
  } else {
    alert("✅ Enlace enviado. Revisa el correo.");
  }
};

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
    // Paso 1: IDs de formularios tipo 'examen' (filtrado opcional por curso)
    const examFormIds = [];
    {
      let pg = 0;
      while (true) {
        let qf = supabase.from('formularios').select('id').eq('tipo', 'examen')
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
    if (examFormIds.length) {
      let pg = 0;
      while (true) {
        const { data: envios, error: ee } = await supabase
          .from('envios_formulario')
          .select('usuario_id, usuario_email, id_curso, created_at')
          .in('id_formulario', examFormIds)
          .eq('aprobado', true)
          .eq('sede', sedeAdminActiva)
          .gte('created_at', desde)
          .lt('created_at', hasta)
          .range(pg * 1000, (pg + 1) * 1000 - 1);
        if (ee) throw ee;
        if (!envios?.length) break;
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

    _rn_datos = allCerts
      .map(r => {
        const kId    = `${r.usuario_id}|${r.curso_id}`;
        const kEmail = `${r.usuario_email}|${r.curso_id}`;
        const fecha_examen = enviosMapById[kId] || enviosMapByEmail[kEmail] || null;
        return { ...r, fecha_examen, curso_nombre: mapCursos[r.curso_id] || '—' };
      })
      .filter(r => r.fecha_examen !== null)
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

  let query = supabase
    .from('profiles')
    .select('id, nombres, apellidos, email, documento_numero, telefono, cargo_id, cargo, fecha_ingreso, activo', { count: 'exact' })
    .eq('empresa_id', empresaAdminId)
    .eq('rol', 'trabajador')
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
        <button onclick="resetearPasswordADni(${idx})"
                style="padding:5px 12px;background:#e65100;color:white;border:none;border-radius:5px;cursor:pointer;font-size:0.8rem;">
          🔑 DNI
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
// 🔄 Actualización masiva desde Excel
// ═══════════════════════════════
let filasActualizacion = [];

window.descargarPlantillaActualizacion = async function (e) {
  e.preventDefault();
  const XLSX = window.XLSX;

  const { data: cargos } = await supabase.from('cargos').select('nombre').eq('activo', true).order('nombre');
  const listaCargos = cargos?.map(c => c.nombre) || [];

  const ws = XLSX.utils.aoa_to_sheet([
    ['DNI', 'Apellidos', 'Nombres', 'Email', 'Telefono', 'Cargo', 'Fecha Ingreso'],
  ]);

  // Forzar columna DNI como texto en 200 filas para que Excel preserve ceros iniciales
  for (let row = 2; row <= 201; row++) {
    ws[`A${row}`] = { t: 's', v: '' };
  }
  ws['!ref'] = 'A1:G201';

  const wsCargos = XLSX.utils.aoa_to_sheet(listaCargos.map(c => [c]));

  ws['!cols'] = [12, 22, 22, 28, 14, 22, 14].map(w => ({ wch: w }));

  ws['!dataValidations'] = ws['!dataValidations'] || [];
  if (listaCargos.length > 0) {
    ws['!dataValidations'].push({
      type: 'list',
      sqref: 'F2:F200',
      formula1: listaCargos.map(c => `"${c}"`).join(',').length <= 255
        ? '"' + listaCargos.join(',') + '"'
        : 'Cargos!$A$1:$A$' + listaCargos.length
    });
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Actualizar');
  XLSX.utils.book_append_sheet(wb, wsCargos, 'Cargos');
  XLSX.writeFile(wb, 'plantilla_actualizacion.xlsx');
};

window.previsualizarActualizacion = function () {
  const archivo = document.getElementById('archivo-actualizacion').files[0];
  if (!archivo) { alert('Selecciona un archivo Excel.'); return; }

  const reader = new FileReader();
  reader.onload = function (e) {
    const XLSX = window.XLSX;
    const workbook = XLSX.read(e.target.result, { type: 'array', cellDates: true });
    const hoja = workbook.Sheets[workbook.SheetNames[0]];
    const filas = XLSX.utils.sheet_to_json(hoja, { header: 1, defval: '' });

    // Auto-eliminar duplicados (se queda con la primera aparición de cada DNI)
    const vistosAct = new Set();
    const todasFilas = filas.slice(1).filter(f => f[0]);
    filasActualizacion = todasFilas.filter(f => {
      const dni = normalizarDNI(f[0]);
      if (vistosAct.has(dni)) return false;
      vistosAct.add(dni);
      return true;
    });
    const elimAct = todasFilas.length - filasActualizacion.length;
    const dupsAct = [];

    const tbody = document.getElementById('tbody-actualizacion');
    tbody.innerHTML = '';
    filasActualizacion.forEach(f => {
      const fechaRaw = f[6];
      let fecha = '';
      if (fechaRaw instanceof Date) {
        const y = fechaRaw.getFullYear();
        const m = String(fechaRaw.getMonth() + 1).padStart(2, '0');
        const d = String(fechaRaw.getDate()).padStart(2, '0');
        fecha = `${y}-${m}-${d}`;
      } else if (fechaRaw) {
        fecha = String(fechaRaw).trim();
      }
      const dni = normalizarDNI(f[0]);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="padding:5px;">${f[0]}</td>
        <td style="padding:5px;">${f[1]}</td>
        <td style="padding:5px;">${f[2]}</td>
        <td style="padding:5px;">${String(f[3]).trim().toLowerCase()}</td>
        <td style="padding:5px;">${f[4]}</td>
        <td style="padding:5px;">${f[5]}</td>
        <td style="padding:5px;">${fecha}</td>
        <td style="padding:5px; color:#888;">Pendiente</td>
      `;
      tbody.appendChild(tr);
    });

    let resumen = `${filasActualizacion.length} trabajadores a actualizar.`;
    if (elimAct > 0) resumen += ` ℹ️ ${elimAct} fila(s) duplicada(s) eliminadas automáticamente.`;
    document.getElementById('preview-resumen-act').textContent = resumen;
    document.getElementById('preview-actualizacion').style.display = 'block';
  };
  reader.readAsArrayBuffer(archivo);
};

window.ejecutarActualizacion = async function () {
  if (!filasActualizacion.length) return;

  const btnActualizar = document.querySelector('#preview-actualizacion .btn-primary');
  btnActualizar.disabled = true;
  btnActualizar.textContent = '⏳ Actualizando...';

  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndyYWhqbHN0YXV0d2lueHlxY2Z4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxMTMyNjYsImV4cCI6MjA4ODY4OTI2Nn0.iAbYatXkr5BAplYDhs7vMca2ROjb11uFM0e4619sD4s';

  const { data: cargos } = await supabase.from('cargos').select('id, nombre').eq('activo', true);

  // Cargar todos los perfiles de la empresa de una sola vez para detectar no encontrados
  const { data: perfilesEmpresa } = await supabase
    .from('profiles')
    .select('id, documento_numero')
    .eq('empresa_id', empresaAdminId);
  const perfilPorDni = {};
  // Normalizar DNI del lado de la base de datos también para evitar mismatch de formato
  perfilesEmpresa?.forEach(p => { perfilPorDni[normalizarDNI(p.documento_numero)] = p.id; });

  const filas = document.querySelectorAll('#tbody-actualizacion tr');
  const progreso = document.getElementById('progreso-actualizacion');
  let ok = 0, errores = 0, noEncontrados = 0;
  const filasError = [['DNI', 'Apellidos', 'Nombres', 'Email', 'Cargo', 'Error']];

  for (let i = 0; i < filasActualizacion.length; i++) {
    const f           = filasActualizacion[i];
    const dni         = normalizarDNI(f[0]);
    const apellidos   = String(f[1]).trim();
    const nombres     = String(f[2]).trim();
    const emailRaw    = String(f[3]).trim().toLowerCase();
    const telefono    = String(f[4]).trim();
    const cargoNombre = String(f[5]).trim();
    const fechaRaw    = f[6];

    let fechaIngreso = '';
    if (fechaRaw instanceof Date) {
      const y = fechaRaw.getFullYear();
      const m = String(fechaRaw.getMonth() + 1).padStart(2, '0');
      const d = String(fechaRaw.getDate()).padStart(2, '0');
      fechaIngreso = `${y}-${m}-${d}`;
    } else if (fechaRaw) {
      fechaIngreso = String(fechaRaw).trim();
    }

    const tdEstado = filas[i].querySelectorAll('td')[7];
    tdEstado.textContent = '⏳ Actualizando...';
    tdEstado.style.color = '#888';

    const usuarioId = perfilPorDni[dni];
    if (!usuarioId) {
      tdEstado.textContent = '⚠️ DNI no encontrado';
      tdEstado.style.color = 'orange';
      filasError.push([dni, apellidos, nombres, emailRaw, cargoNombre, 'DNI no encontrado en esta empresa']);
      noEncontrados++;
      progreso.textContent = `Progreso: ${i + 1}/${filasActualizacion.length} — ✅ ${ok}, ❌ ${errores}, ⚠️ ${noEncontrados} no encontrados`;
      continue;
    }

    const email = emailRaw.includes('@') ? emailRaw : null;
    const cargo = cargos?.find(c => c.nombre.toLowerCase() === cargoNombre.toLowerCase());

    const updates = {};
    if (apellidos) updates.apellidos = apellidos;
    if (nombres)   updates.nombres   = nombres;
    if (email)     updates.email     = email;
    if (telefono)  updates.telefono  = telefono;
    if (cargo)   { updates.cargo_id  = cargo.id; updates.cargo = cargo.nombre; }
    if (fechaIngreso) updates.fecha_ingreso = fechaIngreso;

    if (Object.keys(updates).length === 0) {
      tdEstado.textContent = '⚠️ Sin cambios';
      tdEstado.style.color = '#888';
      ok++;
      progreso.textContent = `Progreso: ${i + 1}/${filasActualizacion.length} — ✅ ${ok}, ❌ ${errores}, ⚠️ ${noEncontrados} no encontrados`;
      continue;
    }

    // Usar edge function para actualizar profiles (auth.users.email nunca cambia)
    const { data: sessionDataAct } = await supabase.auth.getSession();
    const res = await fetch('https://wrahjlstautwinxyqcfx.supabase.co/functions/v1/actualizar-usuario', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${sessionDataAct.session?.access_token}`,
        'apikey': ANON_KEY,
      },
      body: JSON.stringify({ usuario_id: usuarioId, updates }),
    });

    let data = {};
    try { data = await res.json(); } catch (_) {}
    if (!res.ok || data?.error) {
      const msgError = data?.error || data?.message || `HTTP ${res.status}`;
      tdEstado.textContent = '❌ ' + msgError;
      tdEstado.style.color = 'red';
      filasError.push([dni, apellidos, nombres, emailRaw, cargoNombre, msgError]);
      errores++;
    } else {
      tdEstado.textContent = '✅ Actualizado';
      tdEstado.style.color = 'green';
      ok++;
    }

    progreso.textContent = `Progreso: ${i + 1}/${filasActualizacion.length} — ✅ ${ok}, ❌ ${errores}, ⚠️ ${noEncontrados} no encontrados`;
  }

  progreso.textContent += ' — ¡Completado!';
  btnActualizar.disabled = false;
  btnActualizar.textContent = '✅ Confirmar actualización';

  if (errores > 0 || noEncontrados > 0) {
    const XLSX = window.XLSX;
    const ws = XLSX.utils.aoa_to_sheet(filasError);
    ws['!cols'] = [12, 22, 22, 30, 22, 40].map(w => ({ wch: w }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Errores');
    XLSX.writeFile(wb, 'errores_actualizacion.xlsx');
    alert(`⚠️ Proceso completado con observaciones:\n✅ ${ok} actualizados\n❌ ${errores} con error\n⚠️ ${noEncontrados} DNI no encontrado\n\nSe descargó "errores_actualizacion.xlsx".`);
  }
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

  let query = supabase
    .from('profiles')
    .select('id, nombres, apellidos, email, documento_numero, rol, activo')
    .eq('empresa_id', empresaAdminId)
    .in('rol', filtroRol ? [filtroRol] : ['admin', 'gestor'])
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
      <div class="trab-actions">
        <button onclick="cambiarEmailStaff(${idx})"
                style="padding:5px 12px;background:#0d6efd;color:white;border:none;border-radius:5px;cursor:pointer;font-size:0.8rem;">
          ✉️ Cambiar correo
        </button>
        <button class="${u.activo ? 'btn-toggle-on' : 'btn-toggle-off'}"
                onclick="toggleActivoStaff('${u.id}', ${u.activo})" ${u.id === currentUserId ? 'disabled title="No puedes desactivar tu propia cuenta"' : ''}>
          ${u.activo ? 'Desactivar' : 'Activar'}
        </button>
        <button onclick="resetearPasswordStaffADni(${idx})"
                style="padding:5px 12px;background:#e65100;color:white;border:none;border-radius:5px;cursor:pointer;font-size:0.8rem;">
          🔑 Resetear a DNI
        </button>
      </div>
    </div>
  `).join('');
};

window.toggleActivoStaff = async function (id, activo) {
  if (id === currentUserId) { alert('❌ No puedes desactivar tu propia cuenta.'); return; }
  const { error } = await supabase.from('profiles').update({ activo: !activo }).eq('id', id);
  if (error) { alert('❌ ' + error.message); return; }
  cargarStaff();
};

window.cambiarEmailStaff = async function (idx) {
  const u = _staffEncontrados[idx];
  if (!u) return;
  const nuevoEmail = prompt(`Nuevo correo de contacto para ${u.apellidos}, ${u.nombres}:`, u.email || '');
  if (nuevoEmail === null) return;
  if (nuevoEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nuevoEmail)) {
    alert('❌ Correo inválido.');
    return;
  }
  const { error } = await supabase.from('profiles').update({ email: nuevoEmail || null }).eq('id', u.id);
  if (error) { alert('❌ ' + error.message); return; }
  alert('✅ Correo actualizado. Recuerda: esto no cambia cómo ingresa a la plataforma (sigue siendo su DNI).');
  cargarStaff();
};

// Reseteo de un clic: deja la contraseña de la cuenta admin/gestor igual a su DNI completo.
window.resetearPasswordStaffADni = async function (idx) {
  const u = _staffEncontrados[idx];
  if (!u) return;
  if (!await showConfirm(
    `¿Resetear la contraseña de ${u.apellidos}, ${u.nombres} a su DNI (${u.documento_numero})?`,
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
      usuario_id: u.id,
      updates: {},
      password: u.documento_numero,
    }),
  });
  const data = await res.json().catch(() => ({}));

  if (!res.ok || data?.error) {
    alert('❌ ' + (data?.error || 'Error al resetear la contraseña.'));
    return;
  }
  alert(`✅ Contraseña reseteada. Ya puede ingresar con DNI: ${u.documento_numero}`);
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

  document.getElementById('form-editar-trab').style.display = 'block';
  document.getElementById('form-editar-trab').scrollIntoView({ behavior: 'smooth', block: 'start' });
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

// ═══════════════════════════════
// 🔑 CORREGIR CONTRASEÑAS DNI CON CERO INICIAL
// ═══════════════════════════════
window.corregirPasswordsDNI = async function () {
  if (!empresaAdminId) { alert('❌ Sin empresa asignada.'); return; }

  const { data: afectados } = await supabase
    .from('profiles')
    .select('id, documento_numero, nombres, apellidos')
    .eq('empresa_id', empresaAdminId)
    .eq('rol', 'trabajador')
    .like('documento_numero', '0%');

  if (!afectados || afectados.length === 0) {
    alert('✅ No hay trabajadores con DNI que empiece en 0 en tu empresa.');
    return;
  }

  const confirmado = await showConfirm(
    `Se encontraron ${afectados.length} trabajador(es) con DNI que empieza en 0.\n\nSe les actualizará la contraseña para que sea su DNI completo (con el cero).\n\n¿Continuar?`,
    { confirmText: 'Sí, corregir' }
  );
  if (!confirmado) return;

  const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndyYWhqbHN0YXV0d2lueHlxY2Z4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxMTMyNjYsImV4cCI6MjA4ODY4OTI2Nn0.iAbYatXkr5BAplYDhs7vMca2ROjb11uFM0e4619sD4s';

  const { data: sessionDataAct3 } = await supabase.auth.getSession();
  let ok = 0, errores = 0;
  for (const u of afectados) {
    const res = await fetch('https://wrahjlstautwinxyqcfx.supabase.co/functions/v1/actualizar-usuario', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${sessionDataAct3.session?.access_token}`,
        'apikey': ANON_KEY,
      },
      body: JSON.stringify({
        usuario_id: u.id,
        updates: {},
        password: u.documento_numero,  // DNI con el cero completo
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.error) errores++;
    else ok++;
  }

  alert(`✅ Proceso completado.\n${ok} contraseña(s) corregida(s).\n${errores > 0 ? `❌ ${errores} con error.` : ''}`);
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
          codigo: `${prefijo}-${anio}-${String(correlativoActual).padStart(4, '0')}`,
          nota: Number(e.puntaje || 0),
          nombres: perfil.nombres || '',
          apellidos: perfil.apellidos || '',
          dni: perfil.documento_numero || '',
          cargo: perfil.cargos?.nombre || '',
          empresa: perfil.empresas?.nombre || '',
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
  const contenedor = document.getElementById('lista-toggle-cursos');
  contenedor.innerHTML = '<p style="color:#888;font-size:0.88rem;">Cargando...</p>';

  const { data: cursos, error: errCursos } = await supabase
    .from('cursos')
    .select('id, titulo, codigo, codigo_prefijo, duracion, vigencia_meses, url_video, url_material, activo')
    .eq('sede', sedeAdminActiva)
    .order('titulo');

  if (errCursos) {
    contenedor.innerHTML = `<p style="color:red;">❌ Error: ${errCursos.message}</p>`;
    return;
  }
  if (!cursos?.length) {
    contenedor.innerHTML = '<p style="color:#888;">No hay cursos registrados.</p>';
    return;
  }

  window.cursosCache = {};
  cursos.forEach(c => { window.cursosCache[c.id] = c; });

  const renderFila = c => `
    <tr>
      <td style="padding:10px 12px; font-weight:500;">${c.titulo}</td>
      <td style="padding:10px 12px; color:#888; font-size:0.82rem;">${c.duracion ? c.duracion + 'h' : '—'}</td>
      <td style="padding:10px 12px; white-space:nowrap;">
        <button onclick="abrirEdicionCurso('${c.id}')"
                style="padding:6px 14px; border:none; border-radius:6px; cursor:pointer; font-size:0.82rem;
                       background:#0d6efd; color:white;">
          ✏️ Editar
        </button>
      </td>
    </tr>`;

  contenedor.innerHTML = `
    <table style="width:100%; border-collapse:collapse;">
      <thead>
        <tr style="background:#f8f9fa; font-size:0.82rem; color:#555; text-transform:uppercase; letter-spacing:0.5px;">
          <th style="padding:8px 12px; text-align:left;">Curso</th>
          <th style="padding:8px 12px; text-align:left;">Duración</th>
          <th style="padding:8px 12px; text-align:left;">Acción</th>
        </tr>
      </thead>
      <tbody>
        ${cursos.map(renderFila).join('')}
      </tbody>
    </table>`;
};

window.abrirEdicionCurso = function (id) {
  const c = window.cursosCache?.[id];
  if (!c) { alert('❌ No se encontró el curso.'); return; }

  document.getElementById('editar-curso-id').value           = c.id;
  document.getElementById('editar-curso-titulo').value        = c.titulo || '';
  document.getElementById('editar-curso-codigo-prefijo').value= c.codigo_prefijo || '';
  document.getElementById('editar-curso-codigo').value        = c.codigo || '';
  document.getElementById('editar-curso-duracion').value      = c.duracion ?? '';
  document.getElementById('editar-curso-vigencia').value      = c.vigencia_meses ?? '';
  document.getElementById('editar-curso-url-material').value  = c.url_material || '';
  document.getElementById('editar-curso-pdf-file').value      = '';

  document.getElementById('modal-editar-curso').style.display = 'flex';
  cargarVideosCurso(c.id);
};

window.cerrarModalCurso = function () {
  document.getElementById('modal-editar-curso').style.display = 'none';
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
  }).eq('id', id);

  if (error) { alert('❌ Error al guardar: ' + error.message); return; }

  cerrarModalCurso();
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

window.cargarFormulariosCurso = async function () {
  await initSelectCursoForm();
  const sel = document.getElementById('select-curso-form');
  const cursoId = sel.value;
  if (!cursoId) { alert('Selecciona un curso.'); return; }

  const { data: forms } = await supabase
    .from('formularios').select('*')
    .eq('id_curso', cursoId).in('tipo', ['examen', 'eficacia']);

  const cont = document.getElementById('contenedor-formularios');
  cont.innerHTML = '';

  for (const tipo of ['examen', 'eficacia']) {
    const form  = forms?.find(f => f.tipo === tipo);
    const label = tipo === 'examen' ? '📝 Examen' : '✅ Evaluación de la eficacia';
    const color = tipo === 'examen' ? '#002855' : '#28a745';
    const bloque = document.createElement('div');
    bloque.style.cssText = 'border:1px solid #e0e0e0;border-radius:10px;padding:16px;margin-bottom:16px;';

    if (!form) {
      bloque.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <h3 style="margin:0;color:${color};">${label}</h3>
          <button onclick="crearFormulario('${cursoId}','${tipo}')" class="btn-primary" style="font-size:0.85rem;">+ Crear ${tipo}</button>
        </div>
        <p style="color:#888;font-size:0.85rem;margin-top:8px;">No existe aún para este curso.</p>`;
    } else {
      bloque.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px;">
          <h3 style="margin:0;color:${color};">${label}</h3>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
            <a href="#" onclick="descargarPlantillaPreguntas(event)" style="font-size:0.8rem;color:#666;text-decoration:underline;">⬇️ Plantilla Excel</a>
            <input type="file" id="import-preg-${form.id}" accept=".xlsx,.xls" style="display:none;"
              onchange="importarPreguntasExcel(${form.id},'${tipo}', this)" />
            <button onclick="document.getElementById('import-preg-${form.id}').click()" class="btn-secondary" style="font-size:0.85rem;">📥 Importar Excel</button>
            <button onclick="mostrarFormPregunta(${form.id},'${tipo}')" class="btn-primary" style="font-size:0.85rem;">+ Nueva pregunta</button>
          </div>
        </div>
        <div id="progreso-import-preg-${form.id}" style="font-size:0.82rem;color:#666;margin-bottom:8px;"></div>
        <div id="lista-preguntas-${form.id}"><em style="color:#888;font-size:0.85rem;">Cargando...</em></div>
        <div id="form-nueva-pregunta-${form.id}" style="display:none;background:#f8f9fa;border-radius:8px;padding:14px;margin-top:12px;">
          <p style="font-weight:600;margin:0 0 10px;">Nueva pregunta</p>
          <input id="txt-pregunta-${form.id}" type="text" placeholder="Texto de la pregunta *"
            style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.88rem;margin-bottom:8px;box-sizing:border-box;" />
          <div style="display:flex;gap:8px;align-items:center;">
            <label style="font-size:0.85rem;">Puntaje:</label>
            <input id="pts-pregunta-${form.id}" type="number" value="1" min="1"
              style="width:70px;padding:7px;border:1px solid #ddd;border-radius:6px;font-size:0.88rem;" />
            <button onclick="guardarNuevaPregunta(${form.id},'${tipo}')" class="btn-primary" style="font-size:0.85rem;">Guardar</button>
            <button onclick="document.getElementById('form-nueva-pregunta-${form.id}').style.display='none'"
              style="background:#e0e0e0;border:none;border-radius:6px;padding:7px 12px;cursor:pointer;font-size:0.85rem;">Cancelar</button>
          </div>
        </div>`;
      cargarPreguntas(form.id, tipo);
    }
    cont.appendChild(bloque);
  }
};

window.crearFormulario = async function (cursoId, tipo) {
  const label = tipo === 'examen' ? 'Examen' : 'Evaluación de la eficacia';
  const { error } = await supabase.from('formularios').insert([{ tipo, titulo: label, id_curso: cursoId, activo: true }]);
  if (error) { alert('❌ ' + error.message); return; }
  cargarFormulariosCurso();
};

window.mostrarFormPregunta = function (formularioId, tipo) {
  const div = document.getElementById(`form-nueva-pregunta-${formularioId}`);
  if (div) { div.style.display = 'block'; document.getElementById(`txt-pregunta-${formularioId}`).focus(); }
};

window.descargarPlantillaPreguntas = function (e) {
  e?.preventDefault();
  const XLSX = window.XLSX;
  const datos = [
    ['Pregunta', 'Puntaje', 'Opción 1', 'Opción 2', 'Opción 3', 'Opción 4', 'Correcta (1-4)'],
    ['¿Cuál es el equipo de protección obligatorio para trabajos en altura?', 1, 'Arnés', 'Guantes', 'Botas', 'Casco', 1],
  ];
  const ws = XLSX.utils.aoa_to_sheet(datos);
  ws['!cols'] = [{ wch: 45 }, { wch: 10 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 14 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Preguntas');
  XLSX.writeFile(wb, 'plantilla_preguntas.xlsx');
};

// Importa preguntas de opción múltiple en bloque desde Excel.
// Columnas: Pregunta, Puntaje, Opción 1-4 (deja vacías las que no uses), Correcta (1-4).
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
    const [pregunta, puntaje, op1, op2, op3, op4, correcta] = filas[i];
    if (!pregunta) continue;
    orden++;

    const { data: nuevaPregunta, error } = await supabase.from('preguntas')
      .insert([{ id_formulario: formularioId, pregunta: String(pregunta).trim(), orden, puntaje: parseFloat(puntaje) || 1 }])
      .select().single();

    if (error || !nuevaPregunta) { errores++; continue; }

    const opciones = [op1, op2, op3, op4]
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
        <span style="flex:1;">${o.opcion}</span>
        <button onclick="toggleCorrecta(${o.id},${p.id},${formularioId},'${tipo}')"
          style="background:${o.es_correcta ? '#28a745' : '#e0e0e0'};color:${o.es_correcta ? 'white' : '#555'};
          border:none;border-radius:4px;padding:3px 8px;cursor:pointer;font-size:0.78rem;">
          ${o.es_correcta ? '✓ Correcta' : 'Marcar'}</button>
        <button onclick="eliminarOpcion(${o.id},${p.id},${formularioId},'${tipo}')"
          style="background:#dc3545;color:white;border:none;border-radius:4px;padding:3px 7px;cursor:pointer;font-size:0.78rem;">✕</button>
      </div>`).join('');

    return `
      <div style="border-left:3px solid #002855;padding:10px 14px;margin-bottom:12px;background:#fafafa;border-radius:0 8px 8px 0;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
          <div>
            <span style="font-weight:600;color:#002855;font-size:0.85rem;">${i + 1}.</span>
            <span style="font-size:0.9rem;margin-left:6px;">${p.pregunta}</span>
            <span style="color:#888;font-size:0.78rem;margin-left:8px;">(${p.puntaje} pt${p.puntaje !== 1 ? 's' : ''})</span>
          </div>
          <button onclick="eliminarPregunta(${p.id},${formularioId},'${tipo}')"
            style="background:#dc3545;color:white;border:none;border-radius:5px;padding:4px 9px;cursor:pointer;font-size:0.8rem;white-space:nowrap;margin-left:8px;">
            🗑️ Eliminar</button>
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
        <button onclick="mostrarFormPreguntaEncuesta(${form.id})" class="btn-primary" style="font-size:0.85rem;">+ Nueva pregunta</button>
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
      <div id="form-preg-encuesta-${form.id}" style="display:none;background:#f8f9fa;border-radius:8px;padding:12px;margin-top:12px;">
        <input id="txt-preg-encuesta-${form.id}" type="text" placeholder="Ej: ¿El contenido fue claro y relevante? *"
          style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.88rem;margin-bottom:8px;box-sizing:border-box;" />
        <div style="display:flex;gap:8px;">
          <button onclick="guardarPreguntaEncuesta(${form.id})" class="btn-primary" style="font-size:0.85rem;">Guardar</button>
          <button onclick="document.getElementById('form-preg-encuesta-${form.id}').style.display='none'"
            style="background:#e0e0e0;border:none;border-radius:6px;padding:7px 12px;cursor:pointer;font-size:0.85rem;">Cancelar</button>
        </div>
      </div>
    </div>`;
};

window.mostrarFormPreguntaEncuesta = function (formId) {
  const div = document.getElementById(`form-preg-encuesta-${formId}`);
  if (div) { div.style.display = 'block'; document.getElementById(`txt-preg-encuesta-${formId}`).focus(); }
};

window.guardarPreguntaEncuesta = async function (formularioId) {
  const texto = document.getElementById(`txt-preg-encuesta-${formularioId}`).value.trim();
  if (!texto) { alert('Escribe el texto de la pregunta.'); return; }

  const { data: ult } = await supabase.from('preguntas').select('orden')
    .eq('id_formulario', formularioId).order('orden', { ascending: false }).limit(1);
  const orden = (ult?.[0]?.orden || 0) + 1;

  const { data: nueva, error } = await supabase
    .from('preguntas').insert([{ id_formulario: formularioId, pregunta: texto, orden, puntaje: 5 }]).select().single();
  if (error || !nueva) { alert('❌ ' + error?.message); return; }

  await supabase.from('opciones_pregunta').insert(
    OPCIONES_LIKERT.map(o => ({ id_pregunta: nueva.id, ...o, es_correcta: false }))
  );
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

const TIPO_COLOR_SST = { 'Seguridad': '#002855', 'Salud': '#198754', 'Medio ambiente': '#8a6d3b' };

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

  const tarjetas = data.map(f => `
    <div class="trab-card">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
        <div>
          <div class="trab-nombre">${f.curso}</div>
          <div class="trab-meta">${f.requisito || ''}${f.encargado ? ' · ' + f.encargado : ''}${f.duracion_hr ? ' · ' + f.duracion_hr + 'h' : ''}</div>
        </div>
        ${f.tipo_curso ? `<span style="background:${colorTipo(f.tipo_curso)};color:white;padding:3px 9px;border-radius:12px;font-size:0.72rem;white-space:nowrap;">${f.tipo_curso}</span>` : ''}
      </div>
      <div style="display:flex; gap:4px; margin-top:6px;">
        ${mesesKey.map((m, i) => `
          <span title="${MESES_NOM[i]}" style="flex:1; text-align:center; padding:4px 0; border-radius:5px; font-size:0.72rem; font-weight:600;
            background:${f[m] ? '#d4edda' : '#f0f0f0'}; color:${f[m] ? '#155724' : '#bbb'};">
            ${mesesNom[i]}
          </span>`).join('')}
      </div>
    </div>
  `).join('');

  cont.innerHTML = `
    <p style="font-size:0.85rem;color:#555;margin-bottom:12px;">${data.length} cursos — Año ${anio} · ${sedeAdminActiva}</p>
    <div class="galeria-trabajadores">${tarjetas}</div>`;
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
        <thead><tr style="background:#002855;color:white;">
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
      .eq('empresa_id', empresaAdminId).eq('anio', anio).eq('sede', 'ANTAMINA'),
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
    ['Cursos programados (año)', totalProg, '#002855'],
    ['Cursos ejecutados (año)', totalEjec, '#002855'],
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
        { label: 'Programados', data: mesData.map(m => m.programados), backgroundColor: '#002855aa' },
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
      datasets: [{ data: tipoData.map(t => t.prog), backgroundColor: ['#002855','#198754','#0d6efd'] }]
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
      datasets: [{ data: encData, backgroundColor: ['#002855','#198754','#0d6efd','#fd7e14','#6f42c1'] }]
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

  const header = cursos.map(c => `<th style="padding:8px 6px;font-size:0.76rem;max-width:110px;">${c.titulo}</th>`).join('');
  const filas = cargos.map(cg => {
    const marcados = window._cursosPorCargo[cg.id] || new Set();
    const celdas = cursos.map(c => `
      <td style="text-align:center;padding:6px;">
        <input type="checkbox" ${marcados.has(c.id) ? 'checked' : ''}
          onchange="toggleCargoCurso('${cg.id}','${c.id}', this.checked)" />
      </td>`).join('');
    return `<tr style="border-bottom:1px solid #eee;">
      <td style="padding:7px 10px;font-weight:500;white-space:nowrap;">${cg.nombre}</td>
      ${celdas}
    </tr>`;
  }).join('');

  cont.innerHTML = `
    <div style="overflow-x:auto;">
      <table style="border-collapse:collapse;width:100%;font-size:0.85rem;">
        <thead><tr style="background:#002855;color:white;">
          <th style="padding:8px 10px;text-align:left;">Cargo</th>
          ${header}
        </tr></thead>
        <tbody>${filas}</tbody>
      </table>
    </div>`;
}

window.toggleCargoCurso = async function (cargoId, cursoId, marcado) {
  let rutaId = window._rutaPorCargo[cargoId];

  if (!rutaId) {
    if (!marcado) return;
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
    window._cursosPorCargo[cargoId] = new Set();
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

window.buscarTrabajadorExcepcion = async function () {
  const q = document.getElementById('buscar-excepcion-input').value.trim();
  if (!q) { alert('Ingresa un DNI o apellido.'); return; }

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
      <button onclick="abrirExcepcionesTrabajador(${idx})" style="padding:6px 12px;background:#002855;color:white;border:none;border-radius:6px;cursor:pointer;font-size:0.82rem;">Ver cursos</button>
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
    <h3 style="font-size:0.95rem;font-weight:600;color:#002855;margin-bottom:10px;">
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
