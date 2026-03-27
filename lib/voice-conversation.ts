/**
 * In-memory conversation store for Twilio phone calls (STT → LLM → TTS pipeline).
 * Keyed by Twilio CallSid. 2-hour TTL.
 * Same approach as voice-session.ts — works fine for warm Vercel containers.
 */

export interface VoiceConversation {
  callSid:    string
  messages:   { role: 'user' | 'assistant'; content: string }[]
  systemPrompt: string
  userId?:    string
  calendarId?: string
  userNaam?:  string
  silenceCount: number   // how many consecutive silent turns
  lastActivity: number
}

const TTL_MS = 2 * 60 * 60 * 1000  // 2 hours
const store  = new Map<string, VoiceConversation>()

setInterval(() => {
  const now = Date.now()
  for (const [k, v] of store) {
    if (now - v.lastActivity > TTL_MS) store.delete(k)
  }
}, 15 * 60 * 1000)

export function initVoiceConv(
  callSid:   string,
  opts: { systemPrompt: string; userId?: string; calendarId?: string; userNaam?: string },
): VoiceConversation {
  const s: VoiceConversation = {
    callSid,
    messages:      [],
    systemPrompt:  opts.systemPrompt,
    userId:        opts.userId,
    calendarId:    opts.calendarId,
    userNaam:      opts.userNaam,
    silenceCount:  0,
    lastActivity:  Date.now(),
  }
  store.set(callSid, s)
  return s
}

export function getVoiceConv(callSid: string): VoiceConversation | null {
  const s = store.get(callSid)
  if (!s) return null
  if (Date.now() - s.lastActivity > TTL_MS) { store.delete(callSid); return null }
  s.lastActivity = Date.now()
  return s
}

export function clearVoiceConv(callSid: string) {
  store.delete(callSid)
}
