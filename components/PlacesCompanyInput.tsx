'use client'

import { useEffect, useRef } from 'react'

export interface OpeningPeriod {
  open:  { day: number; time: string }
  close: { day: number; time: string }
}

export interface PlaceResult {
  name:          string
  address:       string
  city:          string
  postcode:      string
  country:       string
  opening_hours: OpeningPeriod[] | null
}

interface Props {
  onSelect:      (place: PlaceResult) => void
  initialValue?: string
  inputStyle?:   React.CSSProperties
  className?:    string
  placeholder?:  string
  required?:     boolean
  autoFocus?:    boolean
}

declare global {
  interface Window {
    google?: {
      maps: {
        places: { Autocomplete: new (input: HTMLInputElement, opts?: object) => AutocompleteCtl }
        event: { clearInstanceListeners: (instance: unknown) => void }
      }
    }
  }
}

type GPlace = {
  name?: string
  formatted_address?: string
  address_components?: Array<{ types: string[]; long_name: string; short_name: string }>
  opening_hours?: { periods?: Array<{ open?: { day: number; time: string }; close?: { day: number; time: string } }> }
}

type AutocompleteCtl = {
  addListener: (ev: string, fn: () => void) => void
  getPlace: () => GPlace | undefined
}

function displayCountry(longName: string, shortName: string): string {
  const s = shortName?.toUpperCase?.() ?? ''
  const l = longName?.trim() ?? ''
  if (s === 'NL' || /^netherlands$/i.test(l) || /^the netherlands$/i.test(l)) return 'Nederland'
  return l || 'Nederland'
}

let mapsLoaderPromise: Promise<void> | null = null

/** Loads Maps JS with Places; uses recommended `loading=async` + callback. */
function ensureGoogleMapsPlaces(apiKey: string): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'))
  const g = window.google as Window['google'] | undefined
  if (g?.maps?.places?.Autocomplete) return Promise.resolve()
  if (mapsLoaderPromise) return mapsLoaderPromise

  mapsLoaderPromise = new Promise((resolve, reject) => {
    const id = 'google-maps-js-bootstrap'
    if (document.getElementById(id)) {
      const start = Date.now()
      const t = setInterval(() => {
        if ((window.google as Window['google'])?.maps?.places?.Autocomplete) {
          clearInterval(t)
          resolve()
        }
        if (Date.now() - start > 60_000) {
          clearInterval(t)
          mapsLoaderPromise = null
          reject(new Error('Google Maps load timeout'))
        }
      }, 50)
      return
    }

    const cb = `__gmapsInit_${Math.random().toString(36).slice(2)}`
    ;(window as unknown as Record<string, () => void>)[cb] = () => {
      delete (window as unknown as Record<string, unknown>)[cb]
      resolve()
    }

    const s = document.createElement('script')
    s.id = id
    s.async = true
    s.src =
      `https://maps.googleapis.com/maps/api/js?` +
      new URLSearchParams({
        key: apiKey,
        v: 'weekly',
        libraries: 'places',
        loading: 'async',
        callback: cb,
      }).toString()
    s.onerror = () => {
      delete (window as unknown as Record<string, unknown>)[cb]
      mapsLoaderPromise = null
      reject(new Error('Google Maps script failed to load'))
    }
    document.head.appendChild(s)
  })

  return mapsLoaderPromise
}

export default function PlacesCompanyInput({
  onSelect, initialValue = '', inputStyle, className, placeholder = 'Bedrijfsnaam BV', required, autoFocus,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const acRef    = useRef<AutocompleteCtl | null>(null)
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  // Google Autocomplete mutates the input DOM; a React-controlled value fights it and you can only type one character.
  useEffect(() => {
    const el = inputRef.current
    if (el) el.value = initialValue ?? ''
  }, [initialValue])

  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim()
    if (!apiKey) return

    let cancelled = false

    ;(async () => {
      try {
        await ensureGoogleMapsPlaces(apiKey)
        if (cancelled || !inputRef.current || acRef.current) return

        const Autocomplete = window.google!.maps.places.Autocomplete
        acRef.current = new Autocomplete(inputRef.current, {
          types: ['establishment'],
          componentRestrictions: { country: 'nl' },
          fields: ['name', 'formatted_address', 'address_components', 'opening_hours'],
        })

        acRef.current.addListener('place_changed', () => {
          const place = acRef.current?.getPlace()
          if (!place?.address_components) return

          const get = (t: string) =>
            place.address_components?.find(c => c.types.includes(t))?.long_name ?? ''
          const getShort = (t: string) =>
            place.address_components?.find(c => c.types.includes(t))?.short_name ?? ''

          const address =
            [get('route'), get('street_number')].filter(Boolean).join(' ') ||
            (place.formatted_address ?? '')
          const opening_hours: OpeningPeriod[] | null = place.opening_hours?.periods
            ? place.opening_hours.periods.map(p => ({
                open:  { day: p.open?.day  ?? 0, time: p.open?.time  ?? '0000' },
                close: { day: p.close?.day ?? 0, time: p.close?.time ?? '0000' },
              }))
            : null

          const name = place.name ?? ''
          if (inputRef.current) inputRef.current.value = name
          onSelectRef.current({
            name,
            address,
            city: get('locality') || get('administrative_area_level_2'),
            postcode: getShort('postal_code'),
            country: displayCountry(get('country'), getShort('country')),
            opening_hours,
          })
        })
      } catch (e) {
        console.warn('[PlacesCompanyInput]', e)
      }
    })()

    return () => {
      cancelled = true
      if (acRef.current && window.google?.maps?.event) {
        window.google.maps.event.clearInstanceListeners(acRef.current)
      }
      acRef.current = null
    }
  }, [])

  return (
    <input
      ref={inputRef}
      type="text"
      name="company"
      required={required}
      autoFocus={autoFocus}
      placeholder={placeholder}
      defaultValue={initialValue}
      style={inputStyle}
      className={className}
      autoComplete="off"
    />
  )
}
