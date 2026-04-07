import { supabase } from './src/supabaseClient.js';
import { alertToToast } from './toast.js';
const alert = alertToToast;

const FONDO_URL = 'https://wrahjlstautwinxyqcfx.supabase.co/storage/v1/object/sign/certificados/Fondo.png?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV80MjRkNDBhNC1jZTI0LTQwYzItYTc3NC1lMmUwNzBjNGMzMzUiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJjZXJ0aWZpY2Fkb3MvRm9uZG8ucG5nIiwiaWF0IjoxNzc0MTkxNDc5LCJleHAiOjE5MzE4NzE0Nzl9.LIMJ5ZojaBjlxG1-Tg5_G7zr_bRLTNGKlIUahmOUJLk';
const FIRMA_URL = 'https://wrahjlstautwinxyqcfx.supabase.co/storage/v1/object/sign/certificados/Firma.png?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV80MjRkNDBhNC1jZTI0LTQwYzItYTc3NC1lMmUwNzBjNGMzMzUiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJjZXJ0aWZpY2Fkb3MvRmlybWEucG5nIiwiaWF0IjoxNzc0MTkxNDYyLCJleHAiOjE5MzE4NzE0NjJ9.SdrIBlz2EWYzDVY35YYfCJMJO3LypxQ5JIE8oHvegTM';
const LOGO_URL  = 'https://wrahjlstautwinxyqcfx.supabase.co/storage/v1/object/sign/certificados/Logo.png?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV80MjRkNDBhNC1jZTI0LTQwYzItYTc3NC1lMmUwNzBjNGMzMzUiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJjZXJ0aWZpY2Fkb3MvTG9nby5wbmciLCJpYXQiOjE3NzQxOTE4MjksImV4cCI6MTkzMTg3MTgyOX0.rzYxlgmM8bq-3Bmk8rTNgVfvsUu7ex3LVQyrI1oCIHk';

// ─── Genera el HTML del certificado (reutilizable desde admin también) ───────
export function buildHtmlCertificado({ nombreCompleto, dni, documentoTipo, cargo, cursotitulo, duracion, notaTexto, fechaHoy, codigo }) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Certificado - ${nombreCompleto}</title>
  <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=Crimson+Text:ital,wght@0,400;0,600;1,400&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { width: 297mm; height: 210mm; overflow: hidden; background: white; }
    .certificado { width: 297mm; height: 210mm; position: relative; font-family: 'Crimson Text', Georgia, serif; overflow: hidden; }
    .fondo { position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; z-index: 0; }
    .borde-ext { position: absolute; inset: 6mm; border: 2.5px solid #c9a84c; z-index: 1; pointer-events: none; }
    .borde-int { position: absolute; inset: 9mm; border: 0.8px solid #c9a84c; opacity: 0.5; z-index: 1; pointer-events: none; }
    .esquina { position: absolute; width: 12mm; height: 12mm; border-color: #002855; border-style: solid; z-index: 2; }
    .esquina.tl { top: 5mm; left: 5mm; border-width: 2px 0 0 2px; }
    .esquina.tr { top: 5mm; right: 5mm; border-width: 2px 2px 0 0; }
    .esquina.bl { bottom: 5mm; left: 5mm; border-width: 0 0 2px 2px; }
    .esquina.br { bottom: 5mm; right: 5mm; border-width: 0 2px 2px 0; }
    .logo { position: absolute; top: 10mm; left: 14mm; height: 16mm; z-index: 3; }
    .firma-img { position: absolute; bottom: 30mm; right: 24mm; height: 38.4mm; z-index: 3; opacity: 0.9; }
    .contenido { position: absolute; inset: 0; z-index: 2; display: flex; flex-direction: column; align-items: center; padding: 0 25mm; transform: translateY(10mm); }
    .titulo { margin-top: 38mm; font-family: 'Cinzel', Georgia, serif; font-size: 28pt; font-weight: 700; color: #002855; letter-spacing: 4px; text-transform: uppercase; text-align: center; line-height: 1.1; }
    .subtitulo { margin-top: 2mm; font-family: 'Cinzel', serif; font-size: 8.5pt; font-weight: 400; color: #555; letter-spacing: 3px; text-transform: uppercase; text-align: center; }
    .linea-decorativa { width: 180mm; margin: 4mm auto; display: flex; align-items: center; gap: 3mm; }
    .linea-decorativa::before, .linea-decorativa::after { content: ''; flex: 1; height: 1px; background: linear-gradient(to right, transparent, #c9a84c, transparent); }
    .linea-decorativa-icono { color: #c9a84c; font-size: 10pt; }
    .certifica-texto { font-family: 'Crimson Text', serif; font-size: 11pt; font-style: italic; color: #555; text-align: center; letter-spacing: 1px; }
    .nombre { margin-top: 3mm; font-family: 'Cinzel', Georgia, serif; font-size: 22pt; font-weight: 700; color: #002855; text-align: center; text-transform: uppercase; letter-spacing: 2px; line-height: 1.15; }
    .dni-cargo { margin-top: 2mm; font-family: 'Crimson Text', serif; font-size: 10pt; color: #444; text-align: center; letter-spacing: 0.5px; }
    .separador { width: 120mm; margin: 4mm auto; border-top: 0.5px solid #c9a84c; opacity: 0.6; }
    .participacion-texto { font-family: 'Crimson Text', serif; font-size: 10pt; color: #555; text-align: center; font-style: italic; }
    .curso-nombre { margin-top: 2mm; font-family: 'Cinzel', Georgia, serif; font-size: 14pt; font-weight: 600; color: #002855; text-align: center; text-transform: uppercase; letter-spacing: 1.5px; line-height: 1.2; }
    .empresa-texto { margin-top: 3mm; font-family: 'Crimson Text', serif; font-size: 9.5pt; color: #666; text-align: center; }
    .duracion-fecha { margin-top: 1.5mm; font-family: 'Crimson Text', serif; font-size: 9.5pt; color: #555; text-align: center; }
    .pie-datos { position: absolute; bottom: 10mm; right: 18mm; text-align: right; font-family: 'Crimson Text', serif; font-size: 8pt; color: #666; line-height: 1.7; z-index: 3; }
    .firma-bloque { position: absolute; bottom: 18mm; right: 12mm; text-align: center; width: 82mm; z-index: 3; }
    .firma-linea { border-top: 1.5px solid #002855; margin-bottom: 2.5mm; }
    .firma-nombre { font-family: 'Cinzel', serif; font-size: 11pt; font-weight: 600; color: #002855; letter-spacing: 0.7px; text-transform: uppercase; }
    .firma-titulo { font-family: 'Crimson Text', serif; font-size: 10pt; color: #555; margin-top: 1.2mm; }
    @media print { body { margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; } @page { size: A4 landscape; margin: 0; } }
  </style>
</head>
<body>
  <div class="certificado">
    <img class="fondo" src="${FONDO_URL}" crossorigin="anonymous" />
    <div class="borde-ext"></div>
    <div class="borde-int"></div>
    <div class="esquina tl"></div>
    <div class="esquina tr"></div>
    <div class="esquina bl"></div>
    <div class="esquina br"></div>
    <img class="logo" src="${LOGO_URL}" crossorigin="anonymous" />
    <img class="firma-img" src="${FIRMA_URL}" crossorigin="anonymous" />
    <div class="contenido">
      <div class="titulo">Certificado de Capacitación</div>
      <div class="subtitulo">Seguridad · Salud · Medio Ambiente</div>
      <div class="linea-decorativa"><span class="linea-decorativa-icono">✦</span></div>
      <div class="certifica-texto">La empresa CV GLOBAL S.A.C. certifica que:</div>
      <div class="nombre">${nombreCompleto}</div>
      <div class="dni-cargo">Con ${documentoTipo || 'DNI'} N°: <strong>${dni}</strong> &nbsp;&nbsp;·&nbsp;&nbsp; Puesto de trabajo: <strong>${cargo}</strong></div>
      <div class="separador"></div>
      <div class="participacion-texto">Ha PARTICIPADO y APROBADO satisfactoriamente el curso:</div>
      <div class="curso-nombre">${cursotitulo}</div>
      <div class="empresa-texto">Dictado por CV GLOBAL S.A.C. &nbsp;·&nbsp; Duración: <strong>${duracion}</strong></div>
      <div class="duracion-fecha">Lima, ${fechaHoy}</div>
    </div>
    <div class="pie-datos"><strong>Nota:</strong> ${notaTexto}/20 &nbsp;&nbsp; <strong>Código:</strong> ${codigo}</div>
    <div class="firma-bloque">
      <div class="firma-linea"></div>
      <div class="firma-nombre">Samuel Daniel Justiniani Aranda</div>
      <div class="firma-titulo">Especialista SSOMA</div>
      <div class="firma-titulo">Ingeniero Metalurgista CIP-181200</div>
    </div>
  </div>
</body>
</html>`;
}

// ─── Descarga el HTML como PDF usando html2pdf.js ────────────────────────────
export async function descargarCertificadoPDF(htmlContent, nombreArchivo) {
  // Overlay de carga mientras se genera el PDF
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:99998;display:flex;align-items:center;justify-content:center;color:white;font-size:1.1rem;font-family:sans-serif;';
  overlay.textContent = '⏳ Generando certificado PDF...';
  document.body.appendChild(overlay);

  // Contenedor del certificado visible para que html2canvas lo capture correctamente
  const contenedor = document.createElement('div');
  contenedor.style.cssText = 'position:fixed;top:0;left:0;width:1122px;height:794px;overflow:hidden;background:white;z-index:99999;';
  contenedor.innerHTML = htmlContent;
  document.body.appendChild(contenedor);

  // Esperar imágenes
  await Promise.all(
    Array.from(contenedor.querySelectorAll('img')).map(img =>
      new Promise(resolve => {
        if (img.complete) return resolve(null);
        img.onload = img.onerror = resolve;
      })
    )
  );
  // Esperar fuentes
  await new Promise(r => setTimeout(r, 1500));

  const el = contenedor.querySelector('.certificado') || contenedor;

  await window.html2pdf().set({
    margin:      0,
    filename:    nombreArchivo,
    image:       { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, allowTaint: true, width: 1122, height: 794, scrollX: 0, scrollY: 0 },
    jsPDF:       { unit: 'mm', format: 'a4', orientation: 'landscape' },
  }).from(el).save();

  document.body.removeChild(contenedor);
  document.body.removeChild(overlay);
}

// ─── Flujo principal del trabajador ──────────────────────────────────────────
export async function generarCertificadoPDFBlob(htmlContent) {
  const contenedor = document.createElement('div');
  contenedor.style.cssText = 'position:fixed;top:0;left:0;width:1122px;height:794px;overflow:hidden;background:white;z-index:99999;opacity:0.01;pointer-events:none;';
  contenedor.innerHTML = htmlContent;
  document.body.appendChild(contenedor);

  try {
    await Promise.all(
      Array.from(contenedor.querySelectorAll('img')).map(img =>
        new Promise(resolve => {
          if (img.complete) return resolve(null);
          img.onload = img.onerror = resolve;
        })
      )
    );
    await new Promise(r => setTimeout(r, 1500));

    const el = contenedor.querySelector('.certificado') || contenedor;
    const worker = window.html2pdf().set({
      margin:      0,
      image:       { type: 'jpeg', quality: 0.98 },
      pagebreak:   { mode: ['avoid-all'] },
      html2canvas: {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        width: 1122,
        height: 794,
        windowWidth: 1122,
        windowHeight: 794,
        scrollX: 0,
        scrollY: 0,
        backgroundColor: '#ffffff',
      },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' },
    }).from(el).toCanvas();

    const canvas = await worker.get('canvas');

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({
      unit: 'mm',
      format: 'a4',
      orientation: 'landscape',
      compress: true,
    });

    pdf.addImage(
      canvas.toDataURL('image/jpeg', 0.98),
      'JPEG',
      0,
      0,
      297,
      210,
      undefined,
      'FAST'
    );

    return pdf.output('blob');
  } finally {
    document.body.removeChild(contenedor);
  }
}

export async function generarCertificadoPDF(curso, nota) {
  const { data: { user } } = await supabase.auth.getUser();

  const { data: perfil } = await supabase
    .from('profiles')
    .select('nombres, apellidos, documento_numero, documento_tipo, cargo_id, empresa_id, cargos(nombre), empresas(nombre)')
    .eq('id', user.id)
    .single();

  const nombreCompleto = `${perfil?.apellidos || ''} ${perfil?.nombres || ''}`.trim().toUpperCase();
  const dni            = perfil?.documento_numero || '';
  const cargo          = perfil?.cargos?.nombre || '';
  const duracion       = curso.duracion ? `${curso.duracion} hora${curso.duracion > 1 ? 's' : ''}` : '';
  const notaTexto      = nota?.toFixed ? nota.toFixed(1) : String(nota);
  const fechaHoy       = new Date().toLocaleDateString('es-PE', { day: '2-digit', month: 'long', year: 'numeric' });

  // Llamar Edge Function: guarda en BD + envía email → devuelve código
  const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndyYWhqbHN0YXV0d2lueHlxY2Z4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxMTMyNjYsImV4cCI6MjA4ODY4OTI2Nn0.iAbYatXkr5BAplYDhs7vMca2ROjb11uFM0e4619sD4s';
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token || ANON_KEY;

  const response = await fetch('https://wrahjlstautwinxyqcfx.supabase.co/functions/v1/enviar-certificado', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`,
      'apikey': ANON_KEY,
    },
    body: JSON.stringify({
      usuario_id:    user.id,
      usuario_email: user.email,
      nombres:       perfil?.nombres || '',
      apellidos:     perfil?.apellidos || '',
      dni,
      cargo,
      empresa:       perfil?.empresas?.nombre || '',
      id_curso:      curso.id,
      curso_titulo:  curso.titulo,
      curso_prefijo: curso.codigo_prefijo || 'CERT',
      nota:          notaTexto,
    }),
  });

  const result = await response.json();

  if (!response.ok || result.error) {
    alert('❌ ' + (result.error || 'Error al generar certificado'));
    return;
  }

  const codigo = result.codigo;

  if (result.yaExistia) {
    alert('⚠️ Ya generaste el certificado para este curso anteriormente. Descargando PDF...');
  } else {
    alert(`✅ ¡Certificado generado! Código: ${codigo}\nSe envió una notificación a tu correo.`);
  }

  // Generar y descargar el PDF cliente
  const html = buildHtmlCertificado({
    nombreCompleto,
    dni,
    documentoTipo: perfil?.documento_tipo,
    cargo,
    cursotitulo:   curso.titulo,
    duracion,
    notaTexto,
    fechaHoy,
    codigo,
  });

  await descargarCertificadoPDF(html, `Certificado_${nombreCompleto}_${curso.titulo}.pdf`);
}
