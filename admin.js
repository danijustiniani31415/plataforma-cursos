import { supabase } from './src/supabaseClient.js';
import { alertToToast, withLoading, showConfirm, fieldValidation } from './toast.js';
import { buildHtmlCertificado, generarCertificadoPDFBlob } from './certificado.js';
const alert = alertToToast;

// Normaliza DNI: elimina espacios/saltos y padea a 8 dígitos con 0 a la izquierda
function normalizarDNI(raw) {
  return String(raw).trim().replace(/[\n\r]/g, '').padStart(8, '0');
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

  // Gestor de Personal: solo ve las tabs de importar y actualizar trabajadores
  if (perfil?.rol === "gestor") {
    const tabsPermitidas = ["trabajadores", "importar", "actualizar"];
    document.getElementById('panel-crear-gestor')?.remove();
    document.querySelectorAll('.nav-tab').forEach(btn => {
      const onclick = btn.getAttribute('onclick') || '';
      const match = onclick.match(/mostrarTab\('([^']+)'/);
      const tabNombre = match ? match[1] : null;
      if (!tabNombre || !tabsPermitidas.includes(tabNombre)) {
        btn.style.display = 'none';
      }
    });
    // Activar la tab de importar por defecto
    const btnImportar = document.querySelector(".nav-tab[onclick*=\"mostrarTab('importar'\"]");
    if (btnImportar) btnImportar.click();
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

  // Cargar cursos en los selects que los necesitan (Forms import + bulk cert)
  const { data: cursosForSelect } = await supabase
    .from('cursos').select('id, titulo').order('titulo');
  const selFormsCurso = document.getElementById('forms-curso');
  if (selFormsCurso) {
    (cursosForSelect || []).forEach(c => {
      selFormsCurso.innerHTML += `<option value="${c.id}">${c.titulo}</option>`;
    });
    initSelectBuscable('forms-curso');
  }
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

  const emailFinal = email || `${dni}@cvglobal-group.com`;

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    alert("❌ Ingresa un correo electrónico válido.");
    return;
  }

  if (!empresaAdminId) {
    alert("❌ Tu usuario no tiene empresa asignada. Contacta al superadmin.");
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
      rol:              'trabajador'
    })
  });

  const data = await response.json();

  if (!response.ok || data?.error) {
    alert('❌ ' + (data?.error || 'Error al crear usuario'));
    return;
  }

  alert(`✅ Usuario creado correctamente.\nCorreo: ${emailFinal}\nContraseña inicial: ${dni}`);

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

  const emailFinal = email || `${dni}@cvglobal-group.com`;

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

  alert(`✅ Gestor de Personal creado.\nCorreo: ${emailFinal}\nContraseña inicial: ${dni}`);
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
  const url_video     = document.getElementById("url-video").value.trim();
  const url_material  = document.getElementById("url-material").value.trim();

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
    url_video:    url_video    || null,
    url_material: url_material || null,
    activo:       true
  }]);

  if (error) {
    alert("❌ Error al subir curso: " + error.message);
  } else {
    alert(`✅ Curso subido correctamente.\nCódigo: ${codigo}`);
    ["titulo-curso", "codigo-prefijo", "duracion-curso", "vigencia-curso",
     "url-video", "url-material"].forEach(id => {
      document.getElementById(id).value = '';
    });
  }
};
// ═══════════════════════════════
// 📋 Mostrar registros de notas
// ═══════════════════════════════
window.cargarRegistros = async function () {
  const { data, error } = await supabase
    .from('envios_formulario')
    .select('usuario_email, puntaje, aprobado, created_at, formularios(tipo), cursos(titulo)')
    .eq('estado', 'completado')
    .order('created_at', { ascending: false });

  if (error) {
    alert("❌ Error al cargar registros: " + error.message);
    return;
  }

  const tbody = document.querySelector("#tabla-registros tbody");
  tbody.innerHTML = "";

  const tipoLabel = { encuesta: 'Encuesta', examen: 'Examen', eficacia: 'Eficacia' };

  data.forEach(reg => {
    const tipo = reg.formularios?.tipo || '';
    const esEncuesta = tipo === 'encuesta';
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${reg.usuario_email}</td>
      <td>${reg.cursos?.titulo || "Curso eliminado"}</td>
      <td>${tipoLabel[tipo] || tipo}</td>
      <td>${esEncuesta ? '—' : (reg.puntaje ?? '—')}</td>
      <td>${new Date(reg.created_at).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' })}</td>
      <td style="color: ${reg.aprobado ? 'green' : esEncuesta ? '#888' : 'red'}">
        ${esEncuesta ? '✅ Completada' : reg.aprobado ? '✅ Aprobado' : '❌ No aprobado'}
      </td>
    `;
    tbody.appendChild(tr);
  });
};

// ═══════════════════════════════
// 🔐 Resetear contraseña
// ═══════════════════════════════
window.resetearContrasena = async function () {
  const email = document.getElementById("email-reset").value.trim();

  if (!email) {
    alert("Ingresa el correo.");
    return;
  }

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
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

window.descargarPlantilla = async function (e) {
  e.preventDefault();
  const XLSX = window.XLSX;

  // Obtener cargos activos
  const { data: cargos } = await supabase.from('cargos').select('nombre').eq('activo', true).order('nombre');
  const listaCargos = cargos?.map(c => c.nombre) || [];

  // Hoja principal
  const ws = XLSX.utils.aoa_to_sheet([
    ['DNI', 'Apellidos', 'Nombres', 'Email', 'Cargo', 'Telefono', 'Fecha Ingreso'],
  ]);

  // Forzar columna DNI como texto en 200 filas para que Excel preserve ceros iniciales
  for (let row = 2; row <= 201; row++) {
    ws[`A${row}`] = { t: 's', v: '' };
  }
  ws['!ref'] = 'A1:G201';

  // Hoja oculta con la lista de cargos para el dropdown
  const wsCargos = XLSX.utils.aoa_to_sheet(listaCargos.map(c => [c]));

  // Ancho de columnas
  ws['!cols'] = [12, 22, 22, 28, 22, 14, 14].map(w => ({ wch: w }));

  // Validación desplegable en columna E (Cargo) para filas 2-200
  ws['!dataValidations'] = ws['!dataValidations'] || [];
  if (listaCargos.length > 0) {
    ws['!dataValidations'].push({
      type: 'list',
      sqref: 'E2:E200',
      formula1: listaCargos.map(c => `"${c}"`).join(',').length <= 255
        ? '"' + listaCargos.join(',') + '"'
        : 'Cargos!$A$1:$A$' + listaCargos.length
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

  const reader = new FileReader();
  reader.onload = function (e) {
    const XLSX = window.XLSX;
    const workbook = XLSX.read(e.target.result, { type: 'array', cellDates: true });
    const hoja = workbook.Sheets[workbook.SheetNames[0]];
    const filas = XLSX.utils.sheet_to_json(hoja, { header: 1, defval: '' });

    // Saltar encabezado
    filasExcel = filas.slice(1).filter(f => f[0] || f[3]);

    const tbody = document.getElementById('tbody-preview');
    tbody.innerHTML = '';
    filasExcel.forEach(f => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="padding:5px;">${f[0]}</td>
        <td style="padding:5px;">${f[1]}</td>
        <td style="padding:5px;">${f[2]}</td>
        <td style="padding:5px;">${f[3]}</td>
        <td style="padding:5px;">${f[4]}</td>
        <td style="padding:5px;">${f[5]}</td>
        <td style="padding:5px;">${f[6]}</td>
        <td style="padding:5px; color:#888;">Pendiente</td>
      `;
      tbody.appendChild(tr);
    });

    document.getElementById('preview-resumen').textContent =
      `${filasExcel.length} trabajadores encontrados. Revisa los datos antes de importar.`;
    document.getElementById('preview-excel').style.display = 'block';
  };
  reader.readAsArrayBuffer(archivo);
};

window.importarDesdeExcel = async function () {
  if (!filasExcel.length) return;

  // Auto-eliminar DNIs duplicados (se queda con la primera aparición)
  const vistos = new Set();
  const antesDeDedup = filasExcel.length;
  filasExcel = filasExcel.filter(f => {
    const dni = normalizarDNI(f[0]);
    if (vistos.has(dni)) return false;
    vistos.add(dni);
    return true;
  });
  const eliminados = antesDeDedup - filasExcel.length;
  if (eliminados > 0) {
    const progreso = document.getElementById('progreso-importacion');
    progreso.textContent = `ℹ️ ${eliminados} fila(s) duplicada(s) eliminadas automáticamente.`;
  }

  const btnImportar = document.querySelector('#preview-excel .btn-primary');
  btnImportar.disabled = true;
  btnImportar.textContent = '⏳ Importando...';

  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;

  const { data: cargos } = await supabase.from('cargos').select('id, nombre').eq('activo', true);

  const progreso = document.getElementById('progreso-importacion');
  const filas = document.querySelectorAll('#tbody-preview tr');
  let ok = 0, errores = 0;
  const filasError = [['DNI', 'Apellidos', 'Nombres', 'Email', 'Cargo', 'Error']];

  for (let i = 0; i < filasExcel.length; i++) {
    const f = filasExcel[i];
    const dni          = normalizarDNI(f[0]);
    const apellidos    = String(f[1]).trim();
    const nombres      = String(f[2]).trim();
    const emailRaw     = String(f[3]).trim().toLowerCase();
    const email        = emailRaw.includes('@') ? emailRaw : `${dni}@cvglobal-group.com`;
    const cargoNombre  = String(f[4]).trim();
    const telefono     = String(f[5]).trim();
    const fechaRaw = f[6];
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
    tdEstado.textContent = '⏳ Procesando...';
    tdEstado.style.color = '#888';

    const cargo = cargos?.find(c => c.nombre.toLowerCase() === cargoNombre.toLowerCase());

    const response = await fetch('https://wrahjlstautwinxyqcfx.supabase.co/functions/v1/crear-usuario', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndyYWhqbHN0YXV0d2lueHlxY2Z4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxMTMyNjYsImV4cCI6MjA4ODY4OTI2Nn0.iAbYatXkr5BAplYDhs7vMca2ROjb11uFM0e4619sD4s'
      },
      body: JSON.stringify({
        email,
        password:         dni,
        nombres,
        apellidos,
        documento_tipo:   'DNI',
        documento_numero: dni,
        telefono:         telefono || null,
        empresa_id:       empresaAdminId,
        cargo_id:         cargo?.id || null,
        fecha_ingreso:    fechaIngreso || null,
        rol:              'trabajador'
      })
    });

    const data = await response.json();

    if (!response.ok || data?.error) {
      const msgError = data?.error || 'Error desconocido';
      tdEstado.textContent = '❌ ' + msgError;
      tdEstado.style.color = 'red';
      filasError.push([dni, apellidos, nombres, email, cargoNombre, msgError]);
      errores++;
    } else {
      tdEstado.textContent = '✅ Creado';
      tdEstado.style.color = 'green';
      ok++;
    }

    progreso.textContent = `Progreso: ${i + 1}/${filasExcel.length} — ✅ ${ok} creados, ❌ ${errores} errores`;
  }

  progreso.textContent += ' — ¡Importación completada!';
  btnImportar.disabled = false;
  btnImportar.textContent = '✅ Confirmar importación';

  if (errores > 0) {
    const XLSX = window.XLSX;
    const ws = XLSX.utils.aoa_to_sheet(filasError);
    ws['!cols'] = [12, 20, 20, 30, 20, 40].map(w => ({ wch: w }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Errores');
    XLSX.writeFile(wb, 'errores_importacion.xlsx');
    alert(`⚠️ ${errores} registro(s) fallaron. Se descargó "errores_importacion.xlsx" con el detalle.`);
  }
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

// ═══════════════════════════════
// 📅 ASIGNACIÓN MENSUAL
// ═══════════════════════════════

window.descargarPlantillaAsignacion = async function (e) {
  e.preventDefault();
  const XLSX = window.XLSX;

  const { data: cargos } = await supabase.from('cargos').select('nombre').eq('activo', true).order('nombre');
  const listaCargos = cargos?.map(c => c.nombre) || [];

  const ws = XLSX.utils.aoa_to_sheet([
    ['DNI', 'Apellidos', 'Nombres', 'Email', 'Cargo', 'Telefono', 'Fecha Ingreso'],
  ]);
  for (let row = 2; row <= 501; row++) {
    ws[`A${row}`] = { t: 's', v: '' };
  }
  ws['!ref'] = 'A1:G501';
  ws['!cols'] = [12, 22, 22, 28, 22, 14, 14].map(w => ({ wch: w }));

  if (listaCargos.length > 0) {
    ws['!dataValidations'] = [{
      type: 'list', sqref: 'E2:E500',
      formula1: listaCargos.join(',').length <= 255
        ? '"' + listaCargos.join(',') + '"'
        : 'Cargos!$A$1:$A$' + listaCargos.length
    }];
  }

  const wsCargos = XLSX.utils.aoa_to_sheet(listaCargos.map(c => [c]));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Asignacion');
  XLSX.utils.book_append_sheet(wb, wsCargos, 'Cargos');
  XLSX.writeFile(wb, 'plantilla_asignacion_mensual.xlsx');
};

let filasAsignacion = [];

window.previsualizarAsignacion = async function () {
  const archivo = document.getElementById('archivo-asignacion').files[0];
  if (!archivo) return;

  const reader = new FileReader();
  reader.onload = async function (e) {
    const XLSX = window.XLSX;
    const wb   = XLSX.read(e.target.result, { type: 'array', cellDates: true });
    const hoja = wb.Sheets[wb.SheetNames[0]];
    const filas = XLSX.utils.sheet_to_json(hoja, { header: 1, defval: '' });

    filasAsignacion = filas.slice(1).filter(f => f[0]);

    const dnis = filasAsignacion.map(f => normalizarDNI(f[0]));

    const { data: perfiles } = await supabase
      .from('profiles')
      .select('documento_numero, nombres, apellidos, email')
      .in('documento_numero', dnis)
      .eq('empresa_id', empresaAdminId);

    const perfilMap = {};
    perfiles?.forEach(p => { perfilMap[p.documento_numero] = p; });

    const tbody = document.getElementById('tbody-asignacion');
    tbody.innerHTML = '';
    let existentes = 0, nuevos = 0;

    filasAsignacion.forEach(f => {
      const dni      = normalizarDNI(f[0]);
      const apellidos = String(f[1]).trim();
      const nombres   = String(f[2]).trim();
      const cargo     = String(f[4]).trim();
      const p = perfilMap[dni];
      const tr = document.createElement('tr');
      if (p) {
        existentes++;
        tr.innerHTML = `<td>${dni}</td><td>${p.apellidos} ${p.nombres}</td>
          <td>${p.cargo || ''}</td>
          <td style="color:#007bff;">🔵 Ya existe — solo se asigna</td>`;
      } else if (apellidos && nombres) {
        nuevos++;
        tr.innerHTML = `<td>${dni}</td><td>${apellidos} ${nombres}</td>
          <td>${cargo}</td>
          <td style="color:green;">🟢 Nuevo — se creará y asignará</td>`;
      } else {
        tr.innerHTML = `<td>${dni}</td><td style="color:#888;">Sin nombres</td>
          <td></td>
          <td style="color:red;">❌ Falta Apellidos/Nombres</td>`;
      }
      tbody.appendChild(tr);
    });

    document.getElementById('preview-resumen-asig').textContent =
      `${filasAsignacion.length} filas — 🔵 ${existentes} existentes, 🟢 ${nuevos} nuevos a crear.`;
    document.getElementById('preview-asignacion').style.display = 'block';
  };
  reader.readAsArrayBuffer(archivo);
};

window.importarAsignacion = async function () {
  if (!filasAsignacion.length) return;

  const mes  = parseInt(document.getElementById('asig-mes').value);
  const anio = parseInt(document.getElementById('asig-anio').value);
  const btn  = document.getElementById('btn-confirmar-asignacion');
  btn.disabled = true;
  btn.textContent = '⏳ Procesando...';

  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;

  const { data: cargos } = await supabase.from('cargos').select('id, nombre').eq('activo', true);
  const { data: perfilesExistentes } = await supabase
    .from('profiles')
    .select('id, documento_numero, email')
    .in('documento_numero', filasAsignacion.map(f => normalizarDNI(f[0])))
    .eq('empresa_id', empresaAdminId);

  const perfilMap = {};
  perfilesExistentes?.forEach(p => { perfilMap[p.documento_numero] = p; });

  const filas = document.querySelectorAll('#tbody-asignacion tr');
  const progreso = document.getElementById('progreso-asignacion');
  let ok = 0, errores = 0;
  const registros = [];

  for (let i = 0; i < filasAsignacion.length; i++) {
    const f          = filasAsignacion[i];
    const dni        = String(f[0]).trim();
    const apellidos  = String(f[1]).trim();
    const nombres    = String(f[2]).trim();
    const emailRaw   = String(f[3]).trim();
    const cargoNombre = String(f[4]).trim();
    const telefono   = String(f[5]).trim();
    const fechaRaw   = f[6];
    let fechaIngreso = '';
    if (fechaRaw instanceof Date) {
      fechaIngreso = `${fechaRaw.getFullYear()}-${String(fechaRaw.getMonth()+1).padStart(2,'0')}-${String(fechaRaw.getDate()).padStart(2,'0')}`;
    } else if (fechaRaw) {
      fechaIngreso = String(fechaRaw).trim();
    }

    const tdEstado = filas[i]?.querySelectorAll('td')[3];

    if (perfilMap[dni]) {
      // Trabajador existente — solo asignar
      registros.push({
        empresa_id: empresaAdminId,
        usuario_id: perfilMap[dni].id,
        usuario_email: perfilMap[dni].email,
        documento_numero: dni, mes, anio
      });
      if (tdEstado) { tdEstado.textContent = '✅ Asignado'; tdEstado.style.color = 'green'; }
      ok++;
    } else if (apellidos && nombres) {
      // Trabajador nuevo — crear cuenta y asignar
      const email  = emailRaw.includes('@') ? emailRaw : `${dni}@cvglobal-group.com`;
      const cargo  = cargos?.find(c => c.nombre.toLowerCase() === cargoNombre.toLowerCase());
      if (tdEstado) { tdEstado.textContent = '⏳ Creando...'; tdEstado.style.color = '#888'; }

      const res  = await fetch('https://wrahjlstautwinxyqcfx.supabase.co/functions/v1/crear-usuario', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndyYWhqbHN0YXV0d2lueHlxY2Z4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxMTMyNjYsImV4cCI6MjA4ODY4OTI2Nn0.iAbYatXkr5BAplYDhs7vMca2ROjb11uFM0e4619sD4s'
        },
        body: JSON.stringify({
          email, password: dni, nombres, apellidos,
          documento_tipo: 'DNI', documento_numero: dni,
          telefono: telefono || null, empresa_id: empresaAdminId,
          cargo_id: cargo?.id || null, fecha_ingreso: fechaIngreso || null, rol: 'trabajador'
        })
      });
      const data = await res.json();
      if (!res.ok || data?.error) {
        if (tdEstado) { tdEstado.textContent = '❌ ' + (data?.error || 'Error'); tdEstado.style.color = 'red'; }
        errores++;
      } else {
        // Buscar el perfil recién creado para obtener su ID
        const { data: nuevoPerfil } = await supabase
          .from('profiles').select('id, email').eq('documento_numero', dni).single();
        if (nuevoPerfil) {
          registros.push({
            empresa_id: empresaAdminId,
            usuario_id: nuevoPerfil.id,
            usuario_email: nuevoPerfil.email,
            documento_numero: dni, mes, anio
          });
        }
        if (tdEstado) { tdEstado.textContent = '✅ Creado y asignado'; tdEstado.style.color = 'green'; }
        ok++;
      }
    } else {
      if (tdEstado) { tdEstado.textContent = '⚠️ Saltado'; tdEstado.style.color = 'orange'; }
    }

    progreso.textContent = `Progreso: ${i+1}/${filasAsignacion.length} — ✅ ${ok}, ❌ ${errores}`;
  }

  // Insertar todas las asignaciones de una vez
  if (registros.length) {
    await supabase.from('asignaciones_mes')
      .upsert(registros, { onConflict: 'empresa_id,documento_numero,mes,anio' });
  }

  progreso.textContent += ` — ¡Completado! ${registros.length} asignados al ${mes}/${anio}.`;
  btn.disabled = false;
  btn.textContent = '✅ Confirmar asignación';
};

window.verAsignadosMes = async function () {
  const mes  = parseInt(document.getElementById('ver-asig-mes').value);
  const anio = parseInt(document.getElementById('ver-asig-anio').value);

  const { data, error } = await supabase
    .from('asignaciones_mes')
    .select('documento_numero, usuario_email, profiles(nombres, apellidos, cargo)')
    .eq('empresa_id', empresaAdminId)
    .eq('mes', mes)
    .eq('anio', anio)
    .order('documento_numero');

  const cont = document.getElementById('lista-asignados-mes');
  if (error || !data?.length) {
    cont.innerHTML = '<p style="color:#888;">No hay asignaciones para ese mes.</p>';
    return;
  }

  cont.innerHTML = `
    <p style="font-size:0.88rem; color:#555; margin-bottom:10px;">${data.length} trabajadores asignados</p>
    <div style="overflow-x:auto;">
      <table class="tabla-trabajadores">
        <thead><tr><th>DNI</th><th>Apellidos y Nombres</th><th>Cargo</th><th>Email</th></tr></thead>
        <tbody>${data.map(r => `<tr>
          <td>${r.documento_numero}</td>
          <td>${r.profiles?.apellidos || ''} ${r.profiles?.nombres || ''}</td>
          <td>${r.profiles?.cargo || ''}</td>
          <td>${r.usuario_email || ''}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>`;
};

window.descargarReporteExcel = async function () {
  const mes  = parseInt(document.getElementById('filtro-mes').value);
  const anio = parseInt(document.getElementById('filtro-anio').value);

  // Rango en hora Perú (UTC-5)
  const desde = new Date(Date.UTC(anio, mes - 1, 1, 5, 0, 0)).toISOString();
  const hasta = new Date(Date.UTC(anio, mes,     1, 5, 0, 0)).toISOString();

  // 1. Perfiles de la empresa
  const { data: perfiles, error: errPerfiles } = await supabase
    .from('profiles')
    .select('email, nombres, apellidos, documento_numero, documento_tipo, cargo, empresa')
    .eq('empresa_id', empresaAdminId);

  if (errPerfiles) { alert('❌ Error al cargar perfiles: ' + errPerfiles.message); return; }
  if (!perfiles || perfiles.length === 0) { alert('No hay trabajadores en tu empresa.'); return; }

  const perfilMap = {};
  perfiles.forEach(p => { perfilMap[p.email] = p; });
  const emails = perfiles.map(p => p.email);

  // 2. Formularios y cursos (sin joins)
  const [{ data: todosFormularios }, { data: todosCursos }] = await Promise.all([
    supabase.from('formularios').select('id, tipo'),
    supabase.from('cursos').select('id, titulo')
  ]);
  const tipoFormMap  = {};
  todosFormularios?.forEach(f => { tipoFormMap[f.id]  = f.tipo; });
  const cursoTitMap  = {};
  todosCursos?.forEach(c => { cursoTitMap[c.id] = c.titulo; });

  // 3. Envíos del período
  const { data: envios, error } = await supabase
    .from('envios_formulario')
    .select('usuario_email, id_formulario, id_curso, puntaje, porcentaje, aprobado, created_at')
    .in('usuario_email', emails)
    .eq('estado', 'completado')
    .gte('created_at', desde)
    .lt('created_at', hasta)
    .order('created_at', { ascending: true });

  if (error) { alert('❌ Error: ' + error.message); return; }
  if (!envios || envios.length === 0) { alert('No hay registros de tu empresa para ese mes.'); return; }

  const mesesNombre = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                       'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

  const tipoLabel = { encuesta: 'Encuesta', examen: 'Examen', eficacia: 'Eficacia' };

  const filas = [
    ['Apellidos', 'Nombres', 'Documento', 'Tipo Doc', 'Cargo', 'Empresa', 'Curso', 'Tipo Evaluación', 'Nota (/20)', 'Porcentaje', 'Estado', 'Fecha']
  ];

  envios.forEach(r => {
    const p = perfilMap[r.usuario_email];
    const tipo = tipoFormMap[r.id_formulario] || '';
    const esEncuesta = tipo === 'encuesta';
    filas.push([
      p?.apellidos || '',
      p?.nombres || '',
      p?.documento_numero || r.usuario_email,
      p?.documento_tipo || '',
      p?.cargo || '',
      p?.empresa || '',
      cursoTitMap[r.id_curso] || '',
      tipoLabel[tipo] || tipo,
      esEncuesta ? '—' : (r.puntaje ?? '—'),
      esEncuesta ? '—' : (r.porcentaje != null ? r.porcentaje.toFixed(1) + '%' : '—'),
      esEncuesta ? 'Completada' : (r.aprobado ? 'Aprobado' : 'Desaprobado'),
      new Date(r.created_at).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' })
    ]);
  });

  const XLSX = window.XLSX;
  const ws = XLSX.utils.aoa_to_sheet(filas);
  ws['!cols'] = [20,20,15,10,20,20,30,16,10,12,12,12].map(w => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Resultados');
  XLSX.writeFile(wb, `Reporte_Capacitaciones_${mesesNombre[mes-1]}_${anio}.xlsx`);
};

// ═══════════════════════════════
// 👥 Lista y edición de trabajadores
// ═══════════════════════════════
let cargosDisponibles = [];

const PAGE_SIZE = 50;
let _trabTotal = 0;

window.cargarTrabajadores = async function (page = 0) {
  const desde = page * PAGE_SIZE;
  const busqueda = document.getElementById('buscar-apellido')?.value.trim() || '';

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

  const [{ data, error, count }, { data: cargos }] = await Promise.all([
    query,
    supabase.from('cargos').select('id, nombre').eq('activo', true).order('nombre'),
  ]);

  if (error) { alert('❌ Error: ' + error.message); return; }

  _trabTotal = count || 0;
  cargosDisponibles = cargos || [];

  const tbody = document.getElementById('tbody-trabajadores');
  tbody.innerHTML = '';

  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:24px;color:#888;">
      Sin trabajadores registrados en tu empresa.</td></tr>`;
    document.getElementById('tabla-trabajadores').style.display = 'table';
    document.getElementById('paginacion-trabajadores')?.remove();
    return;
  }

  data.forEach(u => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${u.apellidos || ''} ${u.nombres || ''}</td>
      <td>${u.documento_numero || ''}</td>
      <td>${u.email || ''}</td>
      <td>${u.cargo || ''}</td>
      <td>${u.telefono || ''}</td>
      <td><span class="${u.activo ? 'badge-activo' : 'badge-inactivo'}">${u.activo ? 'Activo' : 'Inactivo'}</span></td>
      <td style="display:flex; gap:6px;">
        <button class="btn-editar" onclick="abrirEditar('${u.id}')">✏️ Editar</button>
        <button class="${u.activo ? 'btn-toggle-on' : 'btn-toggle-off'}" onclick="toggleActivo('${u.id}', ${u.activo})">
          ${u.activo ? 'Desactivar' : 'Activar'}
        </button>
      </td>`;
    tbody.appendChild(tr);
  });

  document.getElementById('tabla-trabajadores').style.display = 'table';

  // Paginación
  let pag = document.getElementById('paginacion-trabajadores');
  if (!pag) {
    pag = document.createElement('div');
    pag.id = 'paginacion-trabajadores';
    pag.style.cssText = 'display:flex;align-items:center;gap:10px;margin-top:12px;font-size:0.85rem;color:#555;';
    document.getElementById('tabla-trabajadores').after(pag);
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

window.abrirEditar = async function (id) {
  const { data: u } = await supabase
    .from('profiles')
    .select('id, nombres, apellidos, email, documento_numero, telefono, cargo_id, fecha_ingreso')
    .eq('id', id)
    .single();

  document.getElementById('editar-id').value = u.id;
  document.getElementById('editar-nombres').value = u.nombres || '';
  document.getElementById('editar-apellidos').value = u.apellidos || '';
  document.getElementById('editar-email').value = u.email || '';
  document.getElementById('editar-telefono').value = u.telefono || '';
  document.getElementById('editar-documento').value = u.documento_numero || '';
  document.getElementById('editar-fecha-ingreso').value = u.fecha_ingreso || '';

  const selCargo = document.getElementById('editar-cargo');
  selCargo.innerHTML = '<option value="">-- Sin cargo --</option>';
  cargosDisponibles.forEach(c => {
    selCargo.innerHTML += `<option value="${c.id}" ${u.cargo_id === c.id ? 'selected' : ''}>${c.nombre}</option>`;
  });

  const modal = document.getElementById('modal-editar');
  modal.style.display = 'flex';
};

window.cerrarModal = function () {
  document.getElementById('modal-editar').style.display = 'none';
};

window.guardarEdicion = async function () {
  const id          = document.getElementById('editar-id').value;
  const nombres     = document.getElementById('editar-nombres').value.trim();
  const apellidos   = document.getElementById('editar-apellidos').value.trim();
  const email       = document.getElementById('editar-email').value.trim();
  const telefono    = document.getElementById('editar-telefono').value.trim();
  const documento   = document.getElementById('editar-documento').value.trim();
  const cargo_id    = document.getElementById('editar-cargo').value || null;
  const fecha_ingreso = document.getElementById('editar-fecha-ingreso').value || null;

  if (!nombres || !apellidos) { alert('❌ Nombres y apellidos son obligatorios.'); return; }

  const emailFinal = email || `${documento}@cvglobal-group.com`;

  // Obtener nombre del cargo y datos de empresa
  let cargoNombre = null;
  if (cargo_id) {
    const { data: carg } = await supabase.from('cargos').select('nombre').eq('id', cargo_id).single();
    cargoNombre = carg?.nombre || null;
  }

  const { data: emp } = await supabase.from('empresas').select('nombre, ruc').eq('id', empresaAdminId).single();

  const { error } = await supabase
    .from('profiles')
    .update({
      nombres, apellidos,
      email:            emailFinal,
      telefono:         telefono || null,
      documento_numero: documento,
      cargo_id,
      cargo:            cargoNombre,
      empresa:          emp?.nombre || null,
      empresa_ruc:      emp?.ruc || null,
      fecha_ingreso
    })
    .eq('id', id);

  if (error) { alert('❌ Error: ' + error.message); return; }

  alert('✅ Datos actualizados correctamente.');
  cerrarModal();
  cargarTrabajadores();
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

    // Usar edge function para actualizar (actualiza profiles + Auth si cambia email)
    const res = await fetch('https://wrahjlstautwinxyqcfx.supabase.co/functions/v1/actualizar-usuario', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ANON_KEY}`,
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

  let ok = 0, errores = 0;
  for (const u of afectados) {
    const res = await fetch('https://wrahjlstautwinxyqcfx.supabase.co/functions/v1/actualizar-usuario', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ANON_KEY}`,
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

// ═══════════════════════════════
// 📊 DASHBOARD
// ═══════════════════════════════

let graficaSatisfaccionChart = null;

window.cargarGraficaSatisfaccion = async function () {
  const anio = parseInt(document.getElementById('sat-anio').value);

  // Emails de trabajadores de la empresa
  const { data: trabajadores } = await supabase
    .from('profiles')
    .select('email')
    .eq('empresa_id', empresaAdminId)
    .eq('rol', 'trabajador')
    .eq('activo', true);
  if (!trabajadores?.length) return;
  const emails = trabajadores.map(t => t.email);

  // IDs de formularios tipo encuesta
  const { data: formsEncuesta } = await supabase
    .from('formularios').select('id').eq('tipo', 'encuesta');
  const encuestaIds = formsEncuesta?.map(f => f.id) || [];
  if (!encuestaIds.length) { alert('No hay encuestas configuradas.'); return; }

  // Envíos de encuesta del año seleccionado
  const desde = new Date(Date.UTC(anio,  0, 1, 5, 0, 0)).toISOString();
  const hasta = new Date(Date.UTC(anio + 1, 0, 1, 5, 0, 0)).toISOString();

  const { data: envios } = await supabase
    .from('envios_formulario')
    .select('porcentaje, created_at')
    .in('usuario_email', emails)
    .in('id_formulario', encuestaIds)
    .eq('estado', 'completado')
    .gte('created_at', desde)
    .lt('created_at', hasta);

  // Agrupar por mes y calcular promedio
  const mesesNombre = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const sumaMes  = Array(12).fill(0);
  const countMes = Array(12).fill(0);

  envios?.forEach(e => {
    if (e.porcentaje == null || e.porcentaje === 100) return; // ignorar registros sin puntaje real
    const mes = new Date(e.created_at).getMonth(); // 0-11
    sumaMes[mes]  += e.porcentaje;
    countMes[mes] += 1;
  });

  const promedios = sumaMes.map((s, i) => countMes[i] > 0 ? parseFloat((s / countMes[i]).toFixed(1)) : null);
  const promedioGlobal = promedios.filter(v => v !== null);
  const promedioAnual  = promedioGlobal.length
    ? (promedioGlobal.reduce((a, b) => a + b, 0) / promedioGlobal.length).toFixed(1)
    : null;

  document.getElementById('sat-promedio').textContent = promedioAnual
    ? `Promedio anual: ${promedioAnual}%`
    : 'Sin datos para este año';

  const ctx = document.getElementById('grafica-satisfaccion').getContext('2d');
  if (graficaSatisfaccionChart) graficaSatisfaccionChart.destroy();

  graficaSatisfaccionChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: mesesNombre,
      datasets: [{
        label: `Satisfacción % — ${anio}`,
        data: promedios,
        borderColor: '#002855',
        backgroundColor: 'rgba(0,40,85,0.08)',
        borderWidth: 2,
        pointRadius: 5,
        pointBackgroundColor: '#002855',
        tension: 0.3,
        spanGaps: true
      }, {
        label: 'Meta (80%)',
        data: Array(12).fill(80),
        borderColor: '#28a745',
        borderDash: [6, 4],
        borderWidth: 1.5,
        pointRadius: 0,
        tension: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { min: 0, max: 100, ticks: { callback: v => v + '%' } }
      },
      plugins: {
        tooltip: { callbacks: { label: ctx => ctx.parsed.y !== null ? ctx.parsed.y + '%' : 'Sin datos' } }
      }
    }
  });
};

// ── 1. Estado mensual ──
window.cargarDashboardMes = async function () {
  const mes  = parseInt(document.getElementById('dash-mes')?.value  || (new Date().getMonth() + 1));
  const anio = parseInt(document.getElementById('dash-anio')?.value || new Date().getFullYear());
  // Rango en hora Perú (UTC-5): medianoche Lima = 05:00 UTC
  const desde = new Date(Date.UTC(anio, mes - 1, 1, 5, 0, 0)).toISOString();
  const hasta = new Date(Date.UTC(anio, mes,     1, 5, 0, 0)).toISOString();

  // Usar asignaciones del mes si existen, sino todos los activos
  const { data: asignaciones } = await supabase
    .from('asignaciones_mes')
    .select('usuario_email, documento_numero')
    .eq('empresa_id', empresaAdminId)
    .eq('mes', mes)
    .eq('anio', anio);

  let trabajadores, emails, fuenteLabel;

  if (asignaciones?.length) {
    // Usar lista de asignados
    emails = asignaciones.map(a => a.usuario_email).filter(Boolean);
    const { data: perfs } = await supabase
      .from('profiles')
      .select('id, nombres, apellidos, documento_numero, cargo, email')
      .in('email', emails);
    trabajadores = perfs || [];
    fuenteLabel  = `📋 Lista asignada (${asignaciones.length} trabajadores)`;
  } else {
    // Fallback: todos los activos de la empresa
    const { data: todos } = await supabase
      .from('profiles')
      .select('id, nombres, apellidos, documento_numero, cargo, email')
      .eq('empresa_id', empresaAdminId)
      .eq('rol', 'trabajador')
      .eq('activo', true);
    trabajadores = todos || [];
    emails = trabajadores.map(t => t.email);
    fuenteLabel = `👥 Todos los activos (sin lista asignada)`;
  }

  if (!trabajadores.length) {
    document.getElementById('cards-mes').innerHTML = '<p style="color:#888;">No hay trabajadores para este mes.</p>';
    return;
  }

  const { data: enviosMes } = await supabase
    .from('envios_formulario')
    .select('usuario_email, aprobado')
    .in('usuario_email', emails)
    .eq('estado', 'completado')
    .gte('created_at', desde)
    .lt('created_at', hasta);

  const correosConActividad = new Set(enviosMes?.map(n => n.usuario_email) || []);
  const aprobados = new Set(enviosMes?.filter(n => n.aprobado).map(n => n.usuario_email) || []);
  const conActividad = correosConActividad.size;
  const sinActividad = trabajadores.length - conActividad;
  const pct = Math.round((conActividad / trabajadores.length) * 100);

  const cards = document.getElementById('cards-mes');
  cards.innerHTML = `
    <div style="grid-column:1/-1; font-size:0.8rem; color:#888; margin-bottom:4px;">${fuenteLabel}</div>
    <div class="stat-card">
      <div class="stat-num">${trabajadores.length}</div>
      <div class="stat-label">Asignados al mes</div>
    </div>
    <div class="stat-card verde">
      <div class="stat-num">${conActividad}</div>
      <div class="stat-label">Han rendido este mes</div>
    </div>
    <div class="stat-card naranja">
      <div class="stat-num">${sinActividad}</div>
      <div class="stat-label">Sin actividad este mes</div>
    </div>
    <div class="stat-card verde">
      <div class="stat-num">${aprobados.size}</div>
      <div class="stat-label">Aprobaron examen (≥16)</div>
    </div>
    <div class="stat-card">
      <div class="stat-num">${pct}%</div>
      <div class="stat-label">Participación mensual</div>
    </div>
  `;

  // Tabla de sin actividad
  const sinAct = trabajadores.filter(t => !correosConActividad.has(t.email));
  const tbody = document.getElementById('tbody-sin-actividad');
  tbody.innerHTML = '';
  sinAct.forEach(t => {
    tbody.innerHTML += `<tr>
      <td>${t.apellidos || ''} ${t.nombres || ''}</td>
      <td>${t.documento_numero || ''}</td>
      <td>${t.cargo || ''}</td>
    </tr>`;
  });
  document.getElementById('detalle-pendientes').style.display = sinAct.length ? 'block' : 'none';
};

// ── 2. Buscador por trabajador ──
let todosTrabajadoresDash = [];
let todosCursosDash = [];

async function cargarDatosDashboard() {
  if (todosTrabajadoresDash.length) return;
  const [{ data: trabajadores }, { data: cursos }] = await Promise.all([
    supabase.from('profiles').select('id, nombres, apellidos, email, documento_numero, cargo')
      .eq('empresa_id', empresaAdminId).eq('rol', 'trabajador').eq('activo', true).order('apellidos'),
    supabase.from('cursos').select('id, titulo').eq('activo', true)
  ]);
  todosTrabajadoresDash = trabajadores || [];
  todosCursosDash = cursos || [];

  const sel = document.getElementById('select-curso-dashboard');
  todosCursosDash.forEach(c => {
    sel.innerHTML += `<option value="${c.id}">${c.titulo}</option>`;
  });
  initSelectBuscable('select-curso-dashboard');
}

window.buscarTrabajadorDashboard = function () {
  const texto = document.getElementById('buscar-trabajador').value.toLowerCase().trim();
  const lista = document.getElementById('lista-sugerencias');
  document.getElementById('resultado-trabajador').style.display = 'none';

  if (!texto || texto.length < 2) { lista.innerHTML = ''; return; }

  cargarDatosDashboard().then(() => {
    const coinciden = todosTrabajadoresDash.filter(t =>
      (t.nombres || '').toLowerCase().includes(texto) ||
      (t.apellidos || '').toLowerCase().includes(texto) ||
      (t.documento_numero || '').includes(texto)
    ).slice(0, 8);

    if (!coinciden.length) {
      lista.innerHTML = '<div style="color:#888; font-size:0.85rem; padding:8px;">No se encontraron trabajadores.</div>';
      return;
    }

    lista.innerHTML = `<div style="border:1px solid #e0e0e0; border-radius:8px; overflow:hidden; max-width:500px;">
      ${coinciden.map(t => `
        <div class="sugerencia-item" onclick="verCursosTrabajador('${t.email}')">
          <strong>${t.apellidos} ${t.nombres}</strong>
          <span style="color:#888; margin-left:8px; font-size:0.8rem;">${t.documento_numero || ''} · ${t.cargo || ''}</span>
        </div>`).join('')}
    </div>`;
  });
};

window.verCursosTrabajador = async function (email) {
  document.getElementById('lista-sugerencias').innerHTML = '';
  document.getElementById('buscar-trabajador').value = '';

  await cargarDatosDashboard();
  const trabajador = todosTrabajadoresDash.find(t => t.email === email);
  if (!trabajador) return;

  const { data: todosFormularios } = await supabase
    .from('formularios').select('id, tipo');
  const tipoFormMap = {};
  todosFormularios?.forEach(f => { tipoFormMap[f.id] = f.tipo; });

  const { data: envios } = await supabase
    .from('envios_formulario')
    .select('id_curso, id_formulario, puntaje, created_at')
    .eq('usuario_email', email)
    .eq('estado', 'completado')
    .order('created_at', { ascending: false });

  // Guardar el resultado más reciente del examen por curso
  const notasMap = {};
  envios?.filter(n => tipoFormMap[n.id_formulario] === 'examen')
         .forEach(n => {
           if (!notasMap[n.id_curso]) // solo el más reciente
             notasMap[n.id_curso] = { puntaje: n.puntaje, fecha: n.created_at };
         });

  const UN_ANIO_MS = 365 * 24 * 60 * 60 * 1000;
  const ahora = Date.now();

  const vigentes   = todosCursosDash.filter(c => notasMap[c.id] && (ahora - new Date(notasMap[c.id].fecha).getTime()) < UN_ANIO_MS);
  const vencidos   = todosCursosDash.filter(c => notasMap[c.id] && (ahora - new Date(notasMap[c.id].fecha).getTime()) >= UN_ANIO_MS);
  const pendientes = todosCursosDash.filter(c => !notasMap[c.id]);

  document.getElementById('trabajador-inicial').textContent =
    (trabajador.apellidos || '?')[0].toUpperCase();
  document.getElementById('trabajador-nombre').textContent =
    `${trabajador.apellidos} ${trabajador.nombres}`;
  document.getElementById('trabajador-info').textContent =
    `${trabajador.documento_numero || ''} · ${trabajador.cargo || ''}`;

  const renderCurso = c => {
    const info = notasMap[c.id];
    const cls  = info.puntaje >= 16 ? 'aprobado' : 'desaprobado';
    const fecha = new Date(info.fecha).toLocaleDateString('es-PE');
    return `<div class="curso-item ${cls}">
      <span>${c.titulo}</span>
      <div style="font-size:0.75rem; color:#666;">${fecha}</div>
      <strong>${info.puntaje}/20</strong>
    </div>`;
  };

  document.getElementById('cursos-vigentes').innerHTML  = vigentes.length  ? vigentes.map(renderCurso).join('')  : '<div style="color:#888; font-size:0.83rem;">Ninguno</div>';
  document.getElementById('cursos-vencidos').innerHTML  = vencidos.length  ? vencidos.map(renderCurso).join('')  : '<div style="color:#888; font-size:0.83rem;">Ninguno</div>';
  document.getElementById('cursos-pendientes').innerHTML = pendientes.length ? pendientes.map(c => `<div class="curso-item pendiente">${c.titulo}</div>`).join('') : '<div style="color:#28a745; font-size:0.83rem;">¡Todos completados!</div>';

  document.getElementById('resultado-trabajador').style.display = 'block';
};

// ── 3. Estado por curso ──
window.cargarEstadoCurso = async function () {
  const cursoId = parseInt(document.getElementById('select-curso-dashboard').value);
  if (!cursoId) { alert('Selecciona un curso.'); return; }

  await cargarDatosDashboard();

  const { data: todosFormularios } = await supabase
    .from('formularios').select('id, tipo');
  const tipoFormMap = {};
  todosFormularios?.forEach(f => { tipoFormMap[f.id] = f.tipo; });

  const emails = todosTrabajadoresDash.map(t => t.email);
  const { data: envios } = await supabase
    .from('envios_formulario')
    .select('usuario_email, id_formulario, puntaje')
    .eq('id_curso', cursoId)
    .in('usuario_email', emails)
    .eq('estado', 'completado');

  const notasMap = {};
  envios?.filter(n => tipoFormMap[n.id_formulario] === 'examen')
         .forEach(n => { notasMap[n.usuario_email] = n.puntaje; });

  const aprobados     = todosTrabajadoresDash.filter(t => notasMap[t.email] !== undefined && notasMap[t.email] >= 16);
  const desaprobados  = todosTrabajadoresDash.filter(t => notasMap[t.email] !== undefined && notasMap[t.email] < 16);
  const pendientes    = todosTrabajadoresDash.filter(t => notasMap[t.email] === undefined);
  const total         = todosTrabajadoresDash.length;

  document.getElementById('cards-curso').innerHTML = `
    <div class="stat-card verde">
      <div class="stat-num">${aprobados.length}</div>
      <div class="stat-label">Aprobados (${Math.round(aprobados.length/total*100)}%)</div>
    </div>
    <div class="stat-card rojo">
      <div class="stat-num">${desaprobados.length}</div>
      <div class="stat-label">Desaprobados</div>
    </div>
    <div class="stat-card naranja">
      <div class="stat-num">${pendientes.length}</div>
      <div class="stat-label">No han rendido</div>
    </div>
    <div class="stat-card">
      <div class="stat-num">${total}</div>
      <div class="stat-label">Total trabajadores</div>
    </div>
  `;

  const fmt = lista => lista.length
    ? lista.map(t => `<div class="trabajador-item">${t.apellidos} ${t.nombres}${notasMap[t.email] !== undefined ? ` <strong>(${notasMap[t.email]}/20)</strong>` : ''}</div>`).join('')
    : '<div style="color:#888; font-size:0.83rem;">Ninguno</div>';

  document.getElementById('lista-aprobados-curso').innerHTML    = fmt(aprobados);
  document.getElementById('lista-desaprobados-curso').innerHTML = fmt(desaprobados);
  document.getElementById('lista-pendientes-curso').innerHTML   = fmt(pendientes);
  document.getElementById('stats-curso').style.display = 'block';
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
    .from('cursos').select('id, titulo, duracion, activo').order('titulo');

  if (errCursos) {
    contenedor.innerHTML = `<p style="color:red;">❌ Error: ${errCursos.message}</p>`;
    return;
  }
  if (!cursos?.length) {
    contenedor.innerHTML = '<p style="color:#888;">No hay cursos registrados.</p>';
    return;
  }

  const activos   = cursos.filter(c => c.activo);
  const inactivos = cursos.filter(c => !c.activo);

  const renderFila = c => `
    <tr>
      <td style="padding:10px 12px; font-weight:500;">${c.titulo}</td>
      <td style="padding:10px 12px; color:#888; font-size:0.82rem;">${c.duracion ? c.duracion + 'h' : '—'}</td>
      <td style="padding:10px 12px;">
        <span class="${c.activo ? 'badge-activo' : 'badge-inactivo'}">${c.activo ? '✅ Activo' : '⏸ Inactivo'}</span>
      </td>
      <td style="padding:10px 12px;">
        <button onclick="toggleActivoCurso('${c.id}', ${c.activo})"
                style="padding:6px 14px; border:none; border-radius:6px; cursor:pointer; font-size:0.82rem;
                       background:${c.activo ? '#dc3545' : '#198754'}; color:white;">
          ${c.activo ? 'Desactivar' : 'Activar'}
        </button>
      </td>
    </tr>`;

  contenedor.innerHTML = `
    <table style="width:100%; border-collapse:collapse;">
      <thead>
        <tr style="background:#f8f9fa; font-size:0.82rem; color:#555; text-transform:uppercase; letter-spacing:0.5px;">
          <th style="padding:8px 12px; text-align:left;">Curso</th>
          <th style="padding:8px 12px; text-align:left;">Duración</th>
          <th style="padding:8px 12px; text-align:left;">Estado</th>
          <th style="padding:8px 12px; text-align:left;">Acción</th>
        </tr>
      </thead>
      <tbody>
        ${activos.map(renderFila).join('')}
        ${inactivos.length ? `
          <tr><td colspan="5" style="padding:8px 12px; font-size:0.78rem; color:#888; background:#f8f9fa; border-top:2px solid #eee;">
            ── Inactivos ──
          </td></tr>
          ${inactivos.map(renderFila).join('')}
        ` : ''}
      </tbody>
    </table>`;
};

window.toggleActivoCurso = async function (id, activo) {
  const { error } = await supabase.from('cursos').update({ activo: !activo }).eq('id', id);
  if (error) { alert('❌ ' + error.message); return; }
  cargarListaCursos();
};

// ═══════════════════════════════════════════════
// 📝 GESTIÓN DE FORMULARIOS (EXAMEN / EFICACIA)
// ═══════════════════════════════════════════════

window.initSelectCursoForm = async function initSelectCursoForm() {
  const sel = document.getElementById('select-curso-form');
  if (!sel || sel.options.length > 1) return;
  const { data } = await supabase.from('cursos').select('id, titulo').eq('activo', true).order('titulo');
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
    const label = tipo === 'examen' ? '📝 Examen' : '✅ Eficacia';
    const color = tipo === 'examen' ? '#002855' : '#28a745';
    const bloque = document.createElement('div');
    bloque.style.cssText = 'border:1px solid #e0e0e0;border-radius:10px;padding:16px;margin-bottom:16px;';

    if (!form) {
      bloque.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <h3 style="margin:0;color:${color};">${label}</h3>
          <button onclick="crearFormulario(${cursoId},'${tipo}')" class="btn-primary" style="font-size:0.85rem;">+ Crear ${tipo}</button>
        </div>
        <p style="color:#888;font-size:0.85rem;margin-top:8px;">No existe aún para este curso.</p>`;
    } else {
      bloque.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <h3 style="margin:0;color:${color};">${label}</h3>
          <button onclick="mostrarFormPregunta(${form.id},'${tipo}')" class="btn-primary" style="font-size:0.85rem;">+ Nueva pregunta</button>
        </div>
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
  const label = tipo === 'examen' ? 'Examen' : 'Eficacia';
  const { error } = await supabase.from('formularios').insert([{ tipo, titulo: label, id_curso: cursoId, activo: true }]);
  if (error) { alert('❌ ' + error.message); return; }
  cargarFormulariosCurso();
};

window.mostrarFormPregunta = function (formularioId, tipo) {
  const div = document.getElementById(`form-nueva-pregunta-${formularioId}`);
  if (div) { div.style.display = 'block'; document.getElementById(`txt-pregunta-${formularioId}`).focus(); }
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
    // Buscar hoja ANTAMINA o la primera hoja
    const nombreHoja = wb.SheetNames.find(n => n.toUpperCase().includes('ANTAMINA')) || wb.SheetNames[0];
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

  // Eliminar programa anterior del mismo año para esta empresa
  await supabase.from('programa_capacitaciones')
    .delete()
    .eq('empresa_id', empresaAdminId)
    .eq('anio', anio)
    .eq('sede', 'ANTAMINA');

  const registros = filasProgramaSST.map(f => ({
    ...f,
    empresa_id: empresaAdminId,
    sede: 'ANTAMINA',
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

window.verProgramaSST = async function () {
  const anio = parseInt(document.getElementById('ver-sst-anio').value);
  const tipo  = document.getElementById('ver-sst-tipo').value;
  const cont  = document.getElementById('lista-programa-sst');
  cont.innerHTML = '<p style="color:#888;">Cargando...</p>';

  let query = supabase.from('programa_capacitaciones')
    .select('*')
    .eq('empresa_id', empresaAdminId)
    .eq('anio', anio)
    .eq('sede', 'ANTAMINA')
    .order('numero');

  if (tipo) query = query.eq('tipo_curso', tipo);

  const { data, error } = await query;
  if (error || !data?.length) {
    cont.innerHTML = '<p style="color:#888;">No hay programa guardado para este año.</p>';
    return;
  }

  const mesesNom = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const mesesKey = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];

  const filas = data.map(f => {
    const mesesCeldas = mesesKey.map(m => `<td style="text-align:center;">${f[m] ? '✔' : ''}</td>`).join('');
    return `<tr style="border-bottom:1px solid #eee;">
      <td style="padding:7px 10px;">${f.requisito || ''}</td>
      <td style="padding:7px 10px;">${f.numero ?? ''}</td>
      <td style="padding:7px 10px;font-weight:500;">${f.curso}</td>
      <td style="padding:7px 10px;">${f.tipo_curso || ''}</td>
      <td style="padding:7px 10px;">${f.encargado || ''}</td>
      <td style="padding:7px 10px;text-align:center;">${f.duracion_hr ?? ''}</td>
      ${mesesCeldas}
    </tr>`;
  }).join('');

  cont.innerHTML = `
    <p style="font-size:0.85rem;color:#555;margin-bottom:10px;">${data.length} cursos — Año ${anio} · ANTAMINA</p>
    <div style="overflow-x:auto;">
      <table style="border-collapse:collapse;width:100%;font-size:0.8rem;min-width:900px;">
        <thead><tr style="background:#002855;color:white;">
          <th style="padding:8px 10px;text-align:left;">Requisito</th>
          <th style="padding:8px 10px;">N°</th>
          <th style="padding:8px 10px;text-align:left;">Curso</th>
          <th style="padding:8px 10px;text-align:left;">Tipo</th>
          <th style="padding:8px 10px;text-align:left;">Encargado</th>
          <th style="padding:8px 10px;">Hr</th>
          ${mesesNom.map(m => `<th style="padding:8px 6px;">${m}</th>`).join('')}
        </tr></thead>
        <tbody>${filas}</tbody>
      </table>
    </div>`;
};

window.eliminarProgramaSST = async function () {
  const anio = parseInt(document.getElementById('ver-sst-anio').value);
  if (!await showConfirm(`¿Eliminar todo el programa SST del año ${anio} para ANTAMINA?\nEsta acción no se puede deshacer.`, { confirmText: 'Eliminar' })) return;
  const { error } = await supabase.from('programa_capacitaciones')
    .delete()
    .eq('empresa_id', empresaAdminId)
    .eq('anio', anio)
    .eq('sede', 'ANTAMINA');
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
    'ANEXO 6 DS 023-2017 EM', 1, 'Trabajos en altura', 'ANTAMINA', 'RRHH/SEMAS',
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
  XLSX.utils.book_append_sheet(wb, ws, 'ANTAMINA');
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
    .eq('sede', 'ANTAMINA')
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
    .eq('mes', mes);

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
    anio, mes, sede: 'ANTAMINA',
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
// ✅ CUMPLIMIENTO DE CERTIFICADOS
// ═══════════════════════════════════════════════

let datosCumplimiento = [];

window.initCumplimiento = async function () {
  // Poblar selector de cursos
  const { data: cursos } = await supabase.from('cursos').select('id, titulo').eq('activo', true).order('titulo');
  const sel = document.getElementById('select-curso-cumpl');
  if (sel) {
    sel.innerHTML = '<option value="">-- Selecciona un curso --</option>';
    (cursos || []).forEach(c => {
      sel.insertAdjacentHTML('beforeend', `<option value="${c.id}">${c.titulo}</option>`);
    });
    initSelectBuscable('select-curso-cumpl');
  }
  await cargarResumenCumplimiento();
};

async function cargarResumenCumplimiento() {
  if (!empresaAdminId) return;

  const [{ data: workers }, { data: cursos }] = await Promise.all([
    supabase.from('profiles').select('id, nombres, apellidos, email, documento_numero, cargo').eq('empresa_id', empresaAdminId).eq('activo', true).order('apellidos'),
    supabase.from('cursos').select('id, titulo, vigencia_meses').eq('activo', true),
  ]);

  if (!workers?.length || !cursos?.length) {
    document.getElementById('cumpl-kpis').innerHTML = '<p style="color:#888;">No hay datos suficientes.</p>';
    document.getElementById('tabla-por-vencer').innerHTML = '';
    return;
  }

  const emails = workers.map(w => w.email);
  const { data: envios } = await supabase
    .from('envios_formulario')
    .select('usuario_email, id_curso, created_at, formularios(tipo)')
    .in('usuario_email', emails)
    .eq('aprobado', true);

  // Solo tipo examen, más reciente por worker+curso
  const lastSub = {};
  (envios || []).filter(e => e.formularios?.tipo === 'examen').forEach(e => {
    const key = `${e.usuario_email}__${e.id_curso}`;
    if (!lastSub[key] || new Date(e.created_at) > new Date(lastSub[key].created_at)) {
      lastSub[key] = e;
    }
  });

  const now   = new Date();
  const in30  = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  datosCumplimiento = [];
  workers.forEach(w => {
    cursos.forEach(c => {
      const sub = lastSub[`${w.email}__${c.id}`];
      if (!sub) {
        datosCumplimiento.push({ worker: w, curso: c, estado: 'Pendiente', fecha_emision: null, fecha_vencimiento: null });
      } else {
        const emision     = new Date(sub.created_at);
        const vencimiento = new Date(emision);
        vencimiento.setMonth(vencimiento.getMonth() + (c.vigencia_meses || 12));
        const estado = vencimiento < now ? 'Vencido' : vencimiento < in30 ? 'Por vencer' : 'Vigente';
        datosCumplimiento.push({ worker: w, curso: c, estado, fecha_emision: emision, fecha_vencimiento: vencimiento });
      }
    });
  });

  // KPIs
  const vigentes   = datosCumplimiento.filter(d => d.estado === 'Vigente').length;
  const porVencer  = datosCumplimiento.filter(d => d.estado === 'Por vencer').length;
  const vencidos   = datosCumplimiento.filter(d => d.estado === 'Vencido').length;
  const pendientes = datosCumplimiento.filter(d => d.estado === 'Pendiente').length;
  const total      = datosCumplimiento.length;
  const pct        = total > 0 ? Math.round((vigentes + porVencer) / total * 100) : 0;

  document.getElementById('cumpl-kpis').innerHTML = [
    ['Cumplimiento', `${pct}%`,  pct >= 80 ? '#198754' : pct >= 50 ? '#fd7e14' : '#dc3545'],
    ['Vigentes',     vigentes,   '#198754'],
    ['Por vencer',   porVencer,  '#fd7e14'],
    ['Vencidos',     vencidos,   '#dc3545'],
    ['Pendientes',   pendientes, '#6c757d'],
  ].map(([label, val, color]) => `
    <div style="background:#f8f9fa;border-radius:10px;padding:14px 20px;min-width:120px;text-align:center;border-top:4px solid ${color};">
      <div style="font-size:1.5rem;font-weight:700;color:${color};">${val}</div>
      <div style="font-size:0.78rem;color:#555;margin-top:4px;">${label}</div>
    </div>`).join('');

  // Tabla por vencer / vencidos
  const alertas = datosCumplimiento.filter(d => d.estado === 'Por vencer' || d.estado === 'Vencido')
    .sort((a, b) => (a.fecha_vencimiento || 0) - (b.fecha_vencimiento || 0));

  if (!alertas.length) {
    document.getElementById('tabla-por-vencer').innerHTML =
      '<p style="color:#198754;font-weight:600;">✅ No hay certificados por vencer en los próximos 30 días.</p>';
    return;
  }

  const colAlert = { 'Vencido': '#dc3545', 'Por vencer': '#fd7e14' };
  document.getElementById('tabla-por-vencer').innerHTML = `
    <div style="overflow-x:auto;">
      <table style="border-collapse:collapse;width:100%;font-size:0.85rem;">
        <thead><tr style="background:#002855;color:white;">
          <th style="padding:8px 10px;text-align:left;">Trabajador</th>
          <th style="padding:8px 10px;">Documento</th>
          <th style="padding:8px 10px;">Cargo</th>
          <th style="padding:8px 10px;text-align:left;">Curso</th>
          <th style="padding:8px 10px;">Emisión</th>
          <th style="padding:8px 10px;">Vencimiento</th>
          <th style="padding:8px 10px;">Estado</th>
        </tr></thead>
        <tbody>
          ${alertas.map(d => `
            <tr style="border-bottom:1px solid #eee;">
              <td style="padding:7px 10px;font-weight:500;">${d.worker.apellidos}, ${d.worker.nombres}</td>
              <td style="padding:7px 10px;">${d.worker.documento_numero}</td>
              <td style="padding:7px 10px;">${d.worker.cargo || ''}</td>
              <td style="padding:7px 10px;">${d.curso.titulo}</td>
              <td style="padding:7px 10px;">${d.fecha_emision?.toLocaleDateString('es-PE') || '—'}</td>
              <td style="padding:7px 10px;color:${colAlert[d.estado]};font-weight:600;">${d.fecha_vencimiento?.toLocaleDateString('es-PE') || '—'}</td>
              <td style="padding:7px 10px;"><span style="background:${colAlert[d.estado]};color:white;padding:3px 8px;border-radius:10px;font-size:0.78rem;">${d.estado}</span></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

window.cargarCumplimientoCurso = async function () {
  const cursoId = document.getElementById('select-curso-cumpl').value;
  if (!cursoId) { alert('Selecciona un curso.'); return; }
  if (!datosCumplimiento.length) { alert('Espera a que carguen los datos.'); return; }

  const datos = datosCumplimiento.filter(d => d.curso.id === cursoId);
  if (!datos.length) {
    document.getElementById('tabla-cumplimiento-curso').innerHTML = '<p style="color:#888;">Sin datos.</p>';
    return;
  }

  const colores = { 'Vigente': '#198754', 'Por vencer': '#fd7e14', 'Vencido': '#dc3545', 'Pendiente': '#6c757d' };
  const vigentes = datos.filter(d => d.estado === 'Vigente').length;
  const pct = Math.round(vigentes / datos.length * 100);

  document.getElementById('tabla-cumplimiento-curso').innerHTML = `
    <p style="font-size:0.85rem;color:#555;margin-bottom:10px;">
      <strong>${datos[0].curso.titulo}</strong> — Vigencia: ${datos[0].curso.vigencia_meses || 12} meses —
      <span style="color:#198754;font-weight:600;">${pct}% vigente</span> (${vigentes}/${datos.length} trabajadores)
    </p>
    <div style="overflow-x:auto;">
      <table style="border-collapse:collapse;width:100%;font-size:0.85rem;">
        <thead><tr style="background:#002855;color:white;">
          <th style="padding:8px 10px;text-align:left;">Trabajador</th>
          <th style="padding:8px 10px;">Documento</th>
          <th style="padding:8px 10px;">Cargo</th>
          <th style="padding:8px 10px;">Fecha emisión</th>
          <th style="padding:8px 10px;">Fecha vencimiento</th>
          <th style="padding:8px 10px;">Estado</th>
        </tr></thead>
        <tbody>
          ${datos.map(d => `
            <tr style="border-bottom:1px solid #eee;">
              <td style="padding:7px 10px;font-weight:500;">${d.worker.apellidos}, ${d.worker.nombres}</td>
              <td style="padding:7px 10px;">${d.worker.documento_numero}</td>
              <td style="padding:7px 10px;">${d.worker.cargo || ''}</td>
              <td style="padding:7px 10px;">${d.fecha_emision?.toLocaleDateString('es-PE') || '—'}</td>
              <td style="padding:7px 10px;">${d.fecha_vencimiento?.toLocaleDateString('es-PE') || '—'}</td>
              <td style="padding:7px 10px;"><span style="background:${colores[d.estado]};color:white;padding:3px 8px;border-radius:10px;font-size:0.78rem;">${d.estado}</span></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
};

window.enviarNotificaciones = async function () {
  if (!datosCumplimiento.length) { alert('Primero abre la pestaña Cumplimiento para cargar los datos.'); return; }

  const tipo = document.getElementById('tipo-notif').value;
  const cont = document.getElementById('preview-notificaciones');

  // Agrupar por trabajador según tipo
  const pendientes = datosCumplimiento.filter(d => d.estado === 'Pendiente');
  const alertas    = datosCumplimiento.filter(d => d.estado === 'Por vencer' || d.estado === 'Vencido');
  const seleccion  = tipo === 'pendientes' ? pendientes : tipo === 'vencimientos' ? alertas : [...pendientes, ...alertas];

  const porWorker = {};
  seleccion.forEach(d => {
    const key = d.worker.email;
    if (!porWorker[key]) porWorker[key] = { worker: d.worker, items: [] };
    porWorker[key].items.push({ curso: d.curso.titulo, estado: d.estado });
  });

  const lista = Object.values(porWorker);
  if (!lista.length) {
    cont.innerHTML = '<p style="color:#198754;">✅ No hay trabajadores que requieran notificación.</p>';
    return;
  }

  cont.innerHTML = `
    <p style="font-size:0.88rem;color:#555;margin-bottom:10px;">
      Se enviarán notificaciones a <strong>${lista.length}</strong> trabajadores:
    </p>
    <ul style="font-size:0.84rem;color:#444;padding-left:18px;margin-bottom:14px;">
      ${lista.slice(0, 8).map(t => `<li>${t.worker.nombres} ${t.worker.apellidos} — ${t.items.length} curso(s)</li>`).join('')}
      ${lista.length > 8 ? `<li style="color:#888;">...y ${lista.length - 8} más</li>` : ''}
    </ul>
    <span id="progreso-notif" style="font-size:0.88rem;color:#555;">Enviando...</span>`;

  try {
    const { data: { session } } = await supabase.auth.getSession();
    const resp = await fetch(
      'https://wrahjlstautwinxyqcfx.supabase.co/functions/v1/enviar-notificaciones',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ empresa_id: empresaAdminId, tipo, empresa_nombre: empresaAdminNombre }),
      }
    );
    const result = await resp.json();
    document.getElementById('progreso-notif').textContent =
      result.ok ? `✅ ${result.enviados} correos enviados correctamente.` : `❌ Error: ${result.error}`;
  } catch {
    document.getElementById('progreso-notif').textContent =
      '❌ Función de notificaciones no desplegada aún. Sigue las instrucciones para activarla.';
  }
};

window.exportarCumplimientoExcel = function () {
  if (!datosCumplimiento.length) { alert('Primero abre la pestaña Cumplimiento para cargar los datos.'); return; }
  const XLSX = window.XLSX;

  const workers = [...new Map(datosCumplimiento.map(d => [d.worker.email, d.worker])).values()];
  const cursos  = [...new Map(datosCumplimiento.map(d => [d.curso.id,    d.curso])).values()];

  const header = ['Apellidos', 'Nombres', 'Documento', 'Cargo', ...cursos.map(c => c.titulo)];
  const rows = workers.map(w => {
    const celdas = cursos.map(c => {
      const d = datosCumplimiento.find(x => x.worker.email === w.email && x.curso.id === c.id);
      return d ? d.estado : 'Pendiente';
    });
    return [w.apellidos, w.nombres, w.documento_numero, w.cargo || '', ...celdas];
  });

  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  ws['!cols'] = [20, 20, 15, 20, ...cursos.map(() => ({ wch: 14 }))].map(w => typeof w === 'number' ? { wch: w } : w);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Cumplimiento');
  XLSX.writeFile(wb, `Matriz_Cumplimiento_${new Date().getFullYear()}.xlsx`);
};

// ═══════════════════════════════════════════════
// 🗺️ RUTAS DE APRENDIZAJE
// ═══════════════════════════════════════════════

let rutaActualId = null;

window.initRutas = async function () {
  const [{ data: cargos }, { data: cursos }, { data: rutas }] = await Promise.all([
    supabase.from('cargos').select('id, nombre').eq('activo', true).order('nombre'),
    supabase.from('cursos').select('id, titulo').eq('activo', true).order('titulo'),
    supabase.from('rutas_aprendizaje').select('id, nombre, cargos(nombre)').eq('empresa_id', empresaAdminId).order('nombre'),
  ]);

  // Selector cargo
  const selCargo = document.getElementById('ruta-cargo');
  selCargo.innerHTML = '<option value="">-- Selecciona un cargo --</option>';
  (cargos || []).forEach(c => selCargo.insertAdjacentHTML('beforeend', `<option value="${c.id}">${c.nombre}</option>`));

  // Selector cursos para agregar
  const selCurso = document.getElementById('ruta-add-curso');
  selCurso.innerHTML = '<option value="">-- Agregar curso --</option>';
  (cursos || []).forEach(c => selCurso.insertAdjacentHTML('beforeend', `<option value="${c.id}">${c.titulo}</option>`));
  initSelectBuscable('ruta-add-curso');

  // Selector rutas (ver y progreso)
  const rutaOpts = (rutas || []).map(r => `<option value="${r.id}">${r.nombre} (${r.cargos?.nombre || 'sin cargo'})</option>`).join('');
  ['sel-ruta-ver', 'sel-ruta-progreso'].forEach(id => {
    const sel = document.getElementById(id);
    sel.innerHTML = '<option value="">-- Selecciona una ruta --</option>' + rutaOpts;
  });
};

window.crearRuta = async function () {
  const cargoId = document.getElementById('ruta-cargo').value;
  const nombre  = document.getElementById('ruta-nombre').value.trim();
  if (!nombre) { alert('Escribe un nombre para la ruta.'); return; }

  const { error } = await supabase.from('rutas_aprendizaje').insert({
    empresa_id: empresaAdminId,
    cargo_id: cargoId || null,
    nombre,
  });

  if (error) { alert('❌ ' + error.message); return; }
  alert('✅ Ruta creada.');
  document.getElementById('ruta-nombre').value = '';
  initRutas();
};

window.cargarRuta = async function () {
  const rutaId = document.getElementById('sel-ruta-ver').value;
  if (!rutaId) return;
  rutaActualId = rutaId;

  const { data: cursos } = await supabase
    .from('ruta_cursos')
    .select('id, orden, obligatorio, cursos(id, titulo)')
    .eq('ruta_id', rutaId)
    .order('orden');

  document.getElementById('panel-ruta').style.display = 'block';

  if (!cursos?.length) {
    document.getElementById('lista-cursos-ruta').innerHTML =
      '<p style="color:#888;font-size:0.88rem;">No hay cursos en esta ruta. Agrega el primero.</p>';
    return;
  }

  document.getElementById('lista-cursos-ruta').innerHTML = `
    <table style="border-collapse:collapse;width:100%;font-size:0.88rem;">
      <thead><tr style="background:#002855;color:white;">
        <th style="padding:8px 10px;">Orden</th>
        <th style="padding:8px 10px;text-align:left;">Curso</th>
        <th style="padding:8px 10px;">Obligatorio</th>
        <th style="padding:8px 10px;">Acción</th>
      </tr></thead>
      <tbody>
        ${cursos.map(c => `
          <tr style="border-bottom:1px solid #eee;">
            <td style="padding:7px 10px;text-align:center;font-weight:700;color:#002855;">${c.orden}</td>
            <td style="padding:7px 10px;">${c.cursos?.titulo || ''}</td>
            <td style="padding:7px 10px;text-align:center;">${c.obligatorio ? '✅' : '—'}</td>
            <td style="padding:7px 10px;text-align:center;">
              <button onclick="eliminarCursoRuta('${c.id}')" style="background:#dc3545;color:white;border:none;padding:4px 10px;border-radius:5px;cursor:pointer;font-size:0.8rem;">Quitar</button>
            </td>
          </tr>`).join('')}
      </tbody>
    </table>`;
};

window.agregarCursoRuta = async function () {
  if (!rutaActualId) { alert('Selecciona una ruta primero.'); return; }
  const cursoId    = document.getElementById('ruta-add-curso').value;
  const orden      = parseInt(document.getElementById('ruta-add-orden').value);
  const obligatorio= document.getElementById('ruta-obligatorio').checked;
  if (!cursoId) { alert('Selecciona un curso.'); return; }

  const { error } = await supabase.from('ruta_cursos').insert({
    ruta_id: rutaActualId, curso_id: cursoId, orden, obligatorio,
  });
  if (error) { alert('❌ ' + error.message); return; }
  cargarRuta();
};

window.eliminarCursoRuta = async function (id) {
  if (!await showConfirm('¿Quitar este curso de la ruta?', { confirmText: 'Quitar' })) return;
  await supabase.from('ruta_cursos').delete().eq('id', id);
  cargarRuta();
};

window.cargarProgresoRuta = async function () {
  const rutaId = document.getElementById('sel-ruta-progreso').value;
  if (!rutaId) return;
  const cont = document.getElementById('tabla-progreso-ruta');
  cont.innerHTML = '<p style="color:#888;">Cargando...</p>';

  const [{ data: rutaCursos }, { data: workers }] = await Promise.all([
    supabase.from('ruta_cursos').select('orden, obligatorio, cursos(id, titulo, vigencia_meses)').eq('ruta_id', rutaId).order('orden'),
    supabase.from('profiles').select('id, nombres, apellidos, email, documento_numero, cargo').eq('empresa_id', empresaAdminId).eq('activo', true).order('apellidos'),
  ]);

  if (!rutaCursos?.length || !workers?.length) {
    cont.innerHTML = '<p style="color:#888;">Sin datos suficientes.</p>';
    return;
  }

  const emails = workers.map(w => w.email);
  const { data: envios } = await supabase
    .from('envios_formulario')
    .select('usuario_email, id_curso, created_at, formularios(tipo)')
    .in('usuario_email', emails)
    .eq('aprobado', true);

  const lastSub = {};
  (envios || []).filter(e => e.formularios?.tipo === 'examen').forEach(e => {
    const key = `${e.usuario_email}__${e.id_curso}`;
    if (!lastSub[key] || new Date(e.created_at) > new Date(lastSub[key].created_at)) lastSub[key] = e;
  });

  const now = new Date();
  const cursos = rutaCursos.map(rc => rc.cursos);

  const headerCursos = cursos.map(c => `<th style="padding:8px 6px;font-size:0.78rem;max-width:100px;">${c?.titulo || ''}</th>`).join('');

  const filas = workers.map(w => {
    let completados = 0;
    const celdas = cursos.map(c => {
      const sub = lastSub[`${w.email}__${c?.id}`];
      if (!sub) return `<td style="padding:6px;text-align:center;color:#aaa;">—</td>`;
      const venc = new Date(sub.created_at);
      venc.setMonth(venc.getMonth() + (c?.vigencia_meses || 12));
      const vigente = venc > now;
      if (vigente) completados++;
      return `<td style="padding:6px;text-align:center;">
        <span style="background:${vigente ? '#198754' : '#dc3545'};color:white;padding:2px 7px;border-radius:8px;font-size:0.75rem;">
          ${vigente ? '✓' : 'Venc.'}
        </span>
      </td>`;
    });
    const pct = Math.round(completados / cursos.length * 100);
    const barColor = pct === 100 ? '#198754' : pct >= 50 ? '#fd7e14' : '#dc3545';
    return `<tr style="border-bottom:1px solid #eee;">
      <td style="padding:7px 10px;font-weight:500;white-space:nowrap;">${w.apellidos}, ${w.nombres}</td>
      <td style="padding:7px 10px;">
        <div style="display:flex;align-items:center;gap:6px;">
          <div style="flex:1;background:#eee;border-radius:4px;height:8px;">
            <div style="width:${pct}%;background:${barColor};height:8px;border-radius:4px;"></div>
          </div>
          <span style="font-size:0.78rem;color:${barColor};font-weight:600;">${pct}%</span>
        </div>
      </td>
      ${celdas.join('')}
    </tr>`;
  }).join('');

  cont.innerHTML = `
    <div style="overflow-x:auto;">
      <table style="border-collapse:collapse;width:100%;font-size:0.84rem;min-width:600px;">
        <thead><tr style="background:#002855;color:white;">
          <th style="padding:8px 10px;text-align:left;">Trabajador</th>
          <th style="padding:8px 10px;min-width:120px;">Progreso</th>
          ${headerCursos}
        </tr></thead>
        <tbody>${filas}</tbody>
      </table>
    </div>`;

  // Guardar para exportar
  window._progresoRuta = { workers, cursos, lastSub, now };
};

window.exportarProgresoRuta = function () {
  const d = window._progresoRuta;
  if (!d) { alert('Primero carga el progreso.'); return; }
  const XLSX = window.XLSX;
  const header = ['Apellidos', 'Nombres', 'Documento', ...d.cursos.map(c => c?.titulo || '')];
  const rows = d.workers.map(w => {
    const celdas = d.cursos.map(c => {
      const sub = d.lastSub[`${w.email}__${c?.id}`];
      if (!sub) return 'Pendiente';
      const venc = new Date(sub.created_at);
      venc.setMonth(venc.getMonth() + (c?.vigencia_meses || 12));
      return venc > d.now ? 'Vigente' : 'Vencido';
    });
    return [w.apellidos, w.nombres, w.documento_numero, ...celdas];
  });
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  ws['!cols'] = [20, 20, 15, ...d.cursos.map(() => ({ wch: 14 }))].map(v => typeof v === 'number' ? { wch: v } : v);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Progreso Ruta');
  XLSX.writeFile(wb, `Progreso_Ruta_${new Date().getFullYear()}.xlsx`);
};

// ═══════════════════════════════════════════════
// 🏛️ REPORTE SUNAFIL
// ═══════════════════════════════════════════════

window.initSelectorSUNAFIL = function () {
  const anioActual = new Date().getFullYear();
  const sel = document.getElementById('sunafil-anio');
  if (!sel || sel.options.length > 1) return;
  for (let a = anioActual; a >= anioActual - 3; a--) {
    const opt = document.createElement('option');
    opt.value = a; opt.textContent = a;
    if (a === anioActual) opt.selected = true;
    sel.appendChild(opt);
  }
};

window.generarReporteSUNAFIL = async function () {
  const anio = parseInt(document.getElementById('sunafil-anio').value);
  const tipo  = document.getElementById('sunafil-tipo').value;

  const inicioAnio = new Date(`${anio}-01-01T00:00:00-05:00`).toISOString();
  const finAnio    = new Date(`${anio}-12-31T23:59:59-05:00`).toISOString();

  // 1. Datos de empresa
  const { data: emp } = await supabase.from('empresas').select('nombre, ruc').eq('id', empresaAdminId).single();

  // 2. Envíos del año con perfil + curso + formulario
  let query = supabase
    .from('envios_formulario')
    .select('usuario_email, id_curso, puntaje, porcentaje, aprobado, created_at, formularios(tipo, titulo), cursos(titulo, duracion)')
    .eq('estado', 'completado')
    .gte('created_at', inicioAnio)
    .lte('created_at', finAnio);

  if (tipo) query = query.eq('formularios.tipo', tipo);

  const { data: envios } = await query;
  if (!envios?.length) { alert('No hay registros para ese año.'); return; }

  // 3. Perfiles
  const emails = [...new Set(envios.map(e => e.usuario_email))];
  const { data: perfiles } = await supabase
    .from('profiles')
    .select('email, nombres, apellidos, documento_numero, documento_tipo, cargo, empresa')
    .in('email', emails);

  const perfilMap = {};
  (perfiles || []).forEach(p => { perfilMap[p.email] = p; });

  // 4. Contar participantes por curso+fecha (día)
  const participantesPorCursoFecha = {};
  envios.forEach(e => {
    const fecha = new Date(e.created_at).toLocaleDateString('es-PE');
    const key   = `${e.id_curso}__${fecha}`;
    participantesPorCursoFecha[key] = (participantesPorCursoFecha[key] || 0) + 1;
  });

  // 5. Construir filas SUNAFIL
  const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

  const filas = envios.map(e => {
    const p       = perfilMap[e.usuario_email] || {};
    const fecha   = new Date(e.created_at);
    const fechaStr= fecha.toLocaleDateString('es-PE');
    const key     = `${e.id_curso}__${fechaStr}`;
    const tipoForm= e.formularios?.tipo || '';
    const tipoSUN = tipoForm === 'examen' ? 'Específica' : tipoForm === 'encuesta' ? 'Inducción' : 'Periódica';
    const nota    = tipoForm === 'examen' ? (e.puntaje ?? '') : '';
    const estado  = tipoForm === 'examen' ? (e.aprobado ? 'Aprobado' : 'Desaprobado') : 'Completado';

    return [
      emp?.nombre || empresaAdminNombre || '',          // Razón Social
      emp?.ruc    || empresaAdminRuc    || '',          // RUC
      `${p.apellidos || ''} ${p.nombres || ''}`.trim(), // Apellidos y Nombres
      p.documento_numero || '',                          // N° Documento
      p.documento_tipo   || 'DNI',                      // Tipo Doc
      p.cargo            || '',                          // Cargo
      e.cursos?.titulo   || '',                          // Tema de Capacitación
      tipoSUN,                                           // Tipo (Inducción/Específica/Periódica)
      'Virtual',                                         // Modalidad
      fechaStr,                                          // Fecha
      MESES[fecha.getMonth()],                           // Mes
      e.cursos?.duracion || '',                          // Duración (hrs)
      participantesPorCursoFecha[key] || 1,              // N° Participantes
      estado,                                            // Estado
      nota,                                              // Nota (/20)
      e.porcentaje != null ? `${e.porcentaje}%` : '',   // Porcentaje
    ];
  });

  const XLSX = window.XLSX;
  const encabezado = [
    'Razón Social', 'RUC', 'Apellidos y Nombres', 'N° Documento', 'Tipo Doc',
    'Cargo', 'Tema de Capacitación', 'Tipo', 'Modalidad', 'Fecha', 'Mes',
    'Duración (hrs)', 'N° Participantes', 'Estado', 'Nota (/20)', 'Porcentaje'
  ];

  const ws = XLSX.utils.aoa_to_sheet([encabezado, ...filas]);
  ws['!cols'] = [22,13,28,14,9,20,35,12,10,12,10,13,14,12,10,11].map(w => ({ wch: w }));

  // Estilo encabezado (SheetJS básico)
  const rango = XLSX.utils.decode_range(ws['!ref']);
  for (let C = rango.s.c; C <= rango.e.c; C++) {
    const cell = ws[XLSX.utils.encode_cell({ r: 0, c: C })];
    if (cell) cell.s = { font: { bold: true }, fill: { fgColor: { rgb: '002855' } }, font: { color: { rgb: 'FFFFFF' }, bold: true } };
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `Capacitaciones ${anio}`);
  XLSX.writeFile(wb, `Reporte_SUNAFIL_${emp?.ruc || 'empresa'}_${anio}.xlsx`);
};

// ═══════════════════════════════════════════════
// 📷 QR ASISTENCIA PRESENCIAL
// ═══════════════════════════════════════════════

let sesionQRActual = null;
let intervalAsistentes = null;

window.initQRAsistencia = async function () {
  const { data: cursos } = await supabase.from('cursos').select('id, titulo').eq('activo', true).order('titulo');
  ['qr-curso', 'qr-filtro-curso'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    sel.innerHTML = id === 'qr-filtro-curso'
      ? '<option value="">Todos los cursos</option>'
      : '<option value="">-- Selecciona el curso --</option>';
    (cursos || []).forEach(c => sel.insertAdjacentHTML('beforeend', `<option value="${c.id}">${c.titulo}</option>`));
    initSelectBuscable(id);
  });

  // Fecha default = ahora
  const ahora = new Date();
  ahora.setMinutes(ahora.getMinutes() - ahora.getTimezoneOffset());
  document.getElementById('qr-fecha').value = ahora.toISOString().slice(0, 16);

  cargarSesionesAnteriores();
};

window.crearSesionQR = async function () {
  const curso_id  = document.getElementById('qr-curso').value;
  const lugar     = document.getElementById('qr-lugar').value.trim();
  const fecha     = document.getElementById('qr-fecha').value;
  const expositor = document.getElementById('qr-expositor').value.trim();
  const duracion  = parseFloat(document.getElementById('qr-duracion').value) || null;

  if (!curso_id || !lugar || !fecha) {
    alert('Completa: curso, lugar y fecha.');
    return;
  }

  const { data: sesion, error } = await supabase.from('sesiones_presenciales').insert({
    empresa_id: empresaAdminId,
    curso_id, lugar, fecha_hora: new Date(fecha).toISOString(),
    expositor: expositor || null,
    duracion_hr: duracion,
    activa: true,
  }).select().single();

  if (error) { alert('❌ ' + error.message); return; }

  sesionQRActual = sesion;
  mostrarQR(sesion);
  iniciarPollingAsistentes(sesion.id);
};

function mostrarQR(sesion) {
  const url = `${window.location.origin}/qr-asistencia.html?sesion=${sesion.id}`;
  const canvas = document.getElementById('qr-canvas');

  window.QRCode.toCanvas(canvas, url, {
    width: 280, margin: 2,
    color: { dark: '#002855', light: '#ffffff' }
  });

  const fecha = new Date(sesion.fecha_hora).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' });
  document.getElementById('qr-info-sesion').textContent =
    `${sesion.lugar} · ${fecha}${sesion.expositor ? ' · ' + sesion.expositor : ''}`;

  document.getElementById('panel-qr-generado').style.display = 'block';
  document.getElementById('panel-asistentes-qr').style.display = 'block';
  window.scrollTo({ top: document.getElementById('panel-qr-generado').offsetTop - 20, behavior: 'smooth' });
}

function iniciarPollingAsistentes(sesionId) {
  if (intervalAsistentes) clearInterval(intervalAsistentes);
  refrescarAsistentes();
  intervalAsistentes = setInterval(refrescarAsistentes, 8000);
}

window.refrescarAsistentes = async function () {
  if (!sesionQRActual) return;
  const { data } = await supabase
    .from('asistencias_presenciales')
    .select('id, created_at, profiles(nombres, apellidos, documento_numero, cargo)')
    .eq('sesion_id', sesionQRActual.id)
    .order('created_at');

  const cont  = document.getElementById('lista-asistentes-qr');
  const count = document.getElementById('qr-count');
  count.textContent = `(${data?.length || 0})`;

  if (!data?.length) {
    cont.innerHTML = '<p style="color:#888; font-size:0.88rem;">Aún no hay asistentes. El QR está activo.</p>';
    return;
  }

  cont.innerHTML = `
    <table style="border-collapse:collapse;width:100%;font-size:0.85rem;">
      <thead><tr style="background:#002855;color:white;">
        <th style="padding:8px 10px;">#</th>
        <th style="padding:8px 10px;text-align:left;">Nombre</th>
        <th style="padding:8px 10px;">Documento</th>
        <th style="padding:8px 10px;">Cargo</th>
        <th style="padding:8px 10px;">Hora</th>
      </tr></thead>
      <tbody>
        ${data.map((a, i) => `
          <tr style="border-bottom:1px solid #eee;">
            <td style="padding:7px 10px;text-align:center;color:#888;">${i + 1}</td>
            <td style="padding:7px 10px;font-weight:500;">${a.profiles?.apellidos || ''}, ${a.profiles?.nombres || ''}</td>
            <td style="padding:7px 10px;text-align:center;">${a.profiles?.documento_numero || ''}</td>
            <td style="padding:7px 10px;">${a.profiles?.cargo || ''}</td>
            <td style="padding:7px 10px;text-align:center;font-size:0.8rem;color:#555;">
              ${new Date(a.created_at).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}
            </td>
          </tr>`).join('')}
      </tbody>
    </table>`;

  window._asistentesQR = data;
};

window.cerrarSesionQR = async function () {
  if (!sesionQRActual) return;
  if (!await showConfirm('¿Cerrar esta sesión?\nEl QR dejará de funcionar y no se podrán registrar más asistentes.', { confirmText: 'Cerrar sesión', danger: true })) return;
  await supabase.from('sesiones_presenciales').update({ activa: false }).eq('id', sesionQRActual.id);
  if (intervalAsistentes) { clearInterval(intervalAsistentes); intervalAsistentes = null; }
  sesionQRActual = null;
  document.getElementById('panel-qr-generado').style.display = 'none';
  document.getElementById('panel-asistentes-qr').style.display = 'none';
  cargarSesionesAnteriores();
  alert('✅ Sesión cerrada.');
};

window.imprimirQR = function () {
  const canvas = document.getElementById('qr-canvas');
  const info   = document.getElementById('qr-info-sesion').textContent;
  const win    = window.open('', '_blank');
  win.document.write(`
    <html><body style="text-align:center;font-family:Arial;padding:40px;">
      <h2 style="color:#002855;">Registro de Asistencia</h2>
      <p style="font-size:1rem;color:#555;margin-bottom:20px;">${info}</p>
      <img src="${canvas.toDataURL()}" style="width:280px;height:280px;" />
      <p style="margin-top:20px;font-size:0.9rem;color:#888;">Escanea con tu celular para registrar tu asistencia</p>
      <script>window.onload=()=>{window.print();}<\/script>
    </body></html>`);
  win.document.close();
};

window.descargarQR = function () {
  const canvas = document.getElementById('qr-canvas');
  const a = document.createElement('a');
  a.download = `QR_Asistencia_${sesionQRActual?.lugar || 'sesion'}.png`;
  a.href = canvas.toDataURL('image/png');
  a.click();
};

window.exportarAsistentesQR = function () {
  const data = window._asistentesQR;
  if (!data?.length) { alert('No hay asistentes para exportar.'); return; }
  const XLSX = window.XLSX;
  const header = ['#', 'Apellidos', 'Nombres', 'Documento', 'Cargo', 'Hora de registro'];
  const rows = data.map((a, i) => [
    i + 1,
    a.profiles?.apellidos || '',
    a.profiles?.nombres   || '',
    a.profiles?.documento_numero || '',
    a.profiles?.cargo     || '',
    new Date(a.created_at).toLocaleString('es-PE'),
  ]);
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  ws['!cols'] = [5,20,20,14,20,18].map(w => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Asistentes');
  XLSX.writeFile(wb, `Asistentes_${sesionQRActual?.lugar || 'sesion'}.xlsx`);
};

window.cargarSesionesAnteriores = async function () {
  const cursoId = document.getElementById('qr-filtro-curso')?.value;
  let query = supabase
    .from('sesiones_presenciales')
    .select('id, lugar, fecha_hora, activa, expositor, duracion_hr, cursos(titulo)')
    .eq('empresa_id', empresaAdminId)
    .order('fecha_hora', { ascending: false })
    .limit(20);
  if (cursoId) query = query.eq('curso_id', cursoId);

  const { data } = await query;
  const cont = document.getElementById('lista-sesiones-anteriores');
  if (!data?.length) { cont.innerHTML = '<p style="color:#888;">No hay sesiones registradas.</p>'; return; }

  cont.innerHTML = `
    <table style="border-collapse:collapse;width:100%;font-size:0.85rem;">
      <thead><tr style="background:#002855;color:white;">
        <th style="padding:8px 10px;text-align:left;">Curso</th>
        <th style="padding:8px 10px;text-align:left;">Lugar</th>
        <th style="padding:8px 10px;">Fecha</th>
        <th style="padding:8px 10px;">Estado</th>
        <th style="padding:8px 10px;">Acción</th>
      </tr></thead>
      <tbody>
        ${data.map(s => `
          <tr style="border-bottom:1px solid #eee;">
            <td style="padding:7px 10px;font-weight:500;">${s.cursos?.titulo || ''}</td>
            <td style="padding:7px 10px;">${s.lugar}</td>
            <td style="padding:7px 10px;text-align:center;font-size:0.82rem;">
              ${new Date(s.fecha_hora).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' })}
            </td>
            <td style="padding:7px 10px;text-align:center;">
              <span style="background:${s.activa ? '#d1fae5' : '#f1f5f9'};color:${s.activa ? '#065f46' : '#475569'};padding:2px 8px;border-radius:10px;font-size:0.78rem;font-weight:600;">
                ${s.activa ? 'Activa' : 'Cerrada'}
              </span>
            </td>
            <td style="padding:7px 10px;text-align:center;">
              <button onclick="verAsistentesSesion('${s.id}')" style="background:#002855;color:white;border:none;padding:4px 10px;border-radius:5px;cursor:pointer;font-size:0.8rem;">Ver</button>
            </td>
          </tr>`).join('')}
      </tbody>
    </table>`;
};

window.verAsistentesSesion = async function (sesionId) {
  const { data } = await supabase
    .from('asistencias_presenciales')
    .select('created_at, profiles(nombres, apellidos, documento_numero, cargo)')
    .eq('sesion_id', sesionId)
    .order('created_at');

  if (!data?.length) { alert('Sin asistentes registrados.'); return; }

  const XLSX = window.XLSX;
  const header = ['#', 'Apellidos', 'Nombres', 'Documento', 'Cargo', 'Hora'];
  const rows = data.map((a, i) => [
    i + 1,
    a.profiles?.apellidos || '',
    a.profiles?.nombres   || '',
    a.profiles?.documento_numero || '',
    a.profiles?.cargo     || '',
    new Date(a.created_at).toLocaleString('es-PE'),
  ]);
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  ws['!cols'] = [5,20,20,14,20,18].map(w => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Asistentes');
  XLSX.writeFile(wb, `Asistentes_sesion.xlsx`);
};

// ═══════════════════════════════════════════════
// 📊 IMPORTAR EVALUACIONES HISTÓRICAS
// ═══════════════════════════════════════════════

let filasEval = [];

window.descargarPlantillaEvaluaciones = async function (e) {
  e.preventDefault();
  try {
    const XLSX = window.XLSX;

    const { data: cursos } = await supabase
      .from('cursos').select('titulo').eq('activo', true).order('titulo');
    const listaCursos = cursos?.map(c => c.titulo) || [];

    const ws = XLSX.utils.aoa_to_sheet([
      ['DNI', 'Nombre del Curso', 'Fecha (DD/MM/AAAA)', 'Hora (HH:MM)', 'Nota (0-20)', 'Asistencia (SI/NO)'],
      ['', '', '', '', '', ''],
    ]);
    ws['!cols'] = [12, 32, 20, 14, 16, 18].map(w => ({ wch: w }));

    ws['!dataValidations'] = ws['!dataValidations'] || [];
    if (listaCursos.length > 0) {
      ws['!dataValidations'].push({
        type: 'list', sqref: 'B2:B500',
        formula1: listaCursos.join(',').length <= 255
          ? '"' + listaCursos.join(',') + '"'
          : 'Cursos!$A$1:$A$' + listaCursos.length
      });
    }
    ws['!dataValidations'].push({
      type: 'list', sqref: 'F2:F500',
      formula1: '"SI,NO"'
    });

    const wsCursos = XLSX.utils.aoa_to_sheet(listaCursos.map(c => [c]));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Evaluaciones');
    if (listaCursos.length > 0) XLSX.utils.book_append_sheet(wb, wsCursos, 'Cursos');
    XLSX.writeFile(wb, 'plantilla_evaluaciones_historicas.xlsx');
  } catch (err) {
    alert('Error al generar plantilla: ' + err.message);
  }
};

window.previsualizarEvaluaciones = async function () {
  const archivo = document.getElementById('archivo-eval').files[0];
  if (!archivo) return;

  const reader = new FileReader();
  reader.onload = async function (e) {
    const XLSX = window.XLSX;
    const wb   = XLSX.read(e.target.result, { type: 'array', cellDates: true });
    const hoja = wb.Sheets[wb.SheetNames[0]];
    const filas = XLSX.utils.sheet_to_json(hoja, { header: 1, defval: '' });

    filasEval = filas.slice(1).filter(f => f[0] && f[1]);

    const dnis = [...new Set(filasEval.map(f => normalizarDNI(f[0])))];
    const { data: perfiles } = await supabase
      .from('profiles')
      .select('id, documento_numero, nombres, apellidos, email')
      .in('documento_numero', dnis)
      .eq('empresa_id', empresaAdminId);

    const perfilMap = {};
    perfiles?.forEach(p => { perfilMap[p.documento_numero] = p; });

    const tbody = document.getElementById('tbody-eval');
    tbody.innerHTML = '';

    filasEval.forEach(f => {
      const dni    = normalizarDNI(f[0]);
      const curso  = String(f[1]).trim();
      const fecha  = String(f[2]).trim();
      const hora   = String(f[3]).trim() || '08:00';
      const nota   = parseFloat(String(f[4]).replace(',', '.')) || 0;
      const asist  = String(f[5]).trim().toUpperCase();
      const perfil = perfilMap[dni];
      const tr = document.createElement('tr');
      let estado = '';
      if (!perfil) {
        estado = '<span style="color:red;">❌ DNI no encontrado</span>';
      } else if (!curso) {
        estado = '<span style="color:red;">❌ Falta curso</span>';
      } else {
        const aprobado = nota >= 16;
        estado = `<span style="color:${aprobado ? '#198754' : '#dc3545'};">${aprobado ? '✅ Aprobado' : '⚠️ Desaprobado'}</span>`;
      }
      tr.innerHTML = `
        <td>${dni}</td>
        <td>${perfil ? perfil.apellidos + ' ' + perfil.nombres : '<em style="color:#888;">No encontrado</em>'}</td>
        <td>${curso}</td><td>${fecha}</td><td>${hora}</td>
        <td><strong>${nota}</strong>/20</td>
        <td>${asist === 'SI' ? '✅ SI' : asist === 'NO' ? '❌ NO' : asist}</td>
        <td class="estado-fila-eval">${estado}</td>`;
      tbody.appendChild(tr);
    });

    const validas = filasEval.filter(f => perfilMap[String(f[0]).trim()] && f[1]).length;
    document.getElementById('preview-resumen-eval').textContent =
      `${filasEval.length} filas — ${validas} válidas para importar, ${filasEval.length - validas} con errores.`;
    document.getElementById('preview-eval').style.display = 'block';
  };
  reader.readAsArrayBuffer(archivo);
};

window.importarEvaluaciones = async function () {
  if (!filasEval.length) return;

  const btn = document.getElementById('btn-confirmar-eval');
  btn.disabled = true;
  btn.textContent = '⏳ Importando...';
  const progreso = document.getElementById('progreso-eval');

  // Cargar datos maestros de una vez
  const dnis = [...new Set(filasEval.map(f => normalizarDNI(f[0])))];
  const { data: perfiles } = await supabase
    .from('profiles')
    .select('id, documento_numero, email')
    .in('documento_numero', dnis)
    .eq('empresa_id', empresaAdminId);

  const perfilMap = {};
  perfiles?.forEach(p => { perfilMap[p.documento_numero] = p; });

  const { data: cursos } = await supabase
    .from('cursos').select('id, titulo').eq('activo', true);
  const cursoMap = {};
  cursos?.forEach(c => { cursoMap[c.titulo.toLowerCase()] = c; });

  const { data: formularios } = await supabase
    .from('formularios').select('id, id_curso, tipo').eq('tipo', 'examen');
  const formMap = {};
  formularios?.forEach(f => { formMap[f.id_curso] = f; });

  const filas = document.querySelectorAll('#tbody-eval tr');
  let ok = 0, errores = 0, omitidos = 0;

  for (let i = 0; i < filasEval.length; i++) {
    const f      = filasEval[i];
    const dni    = normalizarDNI(f[0]);
    const cursoNombre = String(f[1]).trim();
    const fechaStr    = String(f[2]).trim();   // DD/MM/AAAA
    const horaStr     = String(f[3]).trim() || '08:00';
    const nota        = parseFloat(String(f[4]).replace(',', '.')) || 0;
    const asistencia  = String(f[5]).trim().toUpperCase() === 'SI';
    const tdEstado    = filas[i]?.querySelector('.estado-fila-eval');

    const perfil = perfilMap[dni];
    const curso  = cursoMap[cursoNombre.toLowerCase()];
    const form   = curso ? formMap[curso.id] : null;

    if (!perfil || !curso) {
      if (tdEstado) { tdEstado.innerHTML = '<span style="color:orange;">⚠️ Omitido (dato faltante)</span>'; }
      omitidos++;
      progreso.textContent = `Progreso: ${i+1}/${filasEval.length} — ✅ ${ok}, ⚠️ ${omitidos}, ❌ ${errores}`;
      continue;
    }

    // Construir timestamp con fecha y hora indicadas
    let createdAt = new Date().toISOString();
    try {
      const [dia, mes, anio] = fechaStr.split('/');
      const [hh, mm]         = horaStr.split(':');
      const d = new Date(
        parseInt(anio), parseInt(mes) - 1, parseInt(dia),
        parseInt(hh) || 8, parseInt(mm) || 0, 0
      );
      if (!isNaN(d.getTime())) createdAt = d.toISOString();
    } catch (_) { /* usar fecha actual */ }

    const porcentaje = Math.round((nota / 20) * 100 * 10) / 10;
    const aprobado   = nota >= 16;

    // Insertar en envios_formulario
    const { error: errEnvio } = await supabase.from('envios_formulario').insert({
      id_formulario: form?.id || null,
      usuario_id:    perfil.id,
      usuario_email: perfil.email,
      id_curso:      curso.id,
      estado:        'completado',
      puntaje:       nota,
      porcentaje,
      aprobado,
      created_at:    createdAt,
    });

    if (errEnvio) {
      if (tdEstado) { tdEstado.innerHTML = `<span style="color:red;">❌ ${errEnvio.message}</span>`; }
      errores++;
      progreso.textContent = `Progreso: ${i+1}/${filasEval.length} — ✅ ${ok}, ⏭️ ${omitidos}, ❌ ${errores}`;
      continue;
    }

    // Registrar asistencia si corresponde
    if (asistencia) {
      const { data: yaAsiste } = await supabase
        .from('asistencias')
        .select('usuario_id')
        .eq('usuario_id', perfil.id)
        .eq('curso_id', curso.id)
        .maybeSingle();
      if (!yaAsiste) {
        await supabase.from('asistencias').insert({
          usuario_id: perfil.id,
          email:      perfil.email,
          curso_id:   curso.id,
        });
      }
    }

    if (tdEstado) {
      tdEstado.innerHTML = `<span style="color:${aprobado ? '#198754' : '#dc3545'};">✅ ${aprobado ? 'Aprobado' : 'Desaprobado'} importado</span>`;
    }
    ok++;
    progreso.textContent = `Progreso: ${i+1}/${filasEval.length} — ✅ ${ok}, ⏭️ ${omitidos}, ❌ ${errores}`;
  }

  progreso.textContent += ` — ¡Completado! ${ok} registros importados.`;
  btn.disabled = false;
  btn.textContent = '✅ Confirmar importación';
};

// ═══════════════════════════════════════════════
// 📋 IMPORTAR DESDE MICROSOFT FORMS / GOOGLE FORMS
// ═══════════════════════════════════════════════

let filasForms = [];
let filasFormsOrdenadas = [];
let colsDniForms = -1, colFechaForms = -1, colNotaForms = -1, colNombreForms = -1;

window.cargarCursosSelectForms = async function () {
  const sel = document.getElementById('forms-curso');
  if (!sel || sel.options.length > 1) return; // ya cargado
  const { data: cursos } = await supabase
    .from('cursos').select('id, titulo').eq('activo', true).order('titulo');
  (cursos || []).forEach(c => {
    sel.innerHTML += `<option value="${c.id}">${c.titulo}</option>`;
  });
};

// Detecta qué columna del header coincide con un texto (exacto o parcial)
function detectarColumna(headers, textos) {
  for (const texto of textos) {
    const idx = headers.findIndex(h =>
      String(h).trim().toLowerCase() === texto.toLowerCase()
    );
    if (idx !== -1) return idx;
  }
  // búsqueda parcial como fallback
  for (const texto of textos) {
    const idx = headers.findIndex(h =>
      String(h).trim().toLowerCase().includes(texto.toLowerCase())
    );
    if (idx !== -1) return idx;
  }
  return -1;
}

// Parsea fecha/hora: maneja Date objects de SheetJS, "M/D/YY H:MM:SS" e ISO
function parsearFechaForms(raw) {
  if (!raw) return { fechaStr: '', horaStr: '', iso: null };

  // SheetJS con cellDates:true entrega Date objects — caso principal
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    const dia = String(raw.getDate()).padStart(2, '0');
    const mes = String(raw.getMonth() + 1).padStart(2, '0');
    const hh  = String(raw.getHours()).padStart(2, '0');
    const mm  = String(raw.getMinutes()).padStart(2, '0');
    return { fechaStr: `${dia}/${mes}/${raw.getFullYear()}`, horaStr: `${hh}:${mm}`, iso: raw.toISOString() };
  }

  const s = String(raw).trim();
  // Formato texto M/D/YY H:MM:SS (Forms exportado como CSV o texto)
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})/);
  if (m) {
    const anio = m[3].length === 2 ? 2000 + parseInt(m[3]) : parseInt(m[3]);
    const mes  = m[1].padStart(2, '0');
    const dia  = m[2].padStart(2, '0');
    const hh   = m[4].padStart(2, '0');
    const mm   = m[5].padStart(2, '0');
    const d = new Date(anio, parseInt(mes) - 1, parseInt(dia), parseInt(hh), parseInt(mm));
    return { fechaStr: `${dia}/${mes}/${anio}`, horaStr: `${hh}:${mm}`, iso: d.toISOString() };
  }

  // Fallback: cualquier string parseable
  try {
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      const dia = String(d.getDate()).padStart(2, '0');
      const mes = String(d.getMonth() + 1).padStart(2, '0');
      const hh  = String(d.getHours()).padStart(2, '0');
      const mm  = String(d.getMinutes()).padStart(2, '0');
      return { fechaStr: `${dia}/${mes}/${d.getFullYear()}`, horaStr: `${hh}:${mm}`, iso: d.toISOString() };
    }
  } catch (_) {}
  return { fechaStr: s, horaStr: '', iso: null };
}

window.previsualizarForms = async function () {
  const archivo = document.getElementById('archivo-forms').files[0];
  if (!archivo) return;
  const cursoId = document.getElementById('forms-curso').value;
  if (!cursoId) { alert('Selecciona primero el curso correspondiente.'); return; }

  const reader = new FileReader();
  reader.onload = async function (ev) {
    const XLSX = window.XLSX;
    const wb   = XLSX.read(ev.target.result, { type: 'array', cellDates: true });
    const hoja = wb.Sheets[wb.SheetNames[0]];
    const filas = XLSX.utils.sheet_to_json(hoja, { header: 1, defval: '' });
    if (filas.length < 2) { alert('El archivo no tiene datos.'); return; }

    const headers = filas[0].map(h => String(h).trim());

    // Detectar columnas clave
    colFechaForms  = detectarColumna(headers, ['Hora de finalización', 'End time', 'Hora de inicio', 'Start time']);
    colNotaForms   = detectarColumna(headers, ['Total de puntos', 'Total points', 'Score', 'Puntuación']);
    colNombreForms = detectarColumna(headers, ['Nombre', 'Name']);
    // DNI: buscar columna cuyo header sea exactamente "DNI" (no "Puntos: DNI")
    colsDniForms   = headers.findIndex(h => /^dni$/i.test(h.trim()));

    if (colsDniForms === -1 || colNotaForms === -1) {
      alert(`No se encontraron las columnas necesarias.\nDetectado: DNI en col ${colsDniForms}, Nota en col ${colNotaForms}.\nVerifica que el archivo sea una exportación de Microsoft Forms.`);
      return;
    }

    const maxPuntaje = parseFloat(document.getElementById('forms-max-puntaje').value) || 20;

    filasForms = filas.slice(1).filter(f => f[colsDniForms] && String(f[colsDniForms]).trim());

    // Cargar perfiles para previsualizar estado
    const dnis = [...new Set(filasForms.map(f => normalizarDNI(f[colsDniForms])))];
    const { data: perfiles } = await supabase
      .from('profiles')
      .select('id, documento_numero, nombres, apellidos, email')
      .in('documento_numero', dnis)
      .eq('empresa_id', empresaAdminId);
    const perfilMap = {};
    (perfiles || []).forEach(p => { perfilMap[p.documento_numero] = p; });

    const tbody = document.getElementById('tbody-forms');
    tbody.innerHTML = '';
    let validas = 0, invalidas = 0, desaprobados = 0;

    // Preparar filas con orden calculado — guardar en variable global para el import
    filasFormsOrdenadas = filasForms.map(f => {
      const dniRaw     = normalizarDNI(f[colsDniForms]);
      const notaRaw    = parseFloat(String(f[colNotaForms]).replace(',', '.')) || 0;
      const nota20     = maxPuntaje === 20 ? notaRaw : Math.round((notaRaw / maxPuntaje) * 20 * 10) / 10;
      const perfil     = perfilMap[dniRaw];
      const aprobado   = nota20 >= 16;
      // orden: 0 = aprobado, 1 = desaprobado, 2 = no encontrado
      const orden = !perfil ? 2 : aprobado ? 0 : 1;
      return { f, dniRaw, notaRaw, nota20, perfil, aprobado, orden };
    }).sort((a, b) => a.orden - b.orden);

    filasFormsOrdenadas.forEach(({ f, dniRaw, notaRaw, nota20, perfil, aprobado }) => {
      const { fechaStr, horaStr } = parsearFechaForms(f[colFechaForms]);
      const nombreForms = colNombreForms !== -1 ? String(f[colNombreForms]).trim() : '';
      const tr = document.createElement('tr');
      let estado;
      if (!perfil) {
        estado = `<span style="color:red;">❌ DNI ${dniRaw} no encontrado</span>`;
        invalidas++;
      } else if (aprobado) {
        estado = `<span style="color:#198754;">✅ Aprobado</span>`;
        validas++;
      } else {
        estado = `<span style="color:#dc3545;">⚠️ Desaprobado</span>`;
        validas++;
        desaprobados++;
      }
      tr.innerHTML = `
        <td>${dniRaw}</td>
        <td style="font-size:0.82rem;">${perfil ? perfil.apellidos+' '+perfil.nombres : (nombreForms || '<em style="color:#888;">—</em>')}</td>
        <td>${fechaStr}</td><td>${horaStr}</td>
        <td><strong>${nota20}</strong>/20${maxPuntaje !== 20 ? ` <span style="color:#888;font-size:0.78rem;">(${notaRaw}/${maxPuntaje})</span>` : ''}</td>
        <td>${aprobado ? '✅' : '❌'}</td>
        <td class="estado-fila-forms">${estado}</td>`;
      tbody.appendChild(tr);
    });

    document.getElementById('preview-resumen-forms').textContent =
      `${filasForms.length} respuestas — ✅ ${validas - desaprobados} aprobados, ⚠️ ${desaprobados} desaprobados, ❌ ${invalidas} DNI no encontrados (se omitirán).`;
    document.getElementById('preview-forms').style.display = 'block';
  };
  reader.readAsArrayBuffer(archivo);
};

window.importarDesdeforms = async function () {
  if (!filasForms.length) return;
  const cursoId    = document.getElementById('forms-curso').value;
  const maxPuntaje = parseFloat(document.getElementById('forms-max-puntaje').value) || 20;
  if (!cursoId) { alert('Selecciona el curso.'); return; }

  const btn = document.getElementById('btn-confirmar-forms');
  btn.disabled = true; btn.textContent = '⏳ Importando...';
  const progreso = document.getElementById('progreso-forms');

  // Datos maestros
  const dnis = [...new Set(filasForms.map(f => String(f[colsDniForms]).trim().replace(/\n/g,'').replace(/\r/g,'')))];
  const { data: perfiles } = await supabase
    .from('profiles').select('id, documento_numero, email')
    .in('documento_numero', dnis).eq('empresa_id', empresaAdminId);
  const perfilMap = {};
  (perfiles || []).forEach(p => { perfilMap[p.documento_numero] = p; });

  const { data: formRows } = await supabase
    .from('formularios').select('id, id_curso').eq('id_curso', cursoId).eq('tipo', 'examen');
  const formId = formRows?.[0]?.id || null;

  const filas = document.querySelectorAll('#tbody-forms tr');
  let ok = 0, omitidos = 0, errores = 0;

  for (let i = 0; i < filasFormsOrdenadas.length; i++) {
    const { f, dniRaw, nota20, perfil } = filasFormsOrdenadas[i];
    const notaRaw  = parseFloat(String(f[colNotaForms]).replace(',', '.')) || 0;
    const { iso: createdAt } = parsearFechaForms(f[colFechaForms]);
    const tdEstado = filas[i]?.querySelector('.estado-fila-forms');

    if (!perfil) {
      omitidos++;
      progreso.textContent = `Progreso: ${i+1}/${filasFormsOrdenadas.length} — ✅ ${ok}, ⏭️ ${omitidos}, ❌ ${errores}`;
      continue;
    }


    const porcentaje = Math.round((nota20 / 20) * 100 * 10) / 10;
    const aprobado   = nota20 >= 16;

    const envioData = {
      id_formulario: formId,
      usuario_id:    perfil.id,
      usuario_email: perfil.email,
      id_curso:      cursoId,
      estado:        'completado',
      puntaje:       nota20,
      porcentaje,
      aprobado,
    };
    if (createdAt) envioData.created_at = createdAt;

    const { error: errEnvio } = await supabase.from('envios_formulario').insert(envioData);
    if (errEnvio) {
      if (tdEstado) tdEstado.innerHTML = `<span style="color:red;">❌ ${errEnvio.message}</span>`;
      errores++;
    } else {
      // Registrar asistencia
      const { data: yaAsiste } = await supabase.from('asistencias')
        .select('usuario_id').eq('usuario_id', perfil.id).eq('curso_id', cursoId).maybeSingle();
      if (!yaAsiste) {
        await supabase.from('asistencias').insert({ usuario_id: perfil.id, email: perfil.email, curso_id: cursoId });
      }
      if (tdEstado) tdEstado.innerHTML = `<span style="color:${aprobado?'#198754':'#dc3545'};">✅ ${aprobado?'Aprobado':'Desaprobado'} importado</span>`;
      ok++;
    }
    progreso.textContent = `Progreso: ${i+1}/${filasForms.length} — ✅ ${ok}, ⏭️ ${omitidos}, ❌ ${errores}`;
  }

  progreso.textContent += ` — ¡Completado! ${ok} registros importados.`;
  btn.disabled = false; btn.textContent = '✅ Confirmar importación';
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
  wrap('button[onclick="enviarNotificaciones()"]', 'enviarNotificaciones','Enviando...');
  wrap('button[onclick="crearSesionQR()"]',        'crearSesionQR',       'Generando QR...');
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
