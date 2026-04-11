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

    const { usuario_id, updates } = await req.json()

    if (!usuario_id || !updates || Object.keys(updates).length === 0) {
      return new Response(JSON.stringify({ error: 'Datos incompletos' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Actualizar tabla profiles
    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .update(updates)
      .eq('id', usuario_id)

    if (profileError) throw new Error(profileError.message)

    // Si el email cambió, actualizar también en Supabase Auth
    if (updates.email) {
      const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(
        usuario_id,
        { email: updates.email }
      )
      if (authError) throw new Error('Auth: ' + authError.message)
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
