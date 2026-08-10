// @ts-nocheck
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

    const { data: { user } } = await supabaseClient.auth.getUser()
    if (!user) {
      return new Response(JSON.stringify({ error: 'No autenticado' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { data: perfil } = await supabaseAdmin
      .from('profiles')
      .select('rol')
      .eq('id', user.id)
      .single()

    if (!['admin', 'superadmin'].includes(perfil?.rol)) {
      return new Response(JSON.stringify({ error: 'Acceso denegado' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const {
      email, password, nombres, apellidos,
      documento_tipo, documento_numero, telefono,
      empresa_id, cargo_id, fecha_ingreso, rol, sedes
    } = await req.json()

    const sedesFinal = Array.isArray(sedes) && sedes.length > 0 ? sedes : ['ANTAMINA']

    const { data: existe } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('documento_numero', documento_numero)
      .maybeSingle()

    if (existe) {
      return new Response(JSON.stringify({ error: 'Ese número de documento ya está registrado.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Auth siempre usa DNI@cvglobal.pe; el email personal solo va al perfil
    const authEmail = `${documento_numero}@cvglobal.pe`

    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: authEmail,
      password,
      email_confirm: true
    })

    if (authError) {
      return new Response(JSON.stringify({ error: authError.message }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    let empresaNombre = null
    let empresaRuc = null
    if (empresa_id) {
      const { data: emp } = await supabaseAdmin
        .from('empresas')
        .select('nombre, ruc')
        .eq('id', empresa_id)
        .single()
      empresaNombre = emp?.nombre || null
      empresaRuc = emp?.ruc || null
    }

    let cargoNombre = null
    if (cargo_id) {
      const { data: carg } = await supabaseAdmin
        .from('cargos')
        .select('nombre')
        .eq('id', cargo_id)
        .single()
      cargoNombre = carg?.nombre || null
    }

    const { error: perfilError } = await supabaseAdmin
      .from('profiles')
      .insert({
        id:                    authData.user.id,
        email:                 email || null,
        nombres,
        apellidos,
        documento_tipo,
        documento_numero,
        telefono:              telefono || null,
        empresa_id,
        empresa:               empresaNombre,
        empresa_ruc:           empresaRuc,
        cargo_id:              cargo_id || null,
        cargo:                 cargoNombre,
        fecha_ingreso:         fecha_ingreso || null,
        rol:                   rol || 'trabajador',
        activo:                true,
        debe_cambiar_password: ['admin', 'gestor'].includes(rol)
      })

    if (perfilError) {
      return new Response(JSON.stringify({ error: perfilError.message }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (empresa_id) {
      const { error: sedeError } = await supabaseAdmin
        .from('perfil_sede')
        .insert(sedesFinal.map((sede: string) => ({
          profile_id: authData.user.id,
          empresa_id,
          sede,
          cargo_id: cargo_id || null,
          fecha_ingreso: fecha_ingreso || null,
          activo: true,
        })))

      if (sedeError) {
        return new Response(JSON.stringify({ error: 'Usuario creado, pero falló al asignar sede: ' + sedeError.message }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
