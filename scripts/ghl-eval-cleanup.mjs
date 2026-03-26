/**
 * GHL Eval Cleanup
 * Verwijdert alles wat de SUUS eval heeft aangemaakt in GHL:
 *  - Noten aangemaakt in de afgelopen 24 uur op bekende test-contacten
 *  - Taken aangemaakt in de afgelopen 24 uur op bekende test-contacten
 *  - Kalender-afspraken aangemaakt in de afgelopen 24 uur
 *  - Test-contacten (bakkerij janssen / nep eval contacten)
 *
 * Gebruik: node scripts/ghl-eval-cleanup.mjs
 */

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

// ─── Load .env.local ──────────────────────────────────────────────────────────
const __dir = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(__dir, '../.env.local')
const envVars = {}
try {
  readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([^#=]+)=(.*)$/)
    if (m) envVars[m[1].trim()] = m[2].trim()
  })
} catch {
  console.error('❌ Kan .env.local niet lezen')
  process.exit(1)
}

const GHL_KEY = envVars['GHL_API_KEY']
const GHL_LOC = envVars['GHL_LOCATION_ID']

if (!GHL_KEY || !GHL_LOC) {
  console.error('❌ GHL_API_KEY of GHL_LOCATION_ID ontbreekt in .env.local')
  process.exit(1)
}

const BASE = 'https://services.leadconnectorhq.com'
const HEADERS = {
  Authorization: `Bearer ${GHL_KEY}`,
  'Content-Type': 'application/json',
  Version: '2021-07-28',
}

// Hoeveel uur terug we kijken
const HOURS_BACK = 24
const SINCE = new Date(Date.now() - HOURS_BACK * 60 * 60 * 1000)

console.log(`\n🧹 GHL Eval Cleanup — verwijdert items aangemaakt na ${SINCE.toLocaleString('nl-NL')}\n`)

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function ghl(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: HEADERS,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`${method} ${path} → ${res.status}: ${txt.slice(0, 200)}`)
  }
  return res.status === 204 ? null : res.json().catch(() => null)
}

function isRecent(dateStr) {
  if (!dateStr) return false
  return new Date(dateStr) >= SINCE
}

// ─── 1. Zoek test-contacten en verwijder ──────────────────────────────────────

// Namen die de eval mogelijk heeft aangemaakt
const TEST_CONTACT_NAMES = [
  'bakkerij janssen',
  'bakkerij',
  'janssen',
  'eval test',
  'test contact',
]

async function cleanupTestContacts() {
  console.log('👤 Stap 1: Test-contacten zoeken en verwijderen…')
  let deleted = 0

  for (const name of TEST_CONTACT_NAMES) {
    try {
      const data = await ghl('GET', `/contacts/?locationId=${GHL_LOC}&query=${encodeURIComponent(name)}&limit=20`)
      const contacts = data?.contacts ?? []

      for (const c of contacts) {
        if (!isRecent(c.dateAdded)) continue
        // Extra check: naam bevat de zoekterm (case insensitive)
        const fullName = `${c.firstName ?? ''} ${c.lastName ?? ''} ${c.companyName ?? ''}`.toLowerCase()
        if (!TEST_CONTACT_NAMES.some(t => fullName.includes(t))) continue

        console.log(`  🗑  Contact: "${c.firstName ?? ''} ${c.lastName ?? ''}" (${c.companyName ?? ''}) — ${c.id}`)
        await ghl('DELETE', `/contacts/${c.id}`)
        deleted++
      }
    } catch (err) {
      console.warn(`  ⚠  Fout bij zoeken op "${name}":`, err.message)
    }
  }

  console.log(`  ✅ ${deleted} test-contacten verwijderd\n`)
  return deleted
}

// ─── 2. Zoek bekende eval-contacten en verwijder recente noten/taken ──────────

// Contacten die de eval LEEST maar niet aanmaakt (café de boom, de berrie, etc.)
// We zoeken ze op en verwijderen recente noten/taken
const KNOWN_TEST_CONTACTS = [
  'café de boom',
  'de boom',
  'de berrie',
  'de hoef',
  'nachtegaal',
]

async function cleanupNotesAndTasks() {
  console.log('📝 Stap 2: Recente noten en taken op test-contacten verwijderen…')
  let notesDeleted = 0
  let tasksDeleted = 0

  for (const name of KNOWN_TEST_CONTACTS) {
    try {
      const data = await ghl('GET', `/contacts/?locationId=${GHL_LOC}&query=${encodeURIComponent(name)}&limit=10`)
      const contacts = data?.contacts ?? []

      for (const c of contacts) {
        const cName = `${c.firstName ?? ''} ${c.lastName ?? ''} ${c.companyName ?? ''}`.toLowerCase()
        if (!name.split(' ').some(w => cName.includes(w))) continue

        // Recente noten
        try {
          const notesData = await ghl('GET', `/contacts/${c.id}/notes?limit=50`)
          const notes = notesData?.notes ?? []
          for (const n of notes) {
            if (!isRecent(n.dateAdded)) continue
            console.log(`  🗑  Note op "${c.companyName ?? c.firstName}": "${(n.body ?? '').slice(0, 60)}…"`)
            await ghl('DELETE', `/contacts/${c.id}/notes/${n.id}`)
            notesDeleted++
          }
        } catch (err) {
          console.warn(`  ⚠  Notes fout voor ${c.id}:`, err.message)
        }

        // Recente taken
        try {
          const tasksData = await ghl('GET', `/contacts/${c.id}/tasks?limit=50`)
          const tasks = tasksData?.tasks ?? []
          for (const t of tasks) {
            if (!isRecent(t.dateAdded)) continue
            console.log(`  🗑  Task op "${c.companyName ?? c.firstName}": "${(t.title ?? '').slice(0, 60)}"`)
            await ghl('DELETE', `/contacts/${c.id}/tasks/${t.id}`)
            tasksDeleted++
          }
        } catch (err) {
          console.warn(`  ⚠  Tasks fout voor ${c.id}:`, err.message)
        }
      }
    } catch (err) {
      console.warn(`  ⚠  Fout bij "${name}":`, err.message)
    }
  }

  console.log(`  ✅ ${notesDeleted} noten + ${tasksDeleted} taken verwijderd\n`)
  return { notesDeleted, tasksDeleted }
}

// ─── 3. Kalender-afspraken van de afgelopen 24 uur verwijderen ────────────────

async function cleanupCalendarEvents() {
  console.log('📅 Stap 3: Recente kalender-afspraken verwijderen…')
  let deleted = 0

  try {
    const startTime = SINCE.getTime()
    const endTime   = Date.now() + 7 * 24 * 60 * 60 * 1000 // t/m volgende week (eval boekt soms "morgen")

    const data = await ghl(
      'GET',
      `/calendars/events?locationId=${GHL_LOC}&startTime=${startTime}&endTime=${endTime}&limit=100`
    )
    const events = data?.events ?? []

    for (const ev of events) {
      // Alleen afspraken die IN de eval-window aangemaakt zijn
      if (!isRecent(ev.dateAdded ?? ev.createdAt ?? ev.startTime)) continue

      // Skip afspraken die al lang bestonden (bijv. echte afspraken)
      const title = (ev.title ?? ev.name ?? '').toLowerCase()
      console.log(`  🗑  Event: "${ev.title ?? ev.name}" op ${ev.startTime} — ${ev.id}`)
      await ghl('DELETE', `/calendars/events/${ev.id}`)
      deleted++
    }
  } catch (err) {
    console.warn('  ⚠  Kalender fout:', err.message)
  }

  console.log(`  ✅ ${deleted} kalender-items verwijderd\n`)
  return deleted
}

// ─── Run ──────────────────────────────────────────────────────────────────────

async function main() {
  try {
    const contactsDeleted              = await cleanupTestContacts()
    const { notesDeleted, tasksDeleted } = await cleanupNotesAndTasks()
    const eventsDeleted                = await cleanupCalendarEvents()

    const total = contactsDeleted + notesDeleted + tasksDeleted + eventsDeleted
    console.log(`\n✨ Klaar! Totaal verwijderd: ${total} items (${contactsDeleted} contacten, ${notesDeleted} noten, ${tasksDeleted} taken, ${eventsDeleted} agenda-items)`)

    if (total === 0) {
      console.log('\nℹ️  Niets gevonden om op te ruimen. Mogelijk waren de eval-runs al read-only (contact_zoek etc.) of zijn items al weg.')
    }
  } catch (err) {
    console.error('\n❌ Onverwachte fout:', err)
    process.exit(1)
  }
}

main()
