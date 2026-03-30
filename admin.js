import { supabase } from './src/supabaseClient.js';

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

  if (perfil?.rol !== "admin" && perfil?.rol !== "superadmin") {
    alert("Acceso denegado. Solo administradores.");
    window.location.href = "index.html";
    return;
  }

  await cargarDatosAdmin();
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

// ═══════════════════════════════
// 📚 Subir nuevo curso
// ═══════════════════════════════
window.subirCurso = async function () {
  const titulo       = document.getElementById("titulo-curso").value.trim();
  const prefijo      = document.getElementById("codigo-prefijo").value.trim().toUpperCase();
  const duracion     = parseInt(document.getElementById("duracion-curso").value);
  const url_video    = document.getElementById("url-video").value.trim();
  const url_material = document.getElementById("url-material").value.trim();

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
    url_video:    url_video    || null,
    url_material: url_material || null,
    activo:       true
  }]);

  if (error) {
    alert("❌ Error al subir curso: " + error.message);
  } else {
    alert(`✅ Curso subido correctamente.\nCódigo: ${codigo}`);
    ["titulo-curso", "codigo-prefijo", "duracion-curso",
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
      <td>${new Date(reg.created_at).toLocaleDateString()}</td>
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
    ['', '', '', '', '', '', ''],
  ]);

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

  const btnImportar = document.querySelector('#preview-excel .btn-primary');
  btnImportar.disabled = true;
  btnImportar.textContent = '⏳ Importando...';

  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;

  const { data: cargos } = await supabase.from('cargos').select('id, nombre').eq('activo', true);

  const progreso = document.getElementById('progreso-importacion');
  const filas = document.querySelectorAll('#tbody-preview tr');
  let ok = 0, errores = 0;

  for (let i = 0; i < filasExcel.length; i++) {
    const f = filasExcel[i];
    const dni          = String(f[0]).trim();
    const apellidos    = String(f[1]).trim();
    const nombres      = String(f[2]).trim();
    const emailRaw     = String(f[3]).trim();
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
      tdEstado.textContent = '❌ ' + (data?.error || 'Error');
      tdEstado.style.color = 'red';
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
};

// ═══════════════════════════════
// 📊 Descargar reporte Excel por mes/año
// ═══════════════════════════════

// Llenar selector de años al cargar
(function () {
  const sel = document.getElementById('filtro-anio');
  if (!sel) return;
  const hoy = new Date();
  for (let y = hoy.getFullYear(); y >= 2024; y--) {
    const opt = document.createElement('option');
    opt.value = y;
    opt.textContent = y;
    sel.appendChild(opt);
  }
  // Mes actual por defecto
  document.getElementById('filtro-mes').value = hoy.getMonth() + 1;
})();

window.descargarReporteExcel = async function () {
  const mes  = parseInt(document.getElementById('filtro-mes').value);
  const anio = parseInt(document.getElementById('filtro-anio').value);

  const desde = new Date(anio, mes - 1, 1).toISOString();
  const hasta = new Date(anio, mes, 1).toISOString();

  // 1. Obtener perfiles de la empresa del admin
  const { data: perfiles, error: errPerfiles } = await supabase
    .from('profiles')
    .select('id, email, nombres, apellidos, documento_numero, documento_tipo, cargo, empresa')
    .eq('empresa_id', empresaAdminId);

  if (errPerfiles) { alert('❌ Error al cargar perfiles: ' + errPerfiles.message); return; }

  if (!perfiles || perfiles.length === 0) { alert('No hay trabajadores en tu empresa.'); return; }

  const perfilMap = {};
  perfiles.forEach(p => { perfilMap[p.id] = p; });

  // 2. Obtener resultados del período para usuarios de la empresa
  const userIds = perfiles.map(p => p.id);
  const { data: envios, error } = await supabase
    .from('envios_formulario')
    .select('usuario_id, usuario_email, puntaje, porcentaje, aprobado, created_at, formularios(tipo, titulo), cursos(titulo)')
    .in('usuario_id', userIds)
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
    const p = perfilMap[r.usuario_id];
    const tipo = r.formularios?.tipo || '';
    const esEncuesta = tipo === 'encuesta';
    filas.push([
      p?.apellidos || '',
      p?.nombres || '',
      p?.documento_numero || r.usuario_email,
      p?.documento_tipo || '',
      p?.cargo || '',
      p?.empresa || '',
      r.cursos?.titulo || '',
      tipoLabel[tipo] || tipo,
      esEncuesta ? '—' : (r.puntaje ?? '—'),
      esEncuesta ? '—' : (r.porcentaje != null ? r.porcentaje.toFixed(1) + '%' : '—'),
      esEncuesta ? 'Completada' : (r.aprobado ? 'Aprobado' : 'Desaprobado'),
      new Date(r.created_at).toLocaleDateString('es-PE')
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

window.cargarTrabajadores = async function () {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, nombres, apellidos, email, documento_numero, telefono, cargo_id, cargo, fecha_ingreso, activo')
    .eq('empresa_id', empresaAdminId)
    .eq('rol', 'trabajador')
    .order('apellidos');

  if (error) { alert('❌ Error: ' + error.message); return; }

  // Cargar cargos para el modal
  const { data: cargos } = await supabase.from('cargos').select('id, nombre').eq('activo', true).order('nombre');
  cargosDisponibles = cargos || [];

  const tbody = document.getElementById('tbody-trabajadores');
  tbody.innerHTML = '';
  data?.forEach(u => {
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
    ['DNI', 'Email', 'Telefono', 'Cargo', 'Fecha Ingreso'],
    ['', '', '', '', ''],
  ]);

  const wsCargos = XLSX.utils.aoa_to_sheet(listaCargos.map(c => [c]));

  ws['!cols'] = [12, 28, 14, 22, 14].map(w => ({ wch: w }));

  ws['!dataValidations'] = ws['!dataValidations'] || [];
  if (listaCargos.length > 0) {
    ws['!dataValidations'].push({
      type: 'list',
      sqref: 'D2:D200',
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

    filasActualizacion = filas.slice(1).filter(f => f[0]);

    const tbody = document.getElementById('tbody-actualizacion');
    tbody.innerHTML = '';
    filasActualizacion.forEach(f => {
      const fechaRaw = f[4];
      let fecha = '';
      if (fechaRaw instanceof Date) {
        const y = fechaRaw.getFullYear();
        const m = String(fechaRaw.getMonth() + 1).padStart(2, '0');
        const d = String(fechaRaw.getDate()).padStart(2, '0');
        fecha = `${y}-${m}-${d}`;
      } else if (fechaRaw) {
        fecha = String(fechaRaw).trim();
      }
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="padding:5px;">${f[0]}</td>
        <td style="padding:5px;">${f[1]}</td>
        <td style="padding:5px;">${f[2]}</td>
        <td style="padding:5px;">${f[3]}</td>
        <td style="padding:5px;">${fecha}</td>
        <td style="padding:5px; color:#888;">Pendiente</td>
      `;
      tbody.appendChild(tr);
    });

    document.getElementById('preview-resumen-act').textContent =
      `${filasActualizacion.length} trabajadores a actualizar.`;
    document.getElementById('preview-actualizacion').style.display = 'block';
  };
  reader.readAsArrayBuffer(archivo);
};

window.ejecutarActualizacion = async function () {
  if (!filasActualizacion.length) return;

  const btnActualizar = document.querySelector('#preview-actualizacion .btn-primary');
  btnActualizar.disabled = true;
  btnActualizar.textContent = '⏳ Actualizando...';

  const { data: cargos } = await supabase.from('cargos').select('id, nombre').eq('activo', true);
  const filas = document.querySelectorAll('#tbody-actualizacion tr');
  const progreso = document.getElementById('progreso-actualizacion');
  let ok = 0, errores = 0;

  for (let i = 0; i < filasActualizacion.length; i++) {
    const f = filasActualizacion[i];
    const dni      = String(f[0]).trim();
    const emailRaw = String(f[1]).trim();
    const telefono = String(f[2]).trim();
    const cargoNombre = String(f[3]).trim();
    const fechaRaw = f[4];

    let fechaIngreso = '';
    if (fechaRaw instanceof Date) {
      const y = fechaRaw.getFullYear();
      const m = String(fechaRaw.getMonth() + 1).padStart(2, '0');
      const d = String(fechaRaw.getDate()).padStart(2, '0');
      fechaIngreso = `${y}-${m}-${d}`;
    } else if (fechaRaw) {
      fechaIngreso = String(fechaRaw).trim();
    }

    const tdEstado = filas[i].querySelectorAll('td')[5];
    tdEstado.textContent = '⏳ Actualizando...';
    tdEstado.style.color = '#888';

    const email = emailRaw.includes('@') ? emailRaw : null;
    const cargo = cargos?.find(c => c.nombre.toLowerCase() === cargoNombre.toLowerCase());

    const updates = {};
    if (email) updates.email = email;
    if (telefono) updates.telefono = telefono;
    if (cargo) { updates.cargo_id = cargo.id; updates.cargo = cargo.nombre; }
    if (fechaIngreso) updates.fecha_ingreso = fechaIngreso;

    if (Object.keys(updates).length === 0) {
      tdEstado.textContent = '⚠️ Sin cambios';
      tdEstado.style.color = '#888';
      ok++;
      progreso.textContent = `Progreso: ${i + 1}/${filasActualizacion.length} — ✅ ${ok} procesados, ❌ ${errores} errores`;
      continue;
    }

    const { error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('documento_numero', dni);

    if (error) {
      tdEstado.textContent = '❌ ' + error.message;
      tdEstado.style.color = 'red';
      errores++;
    } else {
      tdEstado.textContent = '✅ Actualizado';
      tdEstado.style.color = 'green';
      ok++;
    }

    progreso.textContent = `Progreso: ${i + 1}/${filasActualizacion.length} — ✅ ${ok} actualizados, ❌ ${errores} errores`;
  }

  progreso.textContent += ' — ¡Completado!';
  btnActualizar.disabled = false;
  btnActualizar.textContent = '✅ Confirmar actualización';
};

window.toggleActivo = async function (id, activo) {
  await supabase.from('profiles').update({ activo: !activo }).eq('id', id);
  cargarTrabajadores();
};

// ═══════════════════════════════
// 📊 DASHBOARD
// ═══════════════════════════════

// ── 1. Estado mensual ──
window.cargarDashboardMes = async function () {
  const ahora = new Date();
  const desde = new Date(ahora.getFullYear(), ahora.getMonth(), 1).toISOString();
  const hasta = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 1).toISOString();

  const { data: trabajadores } = await supabase
    .from('profiles')
    .select('id, nombres, apellidos, documento_numero, cargo, email')
    .eq('empresa_id', empresaAdminId)
    .eq('rol', 'trabajador')
    .eq('activo', true);

  if (!trabajadores?.length) {
    document.getElementById('cards-mes').innerHTML = '<p style="color:#888;">No hay trabajadores activos.</p>';
    return;
  }

  const userIds = trabajadores.map(t => t.id);

  const { data: enviosMes } = await supabase
    .from('envios_formulario')
    .select('usuario_id, aprobado, formularios(tipo)')
    .in('usuario_id', userIds)
    .eq('estado', 'completado')
    .gte('created_at', desde)
    .lt('created_at', hasta);

  const examenesMes = enviosMes?.filter(n => n.formularios?.tipo === 'examen') || [];
  const idsConActividad = new Set(examenesMes.map(n => n.usuario_id));
  const aprobados   = new Set(examenesMes.filter(n => n.aprobado).map(n => n.usuario_id));
  const conActividad = idsConActividad.size;
  const sinActividad = trabajadores.length - conActividad;
  const pct = Math.round((conActividad / trabajadores.length) * 100);

  const cards = document.getElementById('cards-mes');
  cards.innerHTML = `
    <div class="stat-card">
      <div class="stat-num">${trabajadores.length}</div>
      <div class="stat-label">Trabajadores activos</div>
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
      <div class="stat-label">Aprobaron (≥16)</div>
    </div>
    <div class="stat-card">
      <div class="stat-num">${pct}%</div>
      <div class="stat-label">Participación mensual</div>
    </div>
  `;

  // Tabla de sin actividad
  const sinAct = trabajadores.filter(t => !idsConActividad.has(t.id));
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
}

window.buscarTrabajadorDashboard = function () {
  const texto = document.getElementById('buscar-trabajador').value.toLowerCase().trim();
  const lista = document.getElementById('lista-sugerencias');
  document.getElementById('resultado-trabajador').style.display = 'none';

  if (!texto || texto.length < 2) { lista.innerHTML = ''; return; }

  cargarDatosDashboard().then(() => {
    const coinciden = todosTrabajadoresDash.filter(t =>
      (t.nombres || '').toLowerCase().includes(texto) ||
      (t.apellidos || '').toLowerCase().includes(texto)
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

  const { data: envios } = await supabase
    .from('envios_formulario')
    .select('id_curso, puntaje, formularios(tipo)')
    .eq('usuario_email', email)
    .eq('estado', 'completado');

  const notasMap = {};
  envios?.filter(n => n.formularios?.tipo === 'examen')
         .forEach(n => { notasMap[n.id_curso] = n.puntaje; });

  const completados = todosCursosDash.filter(c => notasMap[c.id] !== undefined);
  const pendientes  = todosCursosDash.filter(c => notasMap[c.id] === undefined);

  document.getElementById('trabajador-inicial').textContent =
    (trabajador.apellidos || '?')[0].toUpperCase();
  document.getElementById('trabajador-nombre').textContent =
    `${trabajador.apellidos} ${trabajador.nombres}`;
  document.getElementById('trabajador-info').textContent =
    `${trabajador.documento_numero || ''} · ${trabajador.cargo || ''}`;

  document.getElementById('cursos-completados').innerHTML = completados.length
    ? completados.map(c => {
        const nota = notasMap[c.id];
        const cls = nota >= 16 ? 'aprobado' : 'desaprobado';
        return `<div class="curso-item ${cls}"><span>${c.titulo}</span><strong>${nota}/20</strong></div>`;
      }).join('')
    : '<div style="color:#888; font-size:0.83rem;">Ninguno aún</div>';

  document.getElementById('cursos-pendientes').innerHTML = pendientes.length
    ? pendientes.map(c => `<div class="curso-item pendiente">${c.titulo}</div>`).join('')
    : '<div style="color:#28a745; font-size:0.83rem;">¡Todos completados!</div>';

  document.getElementById('resultado-trabajador').style.display = 'block';
};

// ── 3. Estado por curso ──
window.cargarEstadoCurso = async function () {
  const cursoId = parseInt(document.getElementById('select-curso-dashboard').value);
  if (!cursoId) { alert('Selecciona un curso.'); return; }

  await cargarDatosDashboard();

  const emails = todosTrabajadoresDash.map(t => t.email);
  const { data: envios } = await supabase
    .from('envios_formulario')
    .select('usuario_email, puntaje, formularios(tipo)')
    .eq('id_curso', cursoId)
    .in('usuario_email', emails)
    .eq('estado', 'completado');

  const notasMap = {};
  envios?.filter(n => n.formularios?.tipo === 'examen')
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