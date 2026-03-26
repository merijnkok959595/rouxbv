/**
 * ROUX — automatische database-setup via Supabase Management API
 *
 * Gebruik:
 *   SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/setup-db.mjs
 *
 * Token aanmaken: https://supabase.com/dashboard/account/tokens
 * Werkt op elk bestaand Supabase-project (haalt project-ref uit .env.local).
 */

import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT      = resolve(__dirname, '..')

// ── Env laden uit .env.local ────────────────────────────────────────────────
function loadEnv() {
  const envPath = resolve(ROOT, '.env.local')
  const raw = readFileSync(envPath, 'utf8')
  const env = {}
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const val = trimmed.slice(eqIdx + 1).trim()
    env[key] = val
  }
  return env
}

// ── Haal project-ref uit Supabase-URL ──────────────────────────────────────
function extractProjectRef(url) {
  const match = url?.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)
  return match?.[1] ?? null
}

// ── Management API: SQL uitvoeren ───────────────────────────────────────────
async function runSQL(ref, token, query) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${ref}/database/query`,
    {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ query }),
    }
  )
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${json.message ?? JSON.stringify(json)}`)
  }
  return json
}

// ── .env.local bijwerken ────────────────────────────────────────────────────
function updateEnvLocal(key, value) {
  const envPath = resolve(ROOT, '.env.local')
  let content = readFileSync(envPath, 'utf8')
  const re = new RegExp(`^${key}=.*$`, 'm')
  if (re.test(content)) {
    content = content.replace(re, `${key}=${value}`)
  } else {
    content += `\n${key}=${value}\n`
  }
  writeFileSync(envPath, content, 'utf8')
  console.log(`✅  .env.local bijgewerkt: ${key}=${value}`)
}

// ── Hoofd ───────────────────────────────────────────────────────────────────
async function main() {
  const token = process.env.SUPABASE_ACCESS_TOKEN?.trim()
  if (!token) {
    console.error(`
❌  SUPABASE_ACCESS_TOKEN ontbreekt.

Stap 1 — Token aanmaken (eenmalig, 2 minuten):
   → https://supabase.com/dashboard/account/tokens
   → "Generate new token" → naam bijv. "roux-setup" → kopieer de waarde

Stap 2 — Script uitvoeren:
   SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/setup-db.mjs
`)
    process.exit(1)
  }

  const env = loadEnv()
  const ref = extractProjectRef(env.NEXT_PUBLIC_SUPABASE_URL)
  if (!ref) {
    console.error('❌  Kan project-ref niet lezen uit NEXT_PUBLIC_SUPABASE_URL in .env.local.')
    process.exit(1)
  }

  console.log(`\n🔗  Project: ${ref} (${env.NEXT_PUBLIC_SUPABASE_URL})\n`)

  // 1. Migratie uitvoeren
  const sql = readFileSync(resolve(ROOT, 'supabase/migrations/00001_roux_schema.sql'), 'utf8')
  console.log('⏳  Schema aanmaken (organizations + contacts)...')
  try {
    await runSQL(ref, token, sql)
    console.log('✅  Schema klaar.')
  } catch (e) {
    console.error('❌  Schema mislukt:', e.message)
    process.exit(1)
  }

  // 2. Organization UUID ophalen
  console.log('⏳  Organization-UUID ophalen...')
  let orgId
  try {
    const rows = await runSQL(ref, token, 'select id, name from public.organizations limit 1;')
    orgId = Array.isArray(rows) ? rows[0]?.id : rows?.result?.[0]?.id
    if (!orgId) throw new Error('Geen rij gevonden in organizations')
    console.log(`✅  Organization: ${rows[0]?.name ?? 'ROUX'} — id=${orgId}`)
  } catch (e) {
    console.error('❌  Ophalen mislukt:', e.message)
    process.exit(1)
  }

  // 3. .env.local bijwerken
  updateEnvLocal('ORGANIZATION_ID', orgId)

  console.log(`
╔════════════════════════════════════════════════════╗
║  Database ready!                                   ║
║                                                    ║
║  Start de app:  npm run dev:clean                  ║
╚════════════════════════════════════════════════════╝
`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
