'use client'

import { useEffect, useRef, useState } from 'react'

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
  placeholder?:  string
  required?:     boolean
  autoFocus?:    boolean
}

declare global {
  interface Window { google: any }
}

export default function PlacesCompanyInput({
  onSelect, initialValue = '', inputStyle, placeholder = 'Bedrijfsnaam BV', required, autoFocus,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const acRef    = useRef<any>(null)
  const [loaded, setLoaded] = useState(false)
  const [value,  setValue]  = useState(initialValue)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
    if (!apiKey) return

    if (window.google?.maps?.places) { init(); return }

    const id = 'google-maps-script'
    if (!document.getElementById(id)) {
      const s = document.createElement('script')
      s.id = id
      s.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`
      s.async = true; s.defer = true
      s.onload = () => setLoaded(true)
      document.head.appendChild(s)
    } else {
      if (window.google?.maps?.places) { setLoaded(true); return }
      document.getElementById(id)?.addEventListener('load', () => setLoaded(true))
    }
  }, [])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (loaded || window.google?.maps?.places) init() }, [loaded])

  function init() {
    if (!inputRef.current || acRef.current) return
    try {
      acRef.current = new window.google.maps.places.Autocomplete(inputRef.current, {
        types: ['establishment'],
        componentRestrictions: { country: 'nl' },
        fields: ['name', 'formatted_address', 'address_components', 'opening_hours'],
      })
      acRef.current.addListener('place_changed', () => {
        const place = acRef.current.getPlace()
        if (!place?.address_components) return

        const get = (t: string) =>
          place.address_components?.find((c: any) => c.types.includes(t))?.long_name ?? ''
        const getShort = (t: string) =>
          place.address_components?.find((c: any) => c.types.includes(t))?.short_name ?? ''

        const address = [get('route'), get('street_number')].filter(Boolean).join(' ') || (place.formatted_address ?? '')
        const opening_hours: OpeningPeriod[] | null = place.opening_hours?.periods
          ? place.opening_hours.periods.map((p: any) => ({
              open:  { day: p.open?.day  ?? 0, time: p.open?.time  ?? '0000' },
              close: { day: p.close?.day ?? 0, time: p.close?.time ?? '0000' },
            }))
          : null

        const name = place.name ?? ''
        setValue(name)
        onSelect({ name, address, city: get('locality') || get('administrative_area_level_2'), postcode: getShort('postal_code'), country: get('country'), opening_hours })
      })
    } catch { /* Google not available */ }
  }

  return (
    <input
      ref={inputRef}
      type="text"
      name="company"
      required={required}
      autoFocus={autoFocus}
      placeholder={placeholder}
      value={value}
      onChange={e => setValue(e.target.value)}
      style={inputStyle}
      autoComplete="off"
    />
  )
}
