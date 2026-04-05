import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const PLATAFORMA_URL = 'https://cursossstcvglobal.netlify.app'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const {
      usuario_id, usuario_email, nombres, apellidos,
      dni, cargo, empresa, id_curso, curso_titulo,
      curso_prefijo, nota,
    } = await req.json()

    // Si ya tiene certificado, devolver el código existente (no error)
    const { data: certExistente } = await supabaseAdmin
      .from('certificados')
      .select('id, codigo')
      .eq('usuario_id', usuario_id)
      .eq('curso_id', id_curso)
      .maybeSingle()

    if (certExistente) {
      return new Response(JSON.stringify({
        success: true,
        codigo: certExistente.codigo,
        yaExistia: true,
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Generar código correlativo
    const anio = new Date().getFullYear().toString().slice(-2)
    const { data: cursoData } = await supabaseAdmin
      .from('cursos')
      .select('correlativo, codigo_prefijo')
      .eq('id', id_curso)
      .single()

    const nuevoCorrelativo = (cursoData?.correlativo || 0) + 1
    const prefijo = curso_prefijo || cursoData?.codigo_prefijo || 'CERT'
    const codigo  = `${prefijo}-${anio}-${String(nuevoCorrelativo).padStart(4, '0')}`

    // Actualizar correlativo del curso
    await supabaseAdmin
      .from('cursos')
      .update({ correlativo: nuevoCorrelativo })
      .eq('id', id_curso)

    // Guardar certificado
    await supabaseAdmin.from('certificados').insert([{
      usuario_id,
      usuario_email,
      curso_id:  id_curso,
      codigo,
      nota,
      nombres,
      apellidos,
      dni,
      cargo,
      empresa,
    }])

    // Enviar email de notificación con Resend
    if (RESEND_API_KEY && usuario_email) {
      const nombreCompleto = `${apellidos || ''} ${nombres || ''}`.trim()
      const notaDisplay    = typeof nota === 'number' ? nota.toFixed(1) : nota

      const htmlEmail = `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;border:1px solid #e0e0e0;border-radius:10px;overflow:hidden;">
          <div style="background:#002855;padding:24px 30px;">
            <h1 style="color:white;margin:0;font-size:1.3rem;">🎓 Certificado de Capacitación</h1>
            <p style="color:#aac4e8;margin:6px 0 0;font-size:0.9rem;">CV GLOBAL S.A.C.</p>
          </div>
          <div style="padding:28px 30px;">
            <p style="font-size:1rem;color:#333;">Estimado/a <strong>${nombreCompleto}</strong>,</p>
            <p style="color:#555;">Has <strong>aprobado satisfactoriamente</strong> el siguiente curso de capacitación:</p>
            <div style="background:#f0f4fb;border-left:4px solid #002855;padding:16px 20px;margin:20px 0;border-radius:0 8px 8px 0;">
              <p style="margin:0;font-size:1.1rem;font-weight:700;color:#002855;">${curso_titulo}</p>
              <p style="margin:8px 0 0;color:#555;font-size:0.9rem;">
                Nota: <strong>${notaDisplay}/20</strong> &nbsp;·&nbsp;
                Código: <strong style="font-family:monospace;">${codigo}</strong>
              </p>
            </div>
            <p style="color:#555;font-size:0.9rem;">Ingresa a la plataforma para descargar tu certificado en PDF:</p>
            <div style="margin:20px 0;">
              <a href="${PLATAFORMA_URL}"
                 style="background:#002855;color:white;padding:13px 28px;border-radius:7px;text-decoration:none;font-weight:bold;font-size:0.95rem;display:inline-block;">
                📄 Descargar mi Certificado
              </a>
            </div>
            <hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />
            <p style="font-size:0.78rem;color:#aaa;margin:0;">
              Este mensaje es generado automáticamente. Por favor no responda este correo.<br/>
              CV Global S.A.C. · Sistema de Capacitación SST
            </p>
          </div>
        </div>`

      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          from:    'Capacitaciones <notificaciones@cvglobal.com>',
          to:      [usuario_email],
          subject: `🎓 Certificado aprobado: ${curso_titulo}`,
          html:    htmlEmail,
        }),
      })
    }

    return new Response(JSON.stringify({ success: true, codigo }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
