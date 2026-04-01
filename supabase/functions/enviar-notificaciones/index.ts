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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { empresa_id, tipo, empresa_nombre } = await req.json()
    if (!empresa_id) throw new Error('empresa_id requerido')

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE)

    // 1. Trabajadores activos de la empresa
    const { data: workers, error: wErr } = await supabase
      .from('profiles')
      .select('id, nombres, apellidos, email, cargo')
      .eq('empresa_id', empresa_id)
      .eq('activo', true)

    if (wErr) throw wErr
    if (!workers?.length) return json({ ok: true, enviados: 0 })

    const emails = workers.map((w: any) => w.email)

    // 2. Cursos activos con vigencia
    const { data: cursos } = await supabase
      .from('cursos')
      .select('id, titulo, vigencia_meses')
      .eq('activo', true)

    // 3. Últimas aprobaciones por examen
    const { data: envios } = await supabase
      .from('envios_formulario')
      .select('usuario_email, id_curso, created_at, formularios(tipo)')
      .in('usuario_email', emails)
      .eq('aprobado', true)

    const lastSub: Record<string, any> = {}
    ;(envios || [])
      .filter((e: any) => e.formularios?.tipo === 'examen')
      .forEach((e: any) => {
        const key = `${e.usuario_email}__${e.id_curso}`
        if (!lastSub[key] || new Date(e.created_at) > new Date(lastSub[key].created_at)) {
          lastSub[key] = e
        }
      })

    // 4. Asignaciones del mes actual (cursos pendientes)
    const now   = new Date()
    const mes   = now.getMonth() + 1
    const anio  = now.getFullYear()
    const { data: asignaciones } = await supabase
      .from('asignaciones_mes')
      .select('documento_numero, profiles(email)')
      .eq('empresa_id', empresa_id)
      .eq('mes', mes)
      .eq('anio', anio)

    const emailsAsignados = new Set(
      (asignaciones || []).map((a: any) => a.profiles?.email).filter(Boolean)
    )

    const in30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

    let enviados = 0

    for (const worker of workers as any[]) {
      const pendientesMes: string[] = []
      const alertasCert:  { curso: string; estado: string; fecha: string }[] = []

      // Cursos pendientes del mes
      if ((tipo === 'pendientes' || tipo === 'ambos') && emailsAsignados.has(worker.email)) {
        for (const curso of (cursos || []) as any[]) {
          const key = `${worker.email}__${curso.id}`
          if (!lastSub[key]) {
            pendientesMes.push(curso.titulo)
          }
        }
      }

      // Certificados por vencer / vencidos
      if (tipo === 'vencimientos' || tipo === 'ambos') {
        for (const curso of (cursos || []) as any[]) {
          const key  = `${worker.email}__${curso.id}`
          const sub  = lastSub[key]
          if (!sub) continue
          const emision     = new Date(sub.created_at)
          const vencimiento = new Date(emision)
          vencimiento.setMonth(vencimiento.getMonth() + (curso.vigencia_meses || 12))
          if (vencimiento < in30) {
            alertasCert.push({
              curso: curso.titulo,
              estado: vencimiento < now ? 'Vencido' : 'Por vencer',
              fecha:  vencimiento.toLocaleDateString('es-PE'),
            })
          }
        }
      }

      if (!pendientesMes.length && !alertasCert.length) continue

      // Construir email
      const listaPendientes = pendientesMes.length
        ? `<h3 style="color:#002855;margin-bottom:8px;">📚 Cursos pendientes este mes:</h3>
           <ul>${pendientesMes.map(c => `<li>${c}</li>`).join('')}</ul>`
        : ''

      const listaAlertas = alertasCert.length
        ? `<h3 style="color:#dc3545;margin-bottom:8px;">⚠️ Certificados por vencer:</h3>
           <ul>${alertasCert.map(a => `<li><strong>${a.curso}</strong> — ${a.estado} el ${a.fecha}</li>`).join('')}</ul>`
        : ''

      const html = `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
          <div style="background:#002855;padding:20px;border-radius:8px 8px 0 0;">
            <h1 style="color:white;margin:0;font-size:1.2rem;">📋 Recordatorio de Capacitaciones</h1>
            <p style="color:#aac4e8;margin:4px 0 0;">${empresa_nombre || 'CV Global'}</p>
          </div>
          <div style="background:#f8f9fa;padding:24px;border-radius:0 0 8px 8px;">
            <p>Estimado/a <strong>${worker.nombres} ${worker.apellidos}</strong>,</p>
            <p>Le recordamos que tiene las siguientes acciones pendientes en la plataforma de capacitaciones:</p>
            ${listaPendientes}
            ${listaAlertas}
            <div style="margin-top:24px;">
              <a href="${PLATAFORMA_URL}" style="background:#002855;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">
                Ingresar a la plataforma
              </a>
            </div>
            <p style="font-size:0.8rem;color:#888;margin-top:24px;">
              Este es un mensaje automático. Por favor no responda este correo.
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
          from: 'Capacitaciones <notificaciones@cvglobal.com>',
          to: [worker.email],
          subject: `📋 Recordatorio de capacitaciones — ${empresa_nombre || 'CV Global'}`,
          html,
        }),
      })

      if (resendResp.ok) enviados++
    }

    return json({ ok: true, enviados })
  } catch (err: any) {
    return json({ ok: false, error: err.message }, 400)
  }
})

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
