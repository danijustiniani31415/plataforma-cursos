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
        body: JSON.stringify({ dni, token: 'sk_14199.BlaC6DKIilEbkTdYzNav3K73rIZR5MS5' })
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

  if (!email || !dni || !nombres || !apellidos) {
    alert("❌ Completa los campos obligatorios: nombres, apellidos, documento y correo.");
    return;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
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
      email,
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

  alert(`✅ Usuario creado correctamente.\nContraseña inicial: ${dni}`);

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
    const aprobado = reg.nota >= 14;
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