import { NextResponse } from 'next/server'
import { resolveOrgId, adminDb } from '@/lib/auth/resolveOrg'

const COLOR_PALETTE = [
  '#6366F1', '#8B5CF6', '#0EA5E9', '#64748B',
  '#F59E0B', '#EF4444', '#EC4899', '#14B8A6', '#F97316',
]

/**
 * Expands CSV postcode range strings to 2-digit prefix arrays for startsWith matching.
 * "*" = all Netherlands → empty array (matches everything via fallback).
 * "1000-1199,1300-1399" → ["10","11","13"]
 */
function expandRanges(raw: string): string[] {
  if (!raw || raw.trim() === '*') return []
  const prefixes = new Set<string>()
  for (const part of raw.split(',')) {
    const [startStr, endStr] = part.trim().split('-')
    const start = parseInt(startStr, 10)
    const end   = endStr ? parseInt(endStr, 10) : start
    if (isNaN(start)) continue
    const pStart = Math.floor(start / 100)
    const pEnd   = Math.floor(end   / 100)
    for (let p = pStart; p <= pEnd; p++) {
      prefixes.add(String(p).padStart(2, '0'))
    }
  }
  return Array.from(prefixes).sort()
}

const CSV_USERS = [
  { naam: 'Sanne',              ghl_user_id: 'F0UHpPHLihJgfG9QjevO', calendar_id: '',                         phone: '',             functie: 'Medewerker',    rayon: 'Heel Nederland',                   postcode_ranges: '*' },
  { naam: 'Ronald Stavenuiter', ghl_user_id: 'LfuAg3aLnxMEHjTbOmSJ', calendar_id: 'vMyAj2aTgafYmfxjRphd',    phone: '31653262771',  functie: 'Account Manager', rayon: 'Noord-Holland / Friesland',       postcode_ranges: '1000-1199,1100-1119,1300-1399,1400-1889,1900-1999,2000-2099,3400-3499,7700-7999,8000-9299,8200-8299,9700-9999' },
  { naam: 'Dick Rol',           ghl_user_id: 'VqOfGuqAey5sxIfo8Z8A', calendar_id: 'O2gP3ie5jb1vVp1b0Of2',    phone: '31625150376',  functie: 'Account Manager', rayon: 'Zuid-Holland / Zeeland',           postcode_ranges: '2100-2199,2200-3399,4000-4099,4100-4199,4200-4299,4300-4699' },
  { naam: 'Marscha Snoeken',    ghl_user_id: 'GiPzqTrPqyIRP5fHNiHH', calendar_id: 'klhJ3tksjI8UE3rfwraH',    phone: '31631000362',  functie: 'Account Manager', rayon: 'Overijssel / Groningen / Drenthe', postcode_ranges: '1200-1399,3500-3999,6500-7399,7400-7699,8000-8299,8300-8399,9300-9399,9400-9499,9500-9599,9600-9699' },
  { naam: 'Ralph Oenstra',      ghl_user_id: 'WkNyqmsMyXemi46mKHwp', calendar_id: 'LJTS59YxojV82HZpnwfW',    phone: '31611865464',  functie: 'Account Manager', rayon: 'Noord-Brabant / Limburg',          postcode_ranges: '4700-5299,5300-5399,5400-5499,5500-5599,5600-5999,5800-6599' },
  { naam: 'Vincent Jongens',    ghl_user_id: 'QniTAkf9ukC3aSlOJ0ja', calendar_id: 'sUWSaGULtR9HXqBLkTGr',    phone: '31613853851',  functie: 'Eigenaar',         rayon: 'Heel Nederland',                  postcode_ranges: '*' },
  { naam: 'Merijn Kok',         ghl_user_id: 'ShhTPAw4QYMM7N714xec', calendar_id: '0GtDEkz9uptiLv5WMutP',    phone: '31627207989',  functie: 'Eigenaar',         rayon: 'Heel Nederland',                  postcode_ranges: '*' },
  { naam: 'Kim Groot',          ghl_user_id: 'oqAcQRbcGuVn8jNv9Pp9', calendar_id: 'LOfyWVIdzLSIKwRBha97',    phone: '31623342475',  functie: 'Eigenaar',         rayon: 'Heel Nederland',                  postcode_ranges: '*' },
  { naam: 'Isabelle Schuurman', ghl_user_id: 'DBhBVjYrtlcArG7DI81j', calendar_id: 'KH9GNd61fXCV6hz4MJMm',    phone: '31630172557',  functie: 'Medewerker',       rayon: 'Heel Nederland',                  postcode_ranges: '*' },
]

export async function POST() {
  const oid = await resolveOrgId()
  if (!oid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = adminDb()

  const rows = CSV_USERS.map((u, i) => ({
    organization_id: oid,
    naam:            u.naam,
    phone:           u.phone  || null,
    functie:         u.functie,
    rayon:           u.rayon,
    ghl_user_id:     u.ghl_user_id || null,
    calendar_id:     u.calendar_id || null,
    postcode_ranges: expandRanges(u.postcode_ranges),
    color:           COLOR_PALETTE[i % COLOR_PALETTE.length],
    active:          true,
  }))

  // Delete existing members for this org, then re-insert clean
  await db.from('team_members').delete().eq('organization_id', oid)

  const { data, error } = await db
    .from('team_members')
    .insert(rows)
    .select('id, naam')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ inserted: data?.length ?? 0, users: data?.map(r => r.naam) })
}
