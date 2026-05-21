/**
 * fix_auth_users.js
 * Corrige auth.users.email para todos los usuarios activos que NO tienen
 * el formato documento_numero@cvglobal.pe.
 *
 * Uso:
 *   $env:SUPABASE_URL="https://wrahjlstautwinxyqcfx.supabase.co"
 *   $env:SUPABASE_SERVICE_ROLE_KEY="<tu service role key>"
 *   node fix_auth_users.js
 */

const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const LOG_FILE = path.join(__dirname, 'fix_auth_log.txt')
const BATCH_SIZE = 10

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('ERROR: Define SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY como variables de entorno.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
})

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function main() {
  const logLines = []
  const log = (line) => {
    console.log(line)
    logLines.push(line)
  }

  log(`=== fix_auth_users.js — ${new Date().toISOString()} ===`)

  // 1. Leer todos los profiles activos
  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, documento_numero, nombres, apellidos')
    .eq('activo', true)

  if (profilesError) {
    log(`ERROR fatal leyendo profiles: ${profilesError.message}`)
    fs.writeFileSync(LOG_FILE, logLines.join('\n'), 'utf8')
    process.exit(1)
  }

  log(`Profiles activos encontrados: ${profiles.length}`)

  let totalProcesados = 0
  let totalActualizados = 0
  let totalErrores = 0
  let totalOmitidos = 0

  // 2. Procesar en lotes de BATCH_SIZE
  for (let i = 0; i < profiles.length; i += BATCH_SIZE) {
    const lote = profiles.slice(i, i + BATCH_SIZE)

    await Promise.all(lote.map(async (profile) => {
      totalProcesados++

      if (!profile.documento_numero) {
        log(`[OMITIDO] ID: ${profile.id} | sin documento_numero`)
        totalOmitidos++
        return
      }

      const emailCorrecto = `${profile.documento_numero}@cvglobal.pe`

      // Obtener usuario en Auth
      const { data: authData, error: getUserError } = await supabase.auth.admin.getUserById(profile.id)

      if (getUserError) {
        log(`[ERROR] DNI: ${profile.documento_numero} | error obteniendo auth user: ${getUserError.message}`)
        totalErrores++
        return
      }

      const emailActual = authData?.user?.email

      if (!emailActual) {
        log(`[ERROR] DNI: ${profile.documento_numero} | no tiene email en auth.users`)
        totalErrores++
        return
      }

      if (emailActual.endsWith('@cvglobal.pe')) {
        totalOmitidos++
        return
      }

      // Actualizar email en Auth
      const { error: updateError } = await supabase.auth.admin.updateUserById(profile.id, {
        email: emailCorrecto
      })

      if (updateError) {
        log(`[ERROR] DNI: ${profile.documento_numero} | error actualizando: ${updateError.message}`)
        totalErrores++
      } else {
        log(`[OK] DNI: ${profile.documento_numero} | antes: ${emailActual} | después: ${emailCorrecto}`)
        totalActualizados++
      }
    }))

    // Pausa entre lotes para no saturar la API
    if (i + BATCH_SIZE < profiles.length) {
      await sleep(500)
    }
  }

  log('')
  log('=== RESUMEN ===')
  log(`Total procesados : ${totalProcesados}`)
  log(`Actualizados     : ${totalActualizados}`)
  log(`Omitidos (ya OK) : ${totalOmitidos}`)
  log(`Errores          : ${totalErrores}`)

  fs.writeFileSync(LOG_FILE, logLines.join('\n') + '\n', 'utf8')
  console.log(`\nLog guardado en: ${LOG_FILE}`)
}

main().catch(err => {
  console.error('Error inesperado:', err)
  process.exit(1)
})
