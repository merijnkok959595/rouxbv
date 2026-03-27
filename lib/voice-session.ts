/**
 * Server-side voice session store.
 * Keyed by session_id (WebRTC) or call_id (SIP).
 * In-memory with 2-hour TTL — no DB needed for voice sessions.
 */

export type VoicePhase =
  | 'intent'           // Start — intent not yet determined
  | 'existing_search'  // Looking up an existing contact
  | 'new_create'       // Creating a new contact
  | 'no_contact'       // Agenda / stats — no contact needed
  | 'selected'         // Contact found/created, ready for actions
  | 'main_menu'        // Alias for selected + action chosen

export interface SelectedContact {
  id:       string
  name:     string  // voornaam + achternaam
  company:  string
  type?:    string  // lead | customer
}

export interface VoiceSession {
  phase:           VoicePhase
  selectedContact: SelectedContact | null
  /** Employee context — set when session starts */
  userId?:         string  // GHL user ID
  calendarId?:     string
  userNaam?:       string
  createdAt:       number
  lastActivity:    number
}

const TTL_MS = 2 * 60 * 60 * 1000 // 2 hours
const store  = new Map<string, VoiceSession>()

// Purge expired sessions periodically
function purge() {
  const now = Date.now()
  for (const [key, session] of store) {
    if (now - session.lastActivity > TTL_MS) store.delete(key)
  }
}
setInterval(purge, 15 * 60 * 1000) // every 15 min

// ── Public API ───────────────────────────────────────────────────────────────

export function getSession(sessionId: string): VoiceSession | null {
  const s = store.get(sessionId)
  if (!s) return null
  if (Date.now() - s.lastActivity > TTL_MS) { store.delete(sessionId); return null }
  s.lastActivity = Date.now()
  return s
}

export function initSession(sessionId: string, opts?: Partial<Pick<VoiceSession, 'userId' | 'calendarId' | 'userNaam'>>): VoiceSession {
  const existing = getSession(sessionId)
  if (existing) return existing
  const session: VoiceSession = {
    phase:           'intent',
    selectedContact: null,
    userId:          opts?.userId,
    calendarId:      opts?.calendarId,
    userNaam:        opts?.userNaam,
    createdAt:       Date.now(),
    lastActivity:    Date.now(),
  }
  store.set(sessionId, session)
  return session
}

export function setSelectedContact(sessionId: string, contact: SelectedContact): void {
  const s = store.get(sessionId)
  if (!s) return
  s.selectedContact = contact
  s.phase           = 'selected'
  s.lastActivity    = Date.now()
}

export function setPhase(sessionId: string, phase: VoicePhase): void {
  const s = store.get(sessionId)
  if (!s) return
  s.phase        = phase
  s.lastActivity = Date.now()
}

export function clearSelectedContact(sessionId: string): void {
  const s = store.get(sessionId)
  if (!s) return
  s.selectedContact = null
  s.phase           = 'intent'
  s.lastActivity    = Date.now()
}

export function clearSession(sessionId: string): void {
  store.delete(sessionId)
}

/** Returns a human-readable summary for injection into system prompt */
export function sessionContextString(sessionId: string): string {
  const s = getSession(sessionId)
  if (!s?.selectedContact) return 'Geselecteerd contact: geen'
  const c = s.selectedContact
  return `Geselecteerd contact: ${c.name} — ${c.company} (ID: ${c.id}${c.type ? `, ${c.type}` : ''})`
}
