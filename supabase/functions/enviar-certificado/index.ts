import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_API_KEY  = Deno.env.get('RESEND_API_KEY')!
const SUPABASE_URL    = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const PLATAFORMA_URL  = 'https://cursossstcvglobal.netlify.app'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function generarCodigo(prefijo: string): string {
  const anio     = new Date().getFullYear()
  const random   = Math.floor(Math.random() * 100000).toString().padStart(5, '0')
  return `${prefijo}-${anio}-${random}`
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const {
      usuario_id, usuario_email,
      nombres, apellidos, dni, cargo, empresa,
      id_curso, curso_titulo, curso_prefijo, nota,
    } = await req.json()

    if (!usuario_id || !id_curso) throw new Error('Faltan parámetros requeridos')

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE)

    // Verificar si ya existe certificado para este usuario+curso
    const { data: existente } = await supabase
      .from('certificados')
      .select('id, codigo')
      .eq('usuario_id', usuario_id)
      .eq('curso_id', id_curso)
      .maybeSingle()

    if (existente) {
      return new Response(
        JSON.stringify({ ok: true, codigo: existente.codigo, yaExistia: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Generar código único
    const codigo = generarCodigo(curso_prefijo || 'CERT')

    // Guardar en tabla certificados
    const { error: insertError } = await supabase.from('certificados').insert({
      usuario_id,
      curso_id:   id_curso,
      codigo,
      nota:       parseFloat(nota) || 0,
      emitido_en: new Date().toISOString(),
    })

    if (insertError) throw insertError

    // Enviar email de notificación con Resend
    const nombreCompleto = `${apellidos} ${nombres}`.trim()
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

          <p style="color:#555;font-size:0.9rem;">
            Ingresa a la plataforma para descargar tu certificado en PDF:
          </p>

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

    const resendResp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:    'Capacitaciones <notificaciones@cvglobal.com>',
        to:      [usuario_email],
        subject: `🎓 Certificado aprobado: ${curso_titulo}`,
        html:    htmlEmail,
      }),
    })

    const emailOk = resendResp.ok

    return new Response(
      JSON.stringify({ ok: true, codigo, emailEnviado: emailOk }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
