import { supabase } from './src/supabaseClient.js';

const FONDO_URL = 'https://wrahjlstautwinxyqcfx.supabase.co/storage/v1/object/sign/certificados/Fondo.png?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV80MjRkNDBhNC1jZTI0LTQwYzItYTc3NC1lMmUwNzBjNGMzMzUiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJjZXJ0aWZpY2Fkb3MvRm9uZG8ucG5nIiwiaWF0IjoxNzc0MTkxNDc5LCJleHAiOjE5MzE4NzE0Nzl9.LIMJ5ZojaBjlxG1-Tg5_G7zr_bRLTNGKlIUahmOUJLk';
const FIRMA_URL = 'https://wrahjlstautwinxyqcfx.supabase.co/storage/v1/object/sign/certificados/Firma.png?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV80MjRkNDBhNC1jZTI0LTQwYzItYTc3NC1lMmUwNzBjNGMzMzUiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJjZXJ0aWZpY2Fkb3MvRmlybWEucG5nIiwiaWF0IjoxNzc0MTkxNDYyLCJleHAiOjE5MzE4NzE0NjJ9.SdrIBlz2EWYzDVY35YYfCJMJO3LypxQ5JIE8oHvegTM';
const LOGO_URL  = 'https://wrahjlstautwinxyqcfx.supabase.co/storage/v1/object/sign/certificados/Logo.png?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV80MjRkNDBhNC1jZTI0LTQwYzItYTc3NC1lMmUwNzBjNGMzMzUiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJjZXJ0aWZpY2Fkb3MvTG9nby5wbmciLCJpYXQiOjE3NzQxOTE4MjksImV4cCI6MTkzMTg3MTgyOX0.rzYxlgmM8bq-3Bmk8rTNgVfvsUu7ex3LVQyrI1oCIHk';

export async function generarCertificadoPDF(curso, nota) {
  const { data: { user } } = await supabase.auth.getUser();

  // Verificar si ya tiene certificado
  const { data: certExistente } = await supabase
    .from('certificados')
    .select('id, codigo')
    .eq('usuario_id', user.id)
    .eq('curso_id', curso.id)
    .maybeSingle();

  if (certExistente) {
    alert('⚠️ Ya generaste el certificado para este curso. Fue enviado a tu correo cuando lo generaste.');
    return;
  }

  const { data: perfil } = await supabase
    .from('profiles')
    .select('nombres, apellidos, documento_numero, documento_tipo, cargo_id, empresa_id, cargos(nombre), empresas(nombre)')
    .eq('id', user.id)
    .single();

  const nombreCompleto = `${perfil?.apellidos || ''} ${perfil?.nombres || ''}`.trim().toUpperCase();
  const dni            = perfil?.documento_numero || '';
  const cargo          = perfil?.cargos?.nombre || '';
  const empresa        = perfil?.empresas?.nombre || '';
  const fechaHoy       = new Date().toLocaleDateString('es-PE', { day: '2-digit', month: 'long', year: 'numeric' });
  const duracion       = curso.duracion ? `${curso.duracion} hora${curso.duracion > 1 ? 's' : ''}` : '';
  const notaTexto      = nota?.toFixed ? nota.toFixed(1) : nota;

  // Llamar Edge Function para guardar y enviar correo
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;

  const response = await fetch('https://wrahjlstautwinxyqcfx.supabase.co/functions/v1/enviar-certificado', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndyYWhqbHN0YXV0d2lueHlxY2Z4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxMTMyNjYsImV4cCI6MjA4ODY4OTI2Nn0.iAbYatXkr5BAplYDhs7vMca2ROjb11uFM0e4619sD4s'
    },
    body: JSON.stringify({
      usuario_id:    user.id,
      usuario_email: user.email,
      nombres:       perfil?.nombres || '',
      apellidos:     perfil?.apellidos || '',
      dni,
      cargo,
      empresa,
      id_curso:      curso.id,
      curso_titulo:  curso.titulo,
      curso_prefijo: curso.codigo_prefijo || 'CERT',
      nota:          notaTexto
    })
  });

  const result = await response.json();

  if (!response.ok || result.error) {
    alert('❌ ' + (result.error || 'Error al generar certificado'));
    return;
  }

  const codigo = result.codigo;

  alert(`✅ ¡Certificado generado!\nCódigo: ${codigo}\nSe ha enviado a tu correo: ${user.email}`);

  // Abrir certificado para imprimir
  const ventana = window.open('', '_blank');
  ventana.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Certificado - ${nombreCompleto}</title>
      <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=Crimson+Text:ital,wght@0,400;0,600;1,400&display=swap" rel="stylesheet">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { width: 297mm; height: 210mm; overflow: hidden; background: white; }
        .certificado { width: 297mm; height: 210mm; position: relative; font-family: 'Crimson Text', 'Georgia', serif; }
        .fondo { position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; z-index: 0; }
        .logo { position: absolute; top: 8mm; left: 12mm; height: 18mm; z-index: 2; }
        .firma-img { position: absolute; bottom: 22mm; right: 22mm; height: 22mm; z-index: 2; }
        .contenido {
          position: absolute; top: 0; left: 0;
          width: 100%; height: 100%; z-index: 1;
          display: flex; flex-direction: column; align-items: center;
          padding: 0 25mm;
        }
        .titulo {
          margin-top: 22mm;
          font-family: 'Cinzel', 'Georgia', serif;
          font-size: 30pt; font-weight: 700; color: #002855;
          letter-spacing: 4px; text-transform: uppercase; text-align: center; line-height: 1.1;
        }
        .subtitulo {
          margin-top: 2mm;
          font-family: 'Cinzel', serif; font-size: 9pt; font-weight: 400;
          color: #555; letter-spacing: 3px; text-transform: uppercase; text-align: center;
        }
        .linea-decorativa {
          width: 200mm; margin: 5mm auto;
          display: flex; align-items: center; gap: 3mm;
        }
        .linea-decorativa::before, .linea-decorativa::after {
          content: ''; flex: 1; height: 1px;
          background: linear-gradient(to right, transparent, #c9a84c, transparent);
        }
        .linea-decorativa-icono { color: #c9a84c; font-size: 10pt; }
        .certifica-texto {
          margin-top: 4mm; font-family: 'Crimson Text', serif;
          font-size: 11pt; font-style: italic; color: #555; text-align: center; letter-spacing: 1px;
        }
        .nombre {
          margin-top: 3mm; font-family: 'Cinzel', 'Georgia', serif;
          font-size: 24pt; font-weight: 700; color: #002855;
          text-align: center; text-transform: uppercase; letter-spacing: 2px; line-height: 1.15;
        }
        .dni-cargo {
          margin-top: 2.5mm; font-family: 'Crimson Text', serif;
          font-size: 10.5pt; color: #444; text-align: center; letter-spacing: 0.5px;
        }
        .separador { width: 120mm; margin: 4mm auto; border-top: 0.5px solid #c9a84c; opacity: 0.6; }
        .participacion-texto {
          margin-top: 3mm; font-family: 'Crimson Text', serif;
          font-size: 10.5pt; color: #555; text-align: center; font-style: italic;
        }
        .curso-nombre {
          margin-top: 2mm; font-family: 'Cinzel', 'Georgia', serif;
          font-size: 15pt; font-weight: 600; color: #002855;
          text-align: center; text-transform: uppercase; letter-spacing: 1.5px; line-height: 1.2;
        }
        .empresa-texto {
          margin-top: 3mm; font-family: 'Crimson Text', serif;
          font-size: 9.5pt; color: #666; text-align: center;
        }
        .duracion-fecha {
          margin-top: 2mm; font-family: 'Crimson Text', serif;
          font-size: 9.5pt; color: #555; text-align: center;
        }
        .pie-datos {
          position: absolute; bottom: 7mm; right: 22mm;
          text-align: right; font-family: 'Crimson Text', serif;
          font-size: 8pt; color: #666; line-height: 1.7; z-index: 2;
        }
        .firma-bloque {
          position: absolute; bottom: 6mm; right: 15mm;
          text-align: center; width: 65mm; z-index: 2;
        }
        .firma-linea { border-top: 1px solid #002855; margin-bottom: 2.5mm; }
        .firma-nombre { font-family: 'Cinzel', serif; font-size: 7.5pt; font-weight: 600; color: #002855; letter-spacing: 0.5px; text-transform: uppercase; }
        .firma-titulo { font-family: 'Crimson Text', serif; font-size: 7.5pt; color: #555; margin-top: 1mm; }
        @media print {
          body { margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          @page { size: A4 landscape; margin: 0; }
        }
      </style>
    </head>
    <body>
      <div class="certificado">
        <img class="fondo" src="${FONDO_URL}" />
        <img class="logo" src="${LOGO_URL}" />
        <img class="firma-img" src="${FIRMA_URL}" />
        <div class="contenido">
          <div class="titulo">Certificado de Capacitación</div>
          <div class="subtitulo">Seguridad · Salud · Medio Ambiente</div>
          <div class="linea-decorativa"><span class="linea-decorativa-icono">✦</span></div>
          <div class="certifica-texto">La empresa CV GLOBAL S.A.C. certifica que:</div>
          <div class="nombre">${nombreCompleto}</div>
          <div class="dni-cargo">
            Con ${perfil?.documento_tipo || 'DNI'} N°: <strong>${dni}</strong>
            &nbsp;&nbsp;·&nbsp;&nbsp;
            Puesto de trabajo: <strong>${cargo}</strong>
          </div>
          <div class="separador"></div>
          <div class="participacion-texto">Ha PARTICIPADO y APROBADO satisfactoriamente el curso:</div>
          <div class="curso-nombre">${curso.titulo}</div>
          <div class="empresa-texto">Dictado por CV GLOBAL S.A.C. &nbsp;·&nbsp; Duración: <strong>${duracion}</strong></div>
          <div class="duracion-fecha">Lima, ${fechaHoy}</div>
        </div>
        <div class="pie-datos">
          <div><strong>Nota:</strong> ${notaTexto}/20 &nbsp;&nbsp; <strong>Código:</strong> ${codigo}</div>
        </div>
        <div class="firma-bloque">
          <div class="firma-linea"></div>
          <div class="firma-nombre">Samuel Daniel Justiniani Aranda</div>
          <div class="firma-titulo">Especialista SSOMA</div>
          <div class="firma-titulo">Ingeniero Metalurgista CIP-181200</div>
        </div>
      </div>
      <script>
        window.onload = function() {
          setTimeout(() => window.print(), 1200);
        };
      </script>
    </body>
    </html>
  `);
  ventana.document.close();
}