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
    ['', '', '', '', '', '', '']
  ]);
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

    const dnis = filasAsignacion.map(f => String(f[0]).trim());

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
      const dni      = String(f[0]).trim();
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
    .in('documento_numero', filasAsignacion.map(f => String(f[0]).trim()))
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
// 📝 GESTIÓN DE FORMULARIOS (EXAMEN / EFICACIA)
// ═══════════════════════════════════════════════

window.initSelectCursoForm = async function initSelectCursoForm() {
  const sel = document.getElementById('select-curso-form');
  if (!sel || sel.options.length > 1) return;
  const { data } = await supabase.from('cursos').select('id, titulo').eq('activo', true).order('titulo');
  data?.forEach(c => { sel.innerHTML += `<option value="${c.id}">${c.titulo}</option>`; });
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
  if (!confirm('¿Eliminar esta pregunta y todas sus opciones?')) return;
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
  if (!confirm('¿Eliminar esta pregunta?')) return;
  await supabase.from('opciones_pregunta').delete().eq('id_pregunta', preguntaId);
  await supabase.from('preguntas').delete().eq('id', preguntaId);
  cargarEncuestaGlobal();

// ═══════════════════════════════════════════════
// 🦺 PROGRAMA ANUAL SST
// ═══════════════════════════════════════════════

let filasProgramaSST = [];

window.initSelectorAnioSST = function initSelectorAnioSST() {
  const anioActual = new Date().getFullYear();
  ['sst-anio', 'ver-sst-anio'].forEach(id => {
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
  if (!confirm(`¿Eliminar todo el programa SST del año ${anio} para ANTAMINA?`)) return;
  const { error } = await supabase.from('programa_capacitaciones')
    .delete()
    .eq('empresa_id', empresaAdminId)
    .eq('anio', anio)
    .eq('sede', 'ANTAMINA');
  if (error) { alert('❌ ' + error.message); return; }
  document.getElementById('lista-programa-sst').innerHTML = '<p style="color:#888;">Programa eliminado.</p>';
};
};