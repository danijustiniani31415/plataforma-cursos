import { supabase } from './src/supabaseClient.js';
import { generarCertificadoPDF } from './certificado.js';
import { toast, alertToToast } from './toast.js';
const alert = alertToToast;

const loginSection            = document.getElementById('login-section');
const cursosDisponiblesSection = document.getElementById('cursos-disponibles');
const consultaSection         = document.getElementById('consulta-section');
const cursoSection            = document.getElementById('curso-section');
const certificadoSection      = document.getElementById('certificado-section');
const tituloCurso             = document.getElementById('titulo-curso');
const videoCurso              = document.getElementById('video-curso');

let cursoSeleccionado = null;
let usuarioActual     = null;
let pasoActual        = 0;
let pasosCurso        = [];
let formularios       = {};
let materialVisto     = false;
let cursosAprobados   = {}; // { [curso_id]: true }

// ═══════════════════════════════
// 🚀 INIT
// ═══════════════════════════════
window.addEventListener("DOMContentLoaded", async () => {
  const { data: { session } } = await supabase.auth.getSession();

  if (session) {
    const { data: perfil } = await supabase
      .from('profiles')
      .select('debe_cambiar_password')
      .eq('id', session.user.id)
      .single();

    if (perfil?.debe_cambiar_password) {
      window.location.href = 'cambiar-clave.html';
      return;
    }

    usuarioActual = session.user;
    document.getElementById('btn-logout').style.display = 'flex';
    loginSection.style.display = 'none';
    consultaSection.style.display = 'none';
    cursosDisponiblesSection.style.display = 'block';
    await Promise.all([cargarCursos(), verificarAdmin(session.user.id)]);
  }
});

// ═══════════════════════════════
// 🔐 LOGIN
// ═══════════════════════════════
async function login() {
  const email    = document.getElementById('email').value;
  const password = document.getElementById('password').value;

  const btnLogin = document.querySelector('#login-section .btn-primary');
  if (btnLogin) { btnLogin.disabled = true; btnLogin.textContent = 'Ingresando...'; }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (btnLogin) { btnLogin.disabled = false; btnLogin.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg> Ingresar'; }

  if (error) {
    alert("❌ Correo o contraseña incorrectos.");
    return;
  }

  const { data: perfil } = await supabase
    .from('profiles')
    .select('debe_cambiar_password')
    .eq('id', data.user.id)
    .single();

  if (perfil?.debe_cambiar_password) {
    window.location.href = 'cambiar-clave.html';
    return;
  }

  usuarioActual = data.user;
  document.getElementById('btn-logout').style.display = 'flex';
  loginSection.style.display = 'none';
  consultaSection.style.display = 'none';
  cursosDisponiblesSection.style.display = 'block';
  await Promise.all([cargarCursos(), verificarAdmin(data.user.id)]);
}
window.login = login;

// ═══════════════════════════════
// 🔓 LOGOUT
// ═══════════════════════════════
async function logout() {
  await supabase.auth.signOut();
  location.reload();
}
window.logout = logout;

// ═══════════════════════════════
// 👤 VERIFICAR ADMIN
// ═══════════════════════════════
async function verificarAdmin(userId) {
  const adminPanel = document.getElementById('admin-panel');
  adminPanel.style.display = 'none';

  const { data: perfil, error } = await supabase
    .from('profiles')
    .select('rol')
    .eq('id', userId)
    .single();

  if (error) return;

  if (perfil?.rol === 'admin' || perfil?.rol === 'superadmin') {
    adminPanel.style.display = 'block';

    if (perfil?.rol === 'superadmin') {
      adminPanel.innerHTML = `
        <div class="admin-panel-card">
          <div class="admin-panel-info">
            <h3>⚙️ Panel de Administración</h3>
            <p>Gestión de usuarios, cursos y reportes</p>
          </div>
          <div class="admin-panel-actions">
            <button onclick="window.location.href='admin.html'" class="btn-admin">
              🛠️ Admin
            </button>
            <button onclick="window.location.href='superadmin.html'" class="btn-admin btn-superadmin">
              ⚙️ Superadmin
            </button>
          </div>
        </div>
      `;
    } else {
      adminPanel.innerHTML = `
        <div class="admin-panel-card">
          <div class="admin-panel-info">
            <h3>🛠️ Panel de Administración</h3>
            <p>Gestión de usuarios y cursos</p>
          </div>
          <div class="admin-panel-actions">
            <button onclick="window.location.href='admin.html'" class="btn-admin">
              🛠️ Ir al Panel
            </button>
          </div>
        </div>
      `;
    }
  }
}

// ═══════════════════════════════
// 📚 CARGAR CURSOS
// ═══════════════════════════════
async function cargarCursos() {
  const { data: cursos, error } = await supabase
    .from('cursos')
    .select('*')
    .eq('activo', true)
    .order('titulo');

  if (error) { alert("❌ Error al cargar cursos: " + error.message); return; }

  // Perfil + envíos en paralelo (sin columnas opcionales que pueden no existir)
  const [{ data: perfil }, { data: envios }] = await Promise.all([
    supabase
      .from('profiles')
      .select('nombres, apellidos, empresa_id, empresas(nombre)')
      .eq('id', usuarioActual.id)
      .single(),
    supabase
      .from('envios_formulario')
      .select('id_curso, aprobado, created_at, formularios(tipo)')
      .eq('usuario_email', usuarioActual.email)
      .eq('estado', 'completado'),
  ]);

  const empresa = perfil?.empresas;

  if (empresa) {
    // Título
    const headerTitle = document.querySelector('.header-title');
    if (headerTitle) headerTitle.textContent = empresa.nombre || 'CV Global S.A.C.';

  }

  // Nombre del trabajador en el subtitle
  const headerSubtitle = document.querySelector('.header-subtitle');
  if (headerSubtitle && perfil?.nombres) {
    headerSubtitle.textContent = `${perfil.nombres} ${perfil.apellidos || ''} · ${empresa?.nombre || ''}`;
  }

  // Por curso: saber si aprobó la evaluación final y cuándo.
  // La evaluación puede ser de tipo 'examen' o 'eficacia' (algunos cursos solo tienen eficacia).
  const estadoCurso = {};
  (envios || []).forEach(e => {
    const esEvaluacion = e.formularios?.tipo === 'examen' || e.formularios?.tipo === 'eficacia';
    if (esEvaluacion && e.aprobado) {
      if (!estadoCurso[e.id_curso] || new Date(e.created_at) > new Date(estadoCurso[e.id_curso].fecha)) {
        estadoCurso[e.id_curso] = { aprobado: true, fecha: e.created_at };
      }
    }
  });
  cursosAprobados = estadoCurso;

  const now   = new Date();
  const in30  = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const listaCursos = document.getElementById('lista-cursos');
  listaCursos.innerHTML = '';

  // Contador para el título
  const completados = cursos.filter(c => estadoCurso[c.id]?.aprobado).length;
  const secDesc = document.querySelector('#cursos-disponibles .section-desc');
  if (secDesc) secDesc.textContent = `${completados} de ${cursos.length} cursos completados`;

  cursos.forEach(curso => {
    const est = estadoCurso[curso.id];
    let estadoLabel = '', estadoClass = '', icono = '📚';

    if (est?.aprobado) {
      const emision = new Date(est.fecha);
      const venc    = new Date(emision);
      venc.setMonth(venc.getMonth() + (curso.vigencia_meses || 12));
      if (venc < now) {
        estadoLabel = 'Cert. vencido'; estadoClass = 'estado-vencido'; icono = '⚠️';
      } else if (venc < in30) {
        estadoLabel = 'Por vencer'; estadoClass = 'estado-por-vencer'; icono = '🔔';
      } else {
        estadoLabel = 'Completado'; estadoClass = 'estado-completado'; icono = '✅';
      }
    } else {
      estadoLabel = 'Pendiente'; estadoClass = 'estado-pendiente'; icono = '📋';
    }

    const btn = document.createElement('button');
    btn.className = 'curso-card';
    btn.innerHTML = `
      <div class="curso-card-icon">${icono}</div>
      <div class="curso-card-body">
        <div class="curso-card-titulo">${curso.titulo}</div>
        <div class="curso-card-meta">
          ${curso.duracion ? `<span>⏱ ${curso.duracion}h</span>` : ''}
          <span class="curso-estado ${estadoClass}">${estadoLabel}</span>
        </div>
      </div>
      <div class="curso-card-arrow">›</div>
    `;
    btn.onclick = () => mostrarCurso(curso);
    listaCursos.appendChild(btn);
  });

  await cargarGamificacion(perfil);
}

// ═══════════════════════════════
// 📋 CONSTRUIR PASOS
// ═══════════════════════════════
async function construirPasos(curso) {
  pasosCurso = [];
  formularios = {};
  materialVisto = false;
  window.videosVistos = {};

  if (curso.url_material) pasosCurso.push('material');

  const { data: videos } = await supabase
    .from('videos_curso')
    .select('*')
    .eq('id_curso', curso.id)
    .eq('activo', true)
    .order('orden');

  if (videos && videos.length > 0) {
    videos.forEach(v => pasosCurso.push({ tipo: 'video', ...v }));
  }

  pasosCurso.push('asistencia');

  const { data: encuesta } = await supabase
    .from('formularios')
    .select('*')
    .eq('tipo', 'encuesta')
    .eq('activo', true)
    .is('id_curso', null)
    .single();

  if (encuesta) {
    formularios['encuesta'] = encuesta;
    pasosCurso.push('encuesta');
  }

  const { data: formsCurso } = await supabase
    .from('formularios')
    .select('*')
    .eq('activo', true)
    .eq('id_curso', curso.id);

  ['examen', 'eficacia'].forEach(tipo => {
    const form = formsCurso?.find(f => f.tipo === tipo);
    if (form) {
      formularios[tipo] = form;
      pasosCurso.push(tipo);
    }
  });
}

// ═══════════════════════════════
// 🎯 MOSTRAR CURSO
// ═══════════════════════════════
async function mostrarCurso(curso) {
  cursoSeleccionado = curso;
  pasoActual = 0;

  tituloCurso.textContent = curso.titulo;
  cursoSection.style.display = 'block';
  cursosDisponiblesSection.style.display = 'none';
  // Mostrar certificado si ya aprobó este curso anteriormente
  certificadoSection.style.display = cursosAprobados[curso.id]?.aprobado ? 'block' : 'none';

  await construirPasos(curso);
  await mostrarPasoActual();
}

// ═══════════════════════════════
// 📄 MOSTRAR PASO ACTUAL
// ═══════════════════════════════
async function mostrarPasoActual() {
  const paso    = pasosCurso[pasoActual];
  const tipoPaso = typeof paso === 'object' ? paso.tipo : paso;
  let contenidoHTML      = '';
  let tituloPaso         = typeof paso === 'object' ? paso.titulo : obtenerTituloPaso(paso);
  let siguienteHabilitado = true;

  switch (tipoPaso) {

    // ── MATERIAL ──────────────────
    case 'material': {
      siguienteHabilitado = materialVisto;
      const url = cursoSeleccionado.url_material;
      const esOneDrive = url.includes('1drv.ms') || url.includes('onedrive.live.com');
      const esSupabase = url.includes('supabase.co');
      // PDFs y archivos de Supabase se embeben directo; Office/OneDrive usan el visor de Microsoft
      const srcVisor = (esSupabase || url.toLowerCase().endsWith('.pdf'))
        ? url
        : esOneDrive
          ? url
          : "https://view.officeapps.live.com/op/embed.aspx?src=" + encodeURIComponent(url);

      contenidoHTML = `
        <div class="material-cta">
          <a href="${url}" target="_blank" id="link-material-externo">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            Abrir material
          </a>
          <span class="material-cta-text">Abre el documento para continuar</span>
        </div>
        <iframe id="iframe-material" src="${srcVisor}" width="100%" height="500px"
          style="border:1px solid var(--border); border-radius:var(--radius-md);"
          frameborder="0" allowfullscreen>
        </iframe>
        ${!materialVisto ? `<div class="material-hint">⚠️ Visualiza el material para habilitar el siguiente paso</div>` : ''}
      `;
      break;
    }

    // ── VIDEO ──────────────────────
    case 'video': {
      const videoId = paso.id;
      if (!window.videosVistos) window.videosVistos = {};
      const esteVideoVisto = window.videosVistos[videoId] || false;
      siguienteHabilitado = esteVideoVisto;
      const urlVideo = paso.url;
      let videoEmbed = '';

      if (urlVideo.includes('youtube') || urlVideo.includes('youtu.be')) {
        const videoUrl = urlVideo.replace("watch?v=", "embed/").replace("youtu.be/", "youtube.com/embed/");
        videoEmbed = `
          <div class="video-wrap">
            <iframe width="100%" height="360" src="${videoUrl}" frameborder="0"
              allowfullscreen onload="marcarVideoVisto(${videoId})"></iframe>
          </div>`;
      } else if (urlVideo.includes('drive.google.com')) {
        const googleUrl = urlVideo.replace('/view', '/preview');
        videoEmbed = `
          <div class="video-wrap">
            <iframe src="${googleUrl}" width="100%" height="360"
              frameborder="0" allowfullscreen onload="marcarVideoVisto(${videoId})"></iframe>
          </div>`;
      } else if (urlVideo.includes('mp4') || urlVideo.includes('webm') || urlVideo.endsWith('.mp4')) {
        videoEmbed = `
          <div class="video-wrap">
            <video width="100%" height="360" controls onplay="marcarVideoVisto(${videoId})">
              <source src="${urlVideo}" type="video/mp4">
            </video>
          </div>`;
      } else {
        videoEmbed = `<p style="text-align:center; padding:20px;">🔗 <a href="${urlVideo}" target="_blank" onclick="marcarVideoVisto(${videoId})">Abrir video externo</a></p>`;
      }

      contenidoHTML = `
        ${videoEmbed}
        ${!esteVideoVisto ? `<div class="material-hint">⚠️ Inicia el video para habilitar el siguiente paso</div>` : ''}
      `;
      break;
    }

    // ── ASISTENCIA ─────────────────
    case 'asistencia': {
      if (usuarioActual) {
        const { data: yaExiste } = await supabase
          .from('asistencias')
          .select('id')
          .eq('usuario_id', usuarioActual.id)
          .eq('curso_id', cursoSeleccionado.id)
          .maybeSingle();

        if (!yaExiste) {
          await supabase.from('asistencias').insert([{
            email:      usuarioActual.email,
            usuario_id: usuarioActual.id,
            curso_id:   cursoSeleccionado.id
          }]);
        }
      }

      contenidoHTML = `
        <div class="asistencia-card animate-in">
          <div class="asistencia-icon">✅</div>
          <div class="asistencia-title">¡Asistencia Registrada!</div>
          <p class="asistencia-desc">
            Tu asistencia al curso <strong>${cursoSeleccionado.titulo}</strong> 
            ha sido registrada correctamente.
          </p>
          <p style="margin-top:12px; font-size:0.82rem; color:var(--text-muted);">
            Haz clic en <strong>Siguiente</strong> para continuar con la encuesta
          </p>
        </div>
      `;
      break;
    }

    // ── ENCUESTA / EXAMEN / EFICACIA ───
    case 'encuesta':
    case 'examen':
    case 'eficacia': {
      const formulario = formularios[tipoPaso];

      if (!formulario) {
        contenidoHTML = `<div style="text-align:center; padding:40px; color:var(--text-muted);">
          <p>❌ No hay formulario disponible para este paso.</p>
        </div>`;
        break;
      }

      const { data: envioExistente } = await supabase
        .from('envios_formulario')
        .select('id, estado, puntaje, porcentaje, aprobado')
        .eq('id_formulario', formulario.id)
        .eq('usuario_id', usuarioActual.id)
        .eq('id_curso', cursoSeleccionado.id)
        .eq('estado', 'completado')
        .maybeSingle();

      if (envioExistente) {
        const aprobado = envioExistente.aprobado;
        contenidoHTML = `
          <div class="completado-card ${!aprobado && tipoPaso !== 'encuesta' ? 'reprobado' : ''} animate-in">
            <span class="completado-badge">${tipoPaso === 'encuesta' ? '📋' : aprobado ? '🎉' : '😔'}</span>
            <div class="completado-title">
              ${tipoPaso === 'encuesta' ? 'Encuesta completada' : aprobado ? '¡Aprobado!' : 'No aprobado'}
            </div>
            ${tipoPaso !== 'encuesta' ? `
              <div class="completado-nota">${envioExistente.puntaje?.toFixed(1)}<span style="font-size:1rem; font-weight:400; color:var(--text-muted)">/20</span></div>
              <div class="badge ${aprobado ? 'badge-success' : 'badge-danger'}" style="margin:0 auto;">
                ${envioExistente.porcentaje?.toFixed(1)}%
              </div>
              ${!aprobado ? `
                <button onclick="reiniciarFormulario('${tipoPaso}')"
                  style="margin-top:16px; padding:10px 20px; background:var(--navy); color:white; border:none; border-radius:var(--radius-sm); cursor:pointer; font-size:0.88rem; font-weight:500; width:auto;">
                  🔄 Volver a intentar
                </button>` : ''}
            ` : ''}
          </div>
        `;
        break;
      }

      const { data: preguntas } = await supabase
        .from('preguntas')
        .select('*, opciones_pregunta(*)')
        .eq('id_formulario', formulario.id)
        .order('orden');

      siguienteHabilitado = false;

      const colores = {
        encuesta: { clase: 'encuesta', color: 'var(--navy)' },
        examen:   { clase: 'examen',   color: 'var(--success)' },
        eficacia: { clase: 'eficacia', color: '#6f42c1' }
      };
      const col = colores[tipoPaso];

      const preguntasHTML = preguntas?.map((p, idx) => {
        const opciones = p.opciones_pregunta?.sort((a, b) => a.orden - b.orden);

        if (tipoPaso === 'encuesta') {
          return `
            <div class="pregunta-card ${col.clase}">
              <div class="pregunta-texto">${idx + 1}. ${p.pregunta}</div>
              <div style="overflow-x:auto;">
                <table class="likert-table">
                  <thead>
                    <tr>
                      <th style="width:35%;"></th>
                      ${opciones?.map(o => `<th>${o.opcion}</th>`).join('')}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Tu respuesta</td>
                      ${opciones?.map(o => `
                        <td>
                          <input type="radio" name="pregunta_${p.id}" value="${o.id}"
                                 onchange="verificarFormularioCompleto('${tipoPaso}')" />
                        </td>
                      `).join('')}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          `;
        } else {
          return `
            <div class="pregunta-card ${col.clase}">
              <div class="pregunta-texto">${idx + 1}. ${p.pregunta}</div>
              ${opciones?.map(o => `
                <label class="opcion-label">
                  <input type="radio" name="pregunta_${p.id}" value="${o.id}"
                         onchange="verificarFormularioCompleto('${tipoPaso}')" />
                  ${o.opcion}
                </label>
              `).join('')}
            </div>
          `;
        }
      }).join('');

      contenidoHTML = `
        <div class="animate-in">
          <div class="form-header-bar ${col.clase}" style="border-radius:var(--radius-md); padding:16px 20px; margin-bottom:16px;">
            <div class="form-header-title">${formulario.titulo}</div>
            ${formulario.descripcion ? `<div class="form-header-desc">${formulario.descripcion}</div>` : ''}
          </div>
          <div class="form-info-banner">
            📌 Responde todas las preguntas para continuar.
            ${tipoPaso !== 'encuesta' ? ' Nota mínima para aprobar: <strong>16/20</strong>' : ''}
          </div>
          <div id="preguntas-${tipoPaso}">
            ${preguntasHTML}
          </div>
          <div style="margin-top:16px;">
            <button id="btn-enviar-${tipoPaso}" onclick="enviarFormulario('${tipoPaso}')"
              class="btn-enviar-form btn-enviar-${tipoPaso}"
              style="display:none;">
              ✅ Enviar
            </button>
            <div id="msg-${tipoPaso}" class="hint-responde">
              ⚠️ Responde todas las preguntas para continuar
            </div>
          </div>
        </div>
      `;
      break;
    }
  }

  // ── BARRA DE PROGRESO ──────────
  const progreso = Math.round(((pasoActual + 1) / pasosCurso.length) * 100);

  // ── NAVEGACIÓN — solo arriba ───
  // Indicadores de pasos
  const pasosIndicadores = pasosCurso.map((p, i) => {
    const done    = i < pasoActual;
    const current = i === pasoActual;
    return `<div class="paso-dot ${done ? 'paso-dot-done' : current ? 'paso-dot-current' : ''}"></div>`;
  }).join('');

  const navHTML = `
    <div class="nav-sticky">
      <div class="progress-bar-wrap">
        <div class="progress-bar-fill" style="width:${progreso}%"></div>
      </div>
      <div class="nav-steps">
        <button onclick="navegarAtras()" class="btn-nav btn-nav-prev">
          ‹ ${pasoActual === 0 ? 'Cursos' : 'Atrás'}
        </button>
        <div class="nav-step-info">
          <div class="nav-step-title">${tituloPaso}</div>
          <div class="pasos-dots">${pasosIndicadores}</div>
        </div>
        <button id="btn-siguiente-paso"
          onclick="${pasoActual === pasosCurso.length - 1 ? 'volverACursos()' : 'siguientePaso()'}"
          class="btn-nav btn-nav-next"
          ${!siguienteHabilitado && pasoActual !== pasosCurso.length - 1 ? 'disabled' : ''}>
          ${pasoActual === pasosCurso.length - 1 ? '✓ Fin' : 'Siguiente ›'}
        </button>
      </div>
    </div>
  `;

  videoCurso.innerHTML = `
    <div class="step-content">
      ${navHTML}
      <div class="step-content-inner">${contenidoHTML}</div>
    </div>
  `;
  // Adjuntar onload del iframe por JS para evitar error de módulo ES
  const iframeMaterial = document.getElementById('iframe-material');
  if (iframeMaterial) iframeMaterial.addEventListener('load', () => marcarMaterialVisto());
  const linkMaterial = document.getElementById('link-material-externo');
  if (linkMaterial) linkMaterial.addEventListener('click', () => marcarMaterialVisto());
  certificadoSection.style.display = cursosAprobados[cursoSeleccionado?.id]?.aprobado ? 'block' : 'none';
}

// ═══════════════════════════════
// ✅ MARCAR MATERIAL VISTO
// ═══════════════════════════════
window.marcarMaterialVisto = function () {
  if (!materialVisto) {
    materialVisto = true;
    const btn = document.getElementById('btn-siguiente-paso');
    if (btn) { btn.disabled = false; }
    document.querySelectorAll('.material-hint').forEach(el => el.remove());
  }
};

// ═══════════════════════════════
// ✅ MARCAR VIDEO VISTO
// ═══════════════════════════════
window.marcarVideoVisto = function (videoId) {
  if (!window.videosVistos) window.videosVistos = {};
  if (!window.videosVistos[videoId]) {
    window.videosVistos[videoId] = true;
    const btn = document.getElementById('btn-siguiente-paso');
    if (btn) { btn.disabled = false; }
    document.querySelectorAll('.material-hint').forEach(el => el.remove());
  }
};

// ═══════════════════════════════
// 🔍 VERIFICAR FORMULARIO
// ═══════════════════════════════
window.verificarFormularioCompleto = function (tipoPaso) {
  const container = document.getElementById(`preguntas-${tipoPaso}`);
  if (!container) return;

  const inputs = container.querySelectorAll('[name^="pregunta_"]');
  const nombresUnicos = [...new Set([...inputs].map(i => i.name))];
  const todasRespondidas = nombresUnicos.every(nombre =>
    container.querySelector(`[name="${nombre}"]:checked`)
  );

  const btnEnviar = document.getElementById(`btn-enviar-${tipoPaso}`);
  const msgEl     = document.getElementById(`msg-${tipoPaso}`);

  if (todasRespondidas) {
    if (btnEnviar) btnEnviar.style.display = 'block';
    if (msgEl)     msgEl.style.display = 'none';
  }
};

// ═══════════════════════════════
// 📤 ENVIAR FORMULARIO
// ═══════════════════════════════
window.enviarFormulario = async function (tipoPaso) {
  const formulario = formularios[tipoPaso];
  if (!formulario) return;

  const { data: nuevoEnvio, error: envioError } = await supabase
    .from('envios_formulario')
    .insert([{
      id_formulario: formulario.id,
      usuario_id:    usuarioActual.id,
      usuario_email: usuarioActual.email,
      id_curso:      cursoSeleccionado.id,
      estado:        'completado'
    }])
    .select()
    .single();

  if (envioError) {
    alert('❌ Error al guardar: ' + envioError.message);
    return;
  }

  const envioId = nuevoEnvio.id;

  const { data: preguntas } = await supabase
    .from('preguntas')
    .select('*, opciones_pregunta(*)')
    .eq('id_formulario', formulario.id);

  let puntajeTotal  = 0;
  let puntajeMaximo = 0;
  const respuestas  = [];

  preguntas?.forEach(p => {
    const seleccionado = document.querySelector(`[name="pregunta_${p.id}"]:checked`);
    if (!seleccionado) return;

    if (tipoPaso === 'encuesta') {
      const opcionId = parseInt(seleccionado.value);
      const opcion   = p.opciones_pregunta?.find(o => o.id === opcionId);
      if (opcion?.puntaje != null) puntajeTotal += opcion.puntaje;
      puntajeMaximo += 5; // escala Likert máximo 5
      respuestas.push({
        id_envio: envioId, id_formulario: formulario.id,
        id_pregunta: p.id, respuesta_texto: opcion?.opcion || ''
      });
    } else {
      const opcionId = parseInt(seleccionado.value);
      const opcion   = p.opciones_pregunta?.find(o => o.id === opcionId);
      if (opcion?.es_correcta) puntajeTotal += (p.puntaje || 1);
      puntajeMaximo += (p.puntaje || 1);
      respuestas.push({
        id_envio: envioId, id_formulario: formulario.id,
        id_pregunta: p.id, respuesta_texto: opcion?.opcion || ''
      });
    }
  });

  const porcentaje  = puntajeMaximo > 0 ? (puntajeTotal / puntajeMaximo) * 100 : 100;
  const notaSobre20 = puntajeMaximo > 0 ? (puntajeTotal / puntajeMaximo) * 20  : 20;
  const aprobado    = tipoPaso === 'encuesta' ? true : notaSobre20 >= 16;

  await supabase.from('respuestas_formulario').insert(respuestas);
  await supabase.from('envios_formulario').update({
    puntaje:    parseFloat(notaSobre20.toFixed(2)),
    porcentaje: parseFloat(porcentaje.toFixed(2)),
    aprobado
  }).eq('id', envioId);

  if (tipoPaso === 'encuesta') {
    toast('¡Gracias por tu opinión!', 'success');
  } else if (!aprobado) {
    toast(`No aprobaste — Nota: ${notaSobre20.toFixed(1)}/20. Necesitas 16 para aprobar.`, 'error', 5000);
  } else {
    toast(`¡Aprobaste! Nota: ${notaSobre20.toFixed(1)}/20 🎉`, 'success', 4000);
    // ── Gamificación ──
    await otorgarXP(usuarioActual.id, 100);
    // Bonus primer intento: contar todos los envíos para este formulario+curso
    const { count: intentos } = await supabase
      .from('envios_formulario')
      .select('id', { count: 'exact', head: true })
      .eq('id_formulario', formulario.id)
      .eq('usuario_id', usuarioActual.id)
      .eq('id_curso', cursoSeleccionado.id);
    if (intentos === 1) {
      await otorgarXP(usuarioActual.id, 50);
      await otorgarBadgePrimerIntento(usuarioActual.id);
    }
    await verificarBadges(usuarioActual.id);
  }

  await mostrarPasoActual();

  if (tipoPaso === 'encuesta' || aprobado) {
    const btn = document.getElementById('btn-siguiente-paso');
    if (btn) { btn.disabled = false; }

    if (pasoActual === pasosCurso.length - 1 && tipoPaso === 'eficacia') {
      cursosAprobados[cursoSeleccionado.id] = { aprobado: true };
      certificadoSection.style.display = 'block';
    }
  }
};

// ═══════════════════════════════
// 🔄 REINICIAR FORMULARIO
// ═══════════════════════════════
window.reiniciarFormulario = async function (tipoPaso) {
  const formulario = formularios[tipoPaso];
  if (!formulario) return;

  await supabase
    .from('envios_formulario')
    .update({ estado: 'anulado' })
    .eq('id_formulario', formulario.id)
    .eq('usuario_id', usuarioActual.id)
    .eq('id_curso', cursoSeleccionado.id)
    .eq('estado', 'completado');

  await mostrarPasoActual();
};

// ═══════════════════════════════
// 🧭 NAVEGACIÓN
// ═══════════════════════════════
function pasoAnterior() {
  if (pasoActual > 0) { pasoActual--; mostrarPasoActual(); }
}

function siguientePaso() {
  if (pasoActual < pasosCurso.length - 1) { pasoActual++; mostrarPasoActual(); }
}

window.siguientePaso = siguientePaso;
window.pasoAnterior  = pasoAnterior;

// ═══════════════════════════════
// 🔄 VOLVER A CURSOS
// ═══════════════════════════════
function volverACursos() {
  cursoSection.style.display = 'none';
  cursosDisponiblesSection.style.display = 'block';
  pasoActual = 0;
  cursoSeleccionado = null;
  window.scrollTo(0, 0);
}
window.volverACursos = volverACursos;

// ═══════════════════════════════
// 🎓 GENERAR CERTIFICADO
// ═══════════════════════════════
async function generarCertificado() {
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;

  if (!user || !cursoSeleccionado) {
    alert("❌ Usuario o curso no válido");
    return;
  }

  const { data: envioExamen } = await supabase
    .from('envios_formulario')
    .select('puntaje')
    .eq('usuario_id', user.id)
    .eq('id_curso', cursoSeleccionado.id)
    .eq('estado', 'completado')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  const nota = envioExamen?.puntaje || 0;
  await generarCertificadoPDF(cursoSeleccionado, nota);
}
window.generarCertificado = generarCertificado;

// ═══════════════════════════════
// 🎮 GAMIFICACIÓN
// ═══════════════════════════════
const NIVELES = [
  { nivel: 1, nombre: 'Aprendiz',      min: 0,    color: '#64748b' },
  { nivel: 2, nombre: 'Practicante',   min: 150,  color: '#0ea5e9' },
  { nivel: 3, nombre: 'Competente',    min: 350,  color: '#10b981' },
  { nivel: 4, nombre: 'Avanzado SST',  min: 600,  color: '#f59e0b' },
  { nivel: 5, nombre: 'Experto SST',   min: 1000, color: '#8b5cf6' },
];

const BADGES_DEF = {
  primer_curso:   { emoji: '🥇', nombre: 'Primer Curso',   desc: 'Completaste tu primer curso' },
  primer_intento: { emoji: '💡', nombre: 'Sin Errores',     desc: 'Aprobaste un examen al primer intento' },
  velocista:      { emoji: '⚡', nombre: 'Velocista',       desc: 'Aprobaste 3 cursos o más' },
  completista:    { emoji: '🏆', nombre: 'SST Champion',    desc: 'Completaste todos los cursos disponibles' },
};

function calcularNivel(xp) {
  let actual = NIVELES[0];
  for (const n of NIVELES) {
    if (xp >= n.min) actual = n;
    else break;
  }
  const idx = NIVELES.indexOf(actual);
  const siguiente = NIVELES[idx + 1];
  const progreso = siguiente
    ? Math.round(((xp - actual.min) / (siguiente.min - actual.min)) * 100)
    : 100;
  return { ...actual, siguiente, progreso, xp };
}

async function otorgarXP(userId, cantidad) {
  const { data: perfil } = await supabase.from('profiles').select('xp').eq('id', userId).single();
  const xpNuevo = (perfil?.xp || 0) + cantidad;
  const nivelNuevo = calcularNivel(xpNuevo).nivel;
  await supabase.from('profiles').update({ xp: xpNuevo, nivel: nivelNuevo }).eq('id', userId);
  return xpNuevo;
}

async function verificarBadges(userId) {
  const { data: yaGanados } = await supabase
    .from('badges_usuario').select('badge_code').eq('usuario_id', userId);
  const ganados = new Set((yaGanados || []).map(b => b.badge_code));

  const { count: examenes } = await supabase
    .from('envios_formulario')
    .select('id', { count: 'exact', head: true })
    .eq('usuario_id', userId)
    .eq('estado', 'completado')
    .eq('aprobado', true);

  const { count: totalCursos } = await supabase
    .from('cursos').select('id', { count: 'exact', head: true }).eq('activo', true);

  const nuevos = [];
  if (!ganados.has('primer_curso') && examenes >= 1)  nuevos.push('primer_curso');
  if (!ganados.has('velocista')    && examenes >= 3)  nuevos.push('velocista');
  if (!ganados.has('completista')  && totalCursos > 0 && examenes >= totalCursos) nuevos.push('completista');

  if (nuevos.length > 0) {
    await supabase.from('badges_usuario').insert(
      nuevos.map(code => ({ usuario_id: userId, badge_code: code }))
    );
    nuevos.forEach(code => mostrarNotifBadge(BADGES_DEF[code]));
  }
}

async function otorgarBadgePrimerIntento(userId) {
  const { data: ya } = await supabase.from('badges_usuario')
    .select('id').eq('usuario_id', userId).eq('badge_code', 'primer_intento').maybeSingle();
  if (!ya) {
    await supabase.from('badges_usuario').insert({ usuario_id: userId, badge_code: 'primer_intento' });
    mostrarNotifBadge(BADGES_DEF['primer_intento']);
  }
}

function mostrarNotifBadge(badge) {
  if (!badge) return;
  const notif = document.createElement('div');
  notif.style.cssText = `
    position:fixed; bottom:80px; left:50%; transform:translateX(-50%);
    background:#1e3a5f; color:white; padding:14px 24px; border-radius:50px;
    box-shadow:0 8px 32px rgba(0,0,0,0.25); font-size:0.88rem; font-weight:600;
    display:flex; align-items:center; gap:10px; z-index:9999;
    animation:slideUp 0.4s ease; white-space:nowrap;
  `;
  notif.innerHTML = `<span style="font-size:1.4rem">${badge.emoji}</span> ¡Insignia desbloqueada! <strong>${badge.nombre}</strong>`;
  document.body.appendChild(notif);
  setTimeout(() => { notif.style.opacity = '0'; notif.style.transition = 'opacity 0.5s'; }, 3500);
  setTimeout(() => notif.remove(), 4100);
}

async function cargarGamificacion(perfilBase) {
  const widget = document.getElementById('gamificacion-widget');
  if (!widget) return;

  // Reusar perfil ya cargado; si no trae xp, hacer fetch mínimo
  let xp = perfilBase?.xp;
  let empresa_id = perfilBase?.empresa_id;
  if (xp == null) {
    const { data: p } = await supabase
      .from('profiles').select('xp, empresa_id').eq('id', usuarioActual.id).single();
    xp = p?.xp || 0;
    empresa_id = p?.empresa_id;
  }

  const nivelInfo = calcularNivel(xp);

  const { data: badges } = await supabase
    .from('badges_usuario').select('badge_code').eq('usuario_id', usuarioActual.id);

  let rankingHTML = '';
  if (empresa_id) {
    const { data: ranking } = await supabase
      .from('profiles').select('id, xp').eq('empresa_id', empresa_id).order('xp', { ascending: false });
    if (ranking) {
      const pos = ranking.findIndex(r => r.id === usuarioActual.id) + 1;
      rankingHTML = `<div class="gami-ranking">🏅 Posición <strong>#${pos}</strong> de ${ranking.length} en tu empresa</div>`;
    }
  }

  const badgesHTML = (badges || []).map(b => {
    const def = BADGES_DEF[b.badge_code];
    return def ? `<span class="gami-badge" title="${def.desc}">${def.emoji} ${def.nombre}</span>` : '';
  }).join('');

  widget.innerHTML = `
    <div class="gami-card">
      <div class="gami-header">
        <div class="gami-nivel" style="color:${nivelInfo.color}">⚡ Nivel ${nivelInfo.nivel} · ${nivelInfo.nombre}</div>
        <div class="gami-xp">${xp} XP</div>
      </div>
      <div class="gami-bar-wrap">
        <div class="gami-bar-fill" style="width:${nivelInfo.progreso}%; background:${nivelInfo.color}"></div>
      </div>
      ${nivelInfo.siguiente
        ? `<div class="gami-bar-label">${xp} / ${nivelInfo.siguiente.min} XP para ${nivelInfo.siguiente.nombre}</div>`
        : '<div class="gami-bar-label">🏆 Nivel máximo alcanzado</div>'}
      ${rankingHTML}
      ${badgesHTML ? `<div class="gami-badges">${badgesHTML}</div>` : ''}
    </div>
  `;
  widget.style.display = 'block';
}

// ═══════════════════════════════
// 🔤 HELPER TÍTULOS
// ═══════════════════════════════
function obtenerTituloPaso(paso) {
  const titulos = {
    'material':   '📚 Material',
    'video':      '🎥 Video',
    'asistencia': '✅ Asistencia',
    'encuesta':   '📋 Encuesta',
    'examen':     '📝 Evaluación',
    'eficacia':   '🎯 Eficacia'
  };
  return titulos[paso] || paso;
}
window.navegarAtras = function() {
  if (pasoActual > 0) {
    pasoAnterior();
  } else {
    volverACursos();
  }
};
// ═══════════════════════════════
// 🔍 CONSULTA PÚBLICA POR DNI
// ═══════════════════════════════
window.consultarEstado = async function () {
  const dni = document.getElementById('consulta-dni').value.trim();
  const resultado = document.getElementById('consulta-resultado');

  if (!dni) {
    resultado.innerHTML = `<div class="consulta-error">❌ Ingresa tu DNI.</div>`;
    return;
  }

  resultado.innerHTML = `<div class="consulta-cargando">Buscando...</div>`;

  // Buscar perfil por DNI — se intenta con y sin cero inicial para tolerar ambos formatos
  const dniVariantes = [...new Set([dni, dni.padStart(8, '0'), String(parseInt(dni, 10))])];
  const { data: perfiles, error } = await supabase
    .from('profiles')
    .select('id, email, nombres, apellidos, empresas(nombre)')
    .in('documento_numero', dniVariantes);

  const perfil = perfiles?.[0] ?? null;

  if (error || !perfil) {
    resultado.innerHTML = `<div class="consulta-error">❌ No se encontró ningún trabajador con ese DNI.<br><small style="color:#999">Si el problema persiste contacta a tu administrador.</small></div>`;
    return;
  }

  // Traer todos los cursos activos
  const { data: cursos, error: errorCursos } = await supabase
    .from('cursos')
    .select('id, titulo')
    .eq('activo', true)
    .order('titulo');

  if (errorCursos) {
    resultado.innerHTML = `<div class="consulta-error">❌ Error al cargar cursos: ${errorCursos.message}</div>`;
    return;
  }

  // Traer el examen aprobado más reciente por curso
  // Se filtra por email (igual que cargarCursos al estar logueado)
  const emailBusqueda = perfil.email || '';
  const { data: envios } = emailBusqueda ? await supabase
    .from('envios_formulario')
    .select('id_curso, aprobado, created_at, formularios(tipo)')
    .eq('usuario_email', emailBusqueda)
    .eq('estado', 'completado')
    .eq('aprobado', true)
    .order('created_at', { ascending: false })
  : { data: [] };

  // Mapa: id_curso → fecha más reciente de aprobación de la evaluación final
  // (puede ser 'examen' o 'eficacia' según el curso)
  const envioMap = {};
  envios?.forEach(e => {
    const esEvaluacion = e.formularios?.tipo === 'examen' || e.formularios?.tipo === 'eficacia';
    if (esEvaluacion && !envioMap[e.id_curso]) {
      envioMap[e.id_curso] = e.created_at;
    }
  });

  // También revisar tabla certificados (cursos completados antes de ocultar el botón)
  const { data: certificados } = await supabase
    .from('certificados')
    .select('curso_id, created_at')
    .eq('usuario_id', perfil.id);

  const certMap = {};
  certificados?.forEach(c => { certMap[c.curso_id] = c.created_at; });

  const nombreCompleto = `${perfil.apellidos || ''} ${perfil.nombres || ''}`.trim();
  const empresa = perfil.empresas?.nombre || '—';

  function formatFecha(iso) {
    return new Date(iso).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  let filasHTML = '';
  for (const curso of (cursos || [])) {
    // Fecha de realización: preferir certificado si existe, sino envío
    const fechaRaw = certMap[curso.id] || envioMap[curso.id];
    let estadoHTML = '';

    if (fechaRaw) {
      const fechaRealizacion = new Date(fechaRaw);
      const vencimiento = new Date(fechaRealizacion);
      vencimiento.setMonth(vencimiento.getMonth() + 12);
      const vencido = vencimiento < new Date();
      const estadoClass = vencido ? 'estado-vencido' : 'estado-aprobado';
      const estadoIcon  = vencido ? '⚠️ Vencido' : '✅ Aprobado';
      estadoHTML = `
        <span class="${estadoClass}">${estadoIcon}</span>
        <div style="font-size:0.78rem; color:#777; margin-top:2px;">
          Realizado: ${formatFecha(fechaRaw)}<br>
          Vence: ${formatFecha(vencimiento)}
        </div>`;
    } else {
      estadoHTML = `<span class="estado-pendiente">⏳ Pendiente</span>`;
    }

    filasHTML += `
      <tr>
        <td style="padding:10px 12px; border-bottom:1px solid #eee; font-weight:500;">${curso.titulo}</td>
        <td style="padding:10px 12px; border-bottom:1px solid #eee;">${estadoHTML}</td>
      </tr>`;
  }

  resultado.innerHTML = `
    <div class="consulta-card">
      <div class="consulta-header">
        <strong>👤 ${nombreCompleto}</strong>
        <span style="color:#666; font-size:0.85rem;">🏢 ${empresa}</span>
      </div>
      <table style="width:100%; border-collapse:collapse; margin-top:10px; font-size:0.88rem;">
        <thead>
          <tr style="background:#f5f7fa;">
            <th style="padding:8px 12px; text-align:left; color:#002855;">Curso</th>
            <th style="padding:8px 12px; text-align:left; color:#002855;">Estado · Fechas</th>
          </tr>
        </thead>
        <tbody>${filasHTML}</tbody>
      </table>
    </div>`;
};
