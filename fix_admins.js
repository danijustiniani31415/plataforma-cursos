/**
 * fix_admins.js
 * Para admin/superadmin/gestor: auth.users.email → profiles.email (email real).
 *
 * Uso:
 *   $env:SUPABASE_URL="https://wrahjlstautwinxyqcfx.supabase.co"
 *   $env:SUPABASE_SERVICE_ROLE_KEY="<service role key>"
 *   node fix_admins.js
 */

const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const LOG_FILE = path.join(__dirname, 'fix_admins_log.txt')
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
  const log = (line) => { console.log(line); logLines.push(line) }

  log(`=== fix_admins.js — ${new Date().toISOString()} ===`)

  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id, documento_numero, email, rol, nombres, apellidos')
    .in('rol', ['admin', 'superadmin', 'gestor'])

  if (error) {
    log(`ERROR fatal leyendo profiles: ${error.message}`)
    fs.writeFileSync(LOG_FILE, logLines.join('\n'), 'utf8')
    process.exit(1)
  }

  log(`Admins/gestores/superadmin encontrados: ${profiles.length}`)

  let totalProcesados = 0, totalActualizados = 0, totalErrores = 0, totalOmitidos = 0

  for (let i = 0; i < profiles.length; i += BATCH_SIZE) {
    const lote = profiles.slice(i, i + BATCH_SIZE)

    await Promise.all(lote.map(async (profile) => {
      totalProcesados++

      if (!profile.email) {
        log(`[OMITIDO] DNI: ${profile.documento_numero} | rol: ${profile.rol} | sin email en profiles`)
        totalOmitidos++
        return
      }

      const { data: authData, error: getUserError } = await supabase.auth.admin.getUserById(profile.id)
      if (getUserError) {
        log(`[ERROR] DNI: ${profile.documento_numero} | error obteniendo auth user: ${getUserError.message}`)
        totalErrores++
        return
      }

      const emailActual = authData?.user?.email
      if (emailActual === profile.email) {
        totalOmitidos++
        return
      }

      const { error: updateError } = await supabase.auth.admin.updateUserById(profile.id, {
        email: profile.email
      })

      if (updateError) {
        log(`[ERROR] DNI: ${profile.documento_numero} | rol: ${profile.rol} | error: ${updateError.message}`)
        totalErrores++
      } else {
        log(`[OK] DNI: ${profile.documento_numero} | rol: ${profile.rol} | antes: ${emailActual} | después: ${profile.email}`)
        totalActualizados++
      }
    }))

    if (i + BATCH_SIZE < profiles.length) await sleep(500)
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

main().catch(err => { console.error('Error inesperado:', err); process.exit(1) })
