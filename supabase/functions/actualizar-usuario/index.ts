import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

    const authHeader = req.headers.get('Authorization') || ''
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user: caller } } = await supabaseClient.auth.getUser()
    if (!caller) {
      return new Response(JSON.stringify({ error: 'No autenticado' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { data: callerPerfil } = await supabaseAdmin
      .from('profiles')
      .select('rol')
      .eq('id', caller.id)
      .single()

    if (!['admin', 'superadmin', 'gestor'].includes(callerPerfil?.rol)) {
      return new Response(JSON.stringify({ error: 'Acceso denegado' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { usuario_id, updates, password, agregarSedes, quitarSedes } = await req.json()

    if (!usuario_id) {
      return new Response(JSON.stringify({ error: 'Datos incompletos' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Actualizar tabla profiles (si hay campos que actualizar)
    if (updates && Object.keys(updates).length > 0) {
      const { error: profileError } = await supabaseAdmin
        .from('profiles')
        .update(updates)
        .eq('id', usuario_id)
      if (profileError) throw new Error(profileError.message)
    }

    // Actualizar en Auth: password siempre; el email de Auth solo se sincroniza para
    // admin/gestor/superadmin (ellos ingresan con correo real). Los trabajadores ingresan
    // siempre con DNI@cvglobal.pe — nunca se les toca el email de Auth aunque cambien su
    // "correo de contacto" en profiles.
    const authUpdates: Record<string, string | boolean> = {}
    if (password) authUpdates.password = password

    if (updates?.email) {
      const { data: perfilObjetivo } = await supabaseAdmin
        .from('profiles')
        .select('rol')
        .eq('id', usuario_id)
        .single()

      if (['admin', 'gestor', 'superadmin'].includes(perfilObjetivo?.rol)) {
        authUpdates.email = updates.email
        authUpdates.email_confirm = true
      }
    }

    if (Object.keys(authUpdates).length > 0) {
      const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(
        usuario_id,
        authUpdates
      )
      if (authError) throw new Error('Auth: ' + authError.message)
    }

    // Agregar el trabajador a nuevas sedes (no duplica si ya existe)
    if (Array.isArray(agregarSedes) && agregarSedes.length > 0) {
      const { data: perfilActual } = await supabaseAdmin
        .from('profiles')
        .select('empresa_id, cargo_id, fecha_ingreso')
        .eq('id', usuario_id)
        .single()

      if (perfilActual?.empresa_id) {
        for (const sede of agregarSedes) {
          const { data: yaExiste } = await supabaseAdmin
            .from('perfil_sede')
            .select('id')
            .eq('profile_id', usuario_id)
            .eq('sede', sede)
            .maybeSingle()

          if (!yaExiste) {
            const { error: sedeError } = await supabaseAdmin
              .from('perfil_sede')
              .insert({
                profile_id: usuario_id,
                empresa_id: perfilActual.empresa_id,
                sede,
                cargo_id: perfilActual.cargo_id,
                fecha_ingreso: perfilActual.fecha_ingreso,
                activo: true,
              })
            if (sedeError) throw new Error('Sede: ' + sedeError.message)
          }
        }
      }
    }

    // Quitar (desactivar) al trabajador de sedes
    if (Array.isArray(quitarSedes) && quitarSedes.length > 0) {
      const { error: quitarError } = await supabaseAdmin
        .from('perfil_sede')
        .update({ activo: false })
        .eq('profile_id', usuario_id)
        .in('sede', quitarSedes)
      if (quitarError) throw new Error('Quitar sede: ' + quitarError.message)
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
