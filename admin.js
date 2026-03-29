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

    document.getElementById('info-empresa').innerHTML = `
      <div style="background:#e8f5e8; padding:12px; border-radius:8px; 
                  border-left:4px solid #28a745; margin-bottom:15px;">
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
    .from("notas")
    .select("correo, nota, created_at, cursos(titulo)")
    .order("created_at", { ascending: false });

  if (error) {
    alert("❌ Error al cargar registros: " + error.message);
    return;
  }

  const tbody = document.querySelector("#tabla-registros tbody");
  tbody.innerHTML = "";

  data.forEach(reg => {
    const aprobado = reg.nota >= 16;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${reg.correo}</td>
      <td>${reg.cursos?.titulo || "Curso eliminado"}</td>
      <td>${reg.nota}</td>
      <td>${new Date(reg.created_at).toLocaleDateString()}</td>
      <td style="color: ${aprobado ? 'green' : 'red'}">
        ${aprobado ? "✅ Aprobado" : "❌ No aprobado"}
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

window.descargarPlantilla = function (e) {
  e.preventDefault();
  const XLSX = window.XLSX;
  const ws = XLSX.utils.aoa_to_sheet([
    ['DNI', 'Apellidos', 'Nombres', 'Email', 'Cargo', 'Telefono', 'Fecha Ingreso'],
    ['12345678', 'García López', 'Juan Carlos', 'juan@empresa.com', 'Operario', '999888777', '2024-01-15'],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Trabajadores');
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
    const email        = emailRaw || `${dni}@cvglobal-group.com`;
    const cargoNombre  = String(f[4]).trim();
    const telefono     = String(f[5]).trim();
    const fechaRaw = f[6];
    let fechaIngreso = '';
    if (fechaRaw instanceof Date) {
      fechaIngreso = fechaRaw.toISOString().split('T')[0];
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
    .select('email, nombres, apellidos, documento_numero, documento_tipo, cargo, empresa')
    .eq('empresa_id', empresaAdminId);

  if (errPerfiles) { alert('❌ Error al cargar perfiles: ' + errPerfiles.message); return; }

  const correosEmpresa = perfiles?.map(p => p.email) || [];
  if (correosEmpresa.length === 0) { alert('No hay trabajadores en tu empresa.'); return; }

  const perfilMap = {};
  perfiles.forEach(p => { perfilMap[p.email] = p; });

  // 2. Obtener notas del período para esos correos
  const { data: notas, error } = await supabase
    .from('notas')
    .select('correo, nota, id_curso, created_at, cursos(titulo)')
    .in('correo', correosEmpresa)
    .gte('created_at', desde)
    .lt('created_at', hasta)
    .order('created_at', { ascending: true });

  if (error) { alert('❌ Error: ' + error.message); return; }
  if (!notas || notas.length === 0) { alert('No hay registros de tu empresa para ese mes.'); return; }

  const mesesNombre = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                       'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

  const filas = [
    ['Apellidos', 'Nombres', 'Documento', 'Tipo Doc', 'Cargo', 'Empresa', 'Curso', 'Nota', 'Estado', 'Fecha']
  ];

  notas.forEach(r => {
    const p = perfilMap[r.correo];
    filas.push([
      p?.apellidos || '',
      p?.nombres || '',
      p?.documento_numero || r.correo,
      p?.documento_tipo || '',
      p?.cargo || '',
      p?.empresa || '',
      r.cursos?.titulo || '',
      r.nota,
      r.nota >= 16 ? 'Aprobado' : 'Desaprobado',
      new Date(r.created_at).toLocaleDateString('es-PE')
    ]);
  });

  const XLSX = window.XLSX;
  const ws = XLSX.utils.aoa_to_sheet(filas);
  ws['!cols'] = [20,20,15,10,20,20,30,8,12,12].map(w => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Notas');
  XLSX.writeFile(wb, `Reporte_Notas_${mesesNombre[mes-1]}_${anio}.xlsx`);
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
      <td style="padding:6px;">${u.apellidos || ''} ${u.nombres || ''}</td>
      <td style="padding:6px;">${u.documento_numero || ''}</td>
      <td style="padding:6px;">${u.email || ''}</td>
      <td style="padding:6px;">${u.cargo || ''}</td>
      <td style="padding:6px;">${u.telefono || ''}</td>
      <td style="padding:6px; text-align:center;">${u.activo ? '✅' : '❌'}</td>
      <td style="padding:6px;">
        <button onclick="abrirEditar('${u.id}')"
          style="padding:5px 10px; background:#002855; color:white; border:none; border-radius:4px; cursor:pointer;">
          ✏️ Editar
        </button>
        <button onclick="toggleActivo('${u.id}', ${u.activo})"
          style="padding:5px 10px; background:${u.activo ? '#dc3545' : '#28a745'}; color:white; border:none; border-radius:4px; cursor:pointer; margin-left:4px;">
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

  const { error } = await supabase
    .from('profiles')
    .update({ nombres, apellidos, email: emailFinal, telefono: telefono || null, documento_numero: documento, cargo_id, fecha_ingreso })
    .eq('id', id);

  if (error) { alert('❌ Error: ' + error.message); return; }

  alert('✅ Datos actualizados correctamente.');
  cerrarModal();
  cargarTrabajadores();
};

window.toggleActivo = async function (id, activo) {
  await supabase.from('profiles').update({ activo: !activo }).eq('id', id);
  cargarTrabajadores();
};