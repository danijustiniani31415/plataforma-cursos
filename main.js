import { supabase } from './src/supabaseClient.js';
import { generarCertificadoPDF } from './certificado.js';

const loginSection            = document.getElementById('login-section');
const cursosDisponiblesSection = document.getElementById('cursos-disponibles');
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
    cursosDisponiblesSection.style.display = 'block';
    await cargarCursos();
    await verificarAdmin(session.user.id);
  }
});

// ═══════════════════════════════
// 🔐 LOGIN
// ═══════════════════════════════
async function login() {
  const email    = document.getElementById('email').value;
  const password = document.getElementById('password').value;

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    alert("❌ Error al iniciar sesión: " + error.message);
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
  cursosDisponiblesSection.style.display = 'block';
  await cargarCursos();
  await verificarAdmin(data.user.id);
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

  // Cargar perfil + branding de empresa
  const { data: perfil } = await supabase
    .from('profiles')
    .select('nombres, apellidos, empresa_id, empresas(nombre, logo_url, color_primario, color_secundario)')
    .eq('id', usuarioActual.id)
    .single();

  // Aplicar branding de la empresa
  const empresa = perfil?.empresas;
  if (empresa) {
    // Colores
    const colorPrimario   = empresa.color_primario   || '#1e3a5f';
    const colorSecundario = empresa.color_secundario || '#c9a84c';
    document.documentElement.style.setProperty('--navy',      colorPrimario);
    document.documentElement.style.setProperty('--navy-dark', colorPrimario);
    document.documentElement.style.setProperty('--gold',      colorSecundario);
    document.documentElement.style.setProperty('--gold-light',colorSecundario);
    document.documentElement.style.setProperty('--border-focus', colorPrimario);

    // Logo
    if (empresa.logo_url) {
      const logoEls = document.querySelectorAll('.header-logo, #splash-logo');
      logoEls.forEach(el => { el.src = empresa.logo_url; });
    }

    // Título
    const headerTitle = document.querySelector('.header-title');
    if (headerTitle) headerTitle.textContent = empresa.nombre || 'CV Global S.A.C.';

    // Meta theme-color
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) metaTheme.content = colorPrimario;
  }

  // Nombre del trabajador en el subtitle
  const headerSubtitle = document.querySelector('.header-subtitle');
  if (headerSubtitle && perfil?.nombres) {
    headerSubtitle.textContent = `${perfil.nombres} ${perfil.apellidos || ''} · ${empresa?.nombre || ''}`;
  }

  // Cargar estados: aprobaciones y asistencias
  const { data: envios } = await supabase
    .from('envios_formulario')
    .select('id_curso, aprobado, created_at, formularios(tipo)')
    .eq('usuario_email', usuarioActual.email)
    .eq('estado', 'completado');

  // Por curso: saber si aprobó examen y cuándo
  const estadoCurso = {};
  (envios || []).forEach(e => {
    if (e.formularios?.tipo === 'examen' && e.aprobado) {
      if (!estadoCurso[e.id_curso] || new Date(e.created_at) > new Date(estadoCurso[e.id_curso].fecha)) {
        estadoCurso[e.id_curso] = { aprobado: true, fecha: e.created_at };
      }
    }
  });

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
  certificadoSection.style.display = 'none';

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
      const srcVisor = esOneDrive ? url : "https://view.officeapps.live.com/op/embed.aspx?src=" + encodeURIComponent(url);

      contenidoHTML = `
        <div class="material-cta">
          <a href="${url}" target="_blank" onclick="marcarMaterialVisto()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            Abrir material
          </a>
          <span class="material-cta-text">Abre el documento para continuar</span>
        </div>
        <iframe src="${srcVisor}" width="100%" height="500px"
          style="border:1px solid var(--border); border-radius:var(--radius-md);"
          frameborder="0" allowfullscreen onload="marcarMaterialVisto()">
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

  certificadoSection.style.display = 'none';
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
    alert('✅ ¡Gracias por tu opinión!');
  } else if (!aprobado) {
    alert(`❌ No aprobaste.\nNota: ${notaSobre20.toFixed(1)}/20\nNecesitas 16 para aprobar.`);
  } else {
    alert(`✅ ¡Aprobaste!\nNota: ${notaSobre20.toFixed(1)}/20`);
  }

  await mostrarPasoActual();

  if (tipoPaso === 'encuesta' || aprobado) {
    const btn = document.getElementById('btn-siguiente-paso');
    if (btn) { btn.disabled = false; }

    if (pasoActual === pasosCurso.length - 1 && tipoPaso === 'eficacia') {
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