/**
 * GoHighLevel REST API client
 * All calls go to: https://services.leadconnectorhq.com
 * Auth: Bearer token from GHL_API_KEY env
 * Location: GHL_LOCATION_ID env
 */

const GHL_BASE  = 'https://services.leadconnectorhq.com'
const GHL_VER   = '2021-07-28'
const GHL_KEY   = () => process.env.GHL_API_KEY?.trim()  ?? ''
const GHL_LOC   = () => process.env.GHL_LOCATION_ID?.trim() ?? ''

// GHL custom field IDs for ROUX
export const CF = {
  groothandel:       'fUZMZLuNMz65vp5jNpTp',
  klantType:         'jcerhe8lM5LZlEAUeiS0', // Lead | Klant
  klantLabel:        'AsuaTiVyw7vvuqTBNaOm', // A | B | C | D
  klantSource:       'Srd2IIqbNrxO13qQ75a2', // Beurs + jaar, e.g. "NHBEURS 2026"
  klantVolume:       'GZlhwSKmwUTIlngZ4ohU', // Numerical revenue
  posMateriaal:      'WA9PsHqzekxw19hb2chh', // Ja | Nee
  kortingsafspraken: 'mlJuMaVbLAmnCmbTVkPk', // Ja | Nee
  openingstijden:    '6zu8D82wfJEImG0b5PMS',
  producten:         'fPuLk5bLImUlE2zITgkf', // Bitterballen | Chorizo kroketje | Risottini Tomaat | Risottini Truffel | Risottini Spinazie
} as const

function headers() {
  return {
    Authorization:  `Bearer ${GHL_KEY()}`,
    Version:        GHL_VER,
    'Content-Type': 'application/json',
    Accept:         'application/json',
  }
}

async function ghl<T>(path: string, init: RequestInit = {}, attempt = 0): Promise<T> {
  const res = await fetch(`${GHL_BASE}${path}`, {
    ...init,
    headers: { ...headers(), ...(init.headers as Record<string, string> ?? {}) },
    cache: 'no-store',
  })

  // Exponential backoff for rate limits and transient server errors
  if ((res.status === 429 || res.status === 503) && attempt < 4) {
    const retryAfter = Number(res.headers.get('Retry-After') ?? 0)
    const delay = retryAfter * 1000 || Math.min(500 * 2 ** attempt, 8000) // 500ms, 1s, 2s, 4s
    await new Promise(r => setTimeout(r, delay))
    return ghl<T>(path, init, attempt + 1)
  }

  const text = await res.text()
  try { return JSON.parse(text) as T }
  catch { return { error: text, status: res.status } as T }
}

// ─── Contacts ─────────────────────────────────────────────────────────────────

/** Simple GET search — kept for legacy internal use */
export async function contactSearch(query: string, limit = 10) {
  const q = encodeURIComponent(query)
  return ghl<{ contacts: GHLContact[]; count: number }>(
    `/contacts/?locationId=${GHL_LOC()}&query=${q}&limit=${limit}`,
  )
}

/**
 * Advanced POST /contacts/search
 * Supports OR filter groups on name tokens + optional city AND filter.
 * Used by the contact_zoek tool with Google Places fallback.
 */
export async function contactSearchAdvanced(params: {
  searchTerms?: string[]
  cityFilter?:  string
  query?:       string   // exact email or phone
  pageLimit?:   number
}) {
  const { searchTerms, cityFilter, query, pageLimit = 20 } = params
  let body: Record<string, unknown>

  if (query) {
    body = { locationId: GHL_LOC(), pageLimit, page: 1, query }
  } else if (searchTerms?.length) {
    const items: Record<string, string>[] = []
    for (const term of searchTerms) {
      const v = term.toLowerCase().trim()
      if (v.length < 3) continue
      for (const field of ['companyName', 'firstNameLowerCase', 'lastNameLowerCase']) {
        items.push({ field, operator: 'contains', value: v })
      }
    }
    const orGroup = { group: 'OR', filters: items }
    const filters: unknown[] = cityFilter
      ? [orGroup, { field: 'city', operator: 'contains', value: cityFilter.toLowerCase() }]
      : [orGroup]
    body = { locationId: GHL_LOC(), pageLimit, page: 1, filters }
  } else {
    return { contacts: [], count: 0 }
  }

  return ghl<{ contacts: GHLContact[]; count: number }>('/contacts/search', {
    method: 'POST',
    body:   JSON.stringify(body),
  })
}

export async function contactGet(contactId: string) {
  return ghl<{ contact: GHLContact }>(`/contacts/${contactId}`)
}

export async function contactCreate(data: Partial<GHLContactInput>) {
  return ghl<{ contact: GHLContact }>('/contacts/', {
    method: 'POST',
    body: JSON.stringify({ locationId: GHL_LOC(), ...data }),
  })
}

/** Find or create the dedicated eval test contact. Returns the contact ID. */
export async function upsertEvalTestContact(): Promise<string> {
  const TEST_EMAIL = 'eval@suus-test.local'
  // Try to find existing test contact by email
  const found = await contactSearch(TEST_EMAIL, 1)
  const existing = found?.contacts?.[0]
  if (existing?.id) return existing.id
  // Create if not found
  const created = await contactCreate({
    firstName:   'TEST',
    lastName:    'SUUS EVAL',
    email:       TEST_EMAIL,
    companyName: '🧪 TEST SUUS EVAL',
  })
  return created?.contact?.id ?? ''
}

export async function contactUpdate(contactId: string, data: Partial<GHLContactInput>) {
  return ghl<{ contact: GHLContact }>(`/contacts/${contactId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  })
}

// ─── Notes ────────────────────────────────────────────────────────────────────

export async function noteList(contactId: string) {
  return ghl<{ notes: GHLNote[] }>(`/contacts/${contactId}/notes`)
}

export async function noteCreate(contactId: string, body: string, userId: string) {
  return ghl<{ note: GHLNote }>(`/contacts/${contactId}/notes`, {
    method: 'POST',
    body: JSON.stringify({ body, userId }),
  })
}

export async function noteUpdate(contactId: string, noteId: string, body: string, userId: string) {
  return ghl<{ note: GHLNote }>(`/contacts/${contactId}/notes/${noteId}`, {
    method: 'PUT',
    body: JSON.stringify({ body, userId }),
  })
}

// ─── Tasks ────────────────────────────────────────────────────────────────────

export async function taskList(contactId: string) {
  return ghl<{ tasks: GHLTask[] }>(`/contacts/${contactId}/tasks`)
}

export async function taskCreate(contactId: string, data: {
  title: string; body?: string; dueDate: string; assignedTo: string
}) {
  return ghl<{ task: GHLTask }>(`/contacts/${contactId}/tasks`, {
    method: 'POST',
    body: JSON.stringify({ ...data, completed: false }),
  })
}

export async function taskUpdate(contactId: string, taskId: string, data: {
  title?: string; body?: string; dueDate?: string; assignedTo?: string; completed?: boolean
}) {
  return ghl<{ task: GHLTask }>(`/contacts/${contactId}/tasks/${taskId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  })
}

// ─── Calendar ─────────────────────────────────────────────────────────────────

export async function calendarGetMany(userId: string, startDate: string, endDate: string) {
  const tz       = 'Europe/Amsterdam'
  const offset   = '+02:00' // close enough; GHL uses the timestamp
  const start    = new Date(`${startDate}T00:00:00${offset}`).getTime()
  const end      = new Date(`${endDate}T23:59:59${offset}`).getTime()
  return ghl<{ events: GHLCalendarEvent[] }>(
    `/calendars/events?locationId=${GHL_LOC()}&userId=${userId}&startTime=${start}&endTime=${end}`,
  )
}

export async function calendarGetFreeSlots(calendarId: string, date: string) {
  const offset = '+02:00'
  const start  = new Date(`${date}T00:00:00${offset}`).getTime()
  const end    = new Date(`${date}T23:59:59${offset}`).getTime()
  return ghl<Record<string, { slots: string[] }>>(
    `/calendars/${calendarId}/free-slots?startDate=${start}&endDate=${end}&timezone=Europe%2FAmsterdam`,
  )
}

export async function calendarCreateAppointment(data: {
  contactId: string; calendarId: string; title: string
  startTime: string; endTime: string; notes?: string
}) {
  return ghl<{ appointment: GHLAppointment }>('/calendars/events/appointments', {
    method: 'POST',
    body: JSON.stringify({ locationId: GHL_LOC(), ...data }),
  })
}

export async function calendarBlockSlot(data: {
  calendarId: string; title: string; startTime: string; endTime: string
  description?: string; secondCalendarId?: string
}) {
  const { secondCalendarId, ...rest } = data
  // Block own calendar
  const result = await ghl<unknown>('/calendars/blocked-slots', {
    method: 'POST',
    body: JSON.stringify({ locationId: GHL_LOC(), ...rest }),
  })
  // Optionally also block colleague's calendar
  if (secondCalendarId) {
    await ghl<unknown>('/calendars/blocked-slots', {
      method: 'POST',
      body: JSON.stringify({ locationId: GHL_LOC(), ...rest, calendarId: secondCalendarId }),
    }).catch(() => { /* non-fatal */ })
  }
  return result
}

export async function calendarGetAppointment(appointmentId: string) {
  return ghl<{ appointment: GHLAppointment }>(
    `/calendars/events/appointments/${appointmentId}`,
  )
}

export async function calendarUpdateAppointment(appointmentId: string, data: {
  title?: string; startTime?: string; endTime?: string; notes?: string
}) {
  return ghl<{ appointment: GHLAppointment }>(
    `/calendars/events/appointments/${appointmentId}`,
    { method: 'PUT', body: JSON.stringify({ locationId: GHL_LOC(), ...data }) },
  )
}

// ─── Query normalizer (pure TS — no LLM cost) ────────────────────────────────

// Common Dutch cities for detection
const NL_CITIES = new Set([
  'amsterdam','rotterdam','alkmaar','haarlem','utrecht','eindhoven','groningen',
  'tilburg','breda','nijmegen','leiden','delft','dordrecht','arnhem','zaandam',
  'heerhugowaard','hoorn','purmerend','beverwijk','bergen','schagen','den helder',
  'venlo','maastricht','zwolle','deventer','enschede','apeldoorn','almere',
  'leeuwarden','assen','emmen','middelburg','goes','vlissingen',
])

// Dutch stop words that don't help in search
const NL_STOP = new Set([
  'de','het','een','van','in','op','bij','voor','en','is','er','aan','met',
  'het','den','der','des','cafe','restaurant','hotel','bakkerij','slagerij',
])

/**
 * Normalize a raw user query into structured search parameters.
 * Handles: phone/email direct lookup, city detection, stop word stripping.
 * No LLM call needed for the common case.
 */
export function normalizeContactQuery(raw: string): {
  searchTerms?: string[]
  cityFilter?:  string
  query?:       string
} {
  const trimmed = raw.trim()

  // Direct phone lookup
  if (/^\+?[\d\s\-().]{8,}$/.test(trimmed)) {
    return { query: trimmed.replace(/[\s\-().]/g, '') }
  }
  // Direct email lookup
  if (trimmed.includes('@') && trimmed.includes('.')) {
    return { query: trimmed.toLowerCase() }
  }

  const parts = trimmed
    .toLowerCase()
    .replace(/['"]/g, '')
    .split(/[\s,;]+/)
    .map(p => p.replace(/[^a-z0-9\u00C0-\u024F]/g, ''))
    .filter(p => p.length >= 3)

  let cityFilter: string | undefined
  const tokens: string[] = []

  for (const part of parts) {
    if (NL_CITIES.has(part)) {
      cityFilter = part
    } else if (!NL_STOP.has(part)) {
      tokens.push(part)
    }
  }

  return { searchTerms: tokens.length ? tokens : parts, cityFilter }
}

// ─── Google Places (address lookup) ──────────────────────────────────────────

export async function googleZoekAdres(query: string) {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim()
  if (!key) return { found: false, error: 'No Google Maps key' }
  try {
    // Text Search
    const searchRes  = await fetch(
      `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${key}&language=nl&region=nl`,
      { cache: 'no-store' },
    )
    const searchData = await searchRes.json()
    const place      = searchData.results?.[0]
    if (!place) return { found: false }

    // Place Details
    const detailRes  = await fetch(
      `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&fields=name,formatted_address,address_components,geometry,formatted_phone_number,website,opening_hours&key=${key}&language=nl`,
      { cache: 'no-store' },
    )
    const detailData = await detailRes.json()
    const detail     = detailData.result
    if (!detail) return { found: false }

    const comps     = detail.address_components ?? []
    const get       = (type: string) => comps.find((c: { types: string[] }) => c.types.includes(type))?.long_name ?? ''
    const street    = `${get('route')} ${get('street_number')}`.trim()
    const postcode  = get('postal_code')
    const city      = get('locality') || get('administrative_area_level_2')
    const country   = comps.find((c: { types: string[] }) => c.types.includes('country'))?.short_name ?? 'NL'
    const hours     = detail.opening_hours?.weekday_text?.join(', ') ?? null

    return {
      found:     true,
      name:      detail.name,
      formatted: detail.formatted_address,
      address1:  street,
      postalCode: postcode,
      city,
      country,
      phone:     detail.formatted_phone_number ?? null,
      website:   detail.website ?? null,
      openingHours: hours,
    }
  } catch (err) {
    return { found: false, error: String(err) }
  }
}

// ─── Helper: build custom_fields array ───────────────────────────────────────

export function buildCustomFields(data: {
  groothandel?:       string
  klantType?:         string
  klantLabel?:        string
  klantSource?:       string
  klantVolume?:       number | string
  posMateriaal?:      string
  kortingsafspraken?: string
  openingstijden?:    string
  producten?:         string
}) {
  const cf: { id: string; value: string }[] = []
  if (data.groothandel)       cf.push({ id: CF.groothandel,       value: data.groothandel })
  if (data.klantType)         cf.push({ id: CF.klantType,         value: data.klantType })
  if (data.klantLabel)        cf.push({ id: CF.klantLabel,        value: data.klantLabel })
  if (data.klantSource)       cf.push({ id: CF.klantSource,       value: data.klantSource })
  if (data.klantVolume != null) cf.push({ id: CF.klantVolume,     value: String(data.klantVolume) })
  if (data.posMateriaal)      cf.push({ id: CF.posMateriaal,      value: data.posMateriaal })
  if (data.kortingsafspraken) cf.push({ id: CF.kortingsafspraken, value: data.kortingsafspraken })
  if (data.openingstijden)    cf.push({ id: CF.openingstijden,    value: data.openingstijden })
  if (data.producten)         cf.push({ id: CF.producten,         value: data.producten })
  return cf.length ? cf : undefined
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GHLContact {
  id:          string
  contactId?:  string
  firstName?:  string
  lastName?:   string
  email?:      string
  phone?:      string
  companyName?: string
  address1?:   string
  postalCode?: string
  city?:       string
  country?:    string
  customFields?: { id: string; value: string }[]
}

export interface GHLContactInput {
  firstName?:    string
  lastName?:     string
  email?:        string
  phone?:        string
  companyName?:  string
  address1?:     string
  postalCode?:   string
  city?:         string
  country?:      string
  customFields?: { id: string; value: string }[]
}

export interface GHLNote {
  id:        string
  body:      string
  createdAt: string
  userId:    string
}

export interface GHLTask {
  id:         string
  title:      string
  body?:      string
  dueDate:    string
  completed:  boolean
  assignedTo: string
}

export interface GHLCalendarEvent {
  id:         string
  title:      string
  startTime:  string
  endTime:    string
  contactId?: string
  status?:    string
}

export interface GHLAppointment {
  id:          string
  title:       string
  startTime:   string
  endTime:     string
  contactId?:  string
  calendarId?: string
  notes?:      string
  status?:     string
}
