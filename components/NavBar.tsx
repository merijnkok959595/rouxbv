'use client'

import Link                        from 'next/link'
import { usePathname }             from 'next/navigation'
import { useState }                from 'react'
import { useEmployee }             from '@/lib/employee-context'

const NAV = [
  { href: '/suus',         label: 'SUUS'         },
  { href: '/formulier',    label: 'Formulier'     },
  { href: '/leads',        label: 'Leads'         },
  { href: '/instellingen', label: 'Instellingen'  },
  { href: '/admin',        label: 'Admin'         },
  { href: '/test',         label: 'Test'          },
]

export default function NavBar() {
  const pathname = usePathname()
  const { employees, activeEmployee, setActiveEmployee } = useEmployee()
  const [open, setOpen] = useState(false)

  return (
    <nav className="roux-nav" style={{ position: 'relative', zIndex: 200 }}>
      <Link href="/" className="roux-nav-logo">ROUX</Link>

      <div className="roux-nav-items">
        {NAV.map(({ href, label }) => {
          const active = pathname === href || pathname.startsWith(href + '/')
          return (
            <Link
              key={href}
              href={href}
              className={`roux-nav-item${active ? ' active' : ''}`}
            >
              {label}
            </Link>
          )
        })}
      </div>

      {/* Employee selector — top right */}
      {employees.length > 0 && (
        <div style={{ marginLeft: 'auto', position: 'relative' }}>
          <button
            onClick={() => setOpen(o => !o)}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '3px 10px 3px 7px', borderRadius: '20px',
              border: '1px solid var(--border)',
              backgroundColor: open ? 'var(--bg)' : 'transparent',
              cursor: 'pointer', fontSize: '12px', color: 'var(--text)',
              whiteSpace: 'nowrap',
            }}
          >
            <span style={{ width: '9px', height: '9px', borderRadius: '50%', backgroundColor: activeEmployee?.color ?? '#888', flexShrink: 0, display: 'inline-block' }} />
            <span style={{ fontWeight: 500 }}>{activeEmployee?.naam ?? '—'}</span>
            <span style={{ color: 'var(--muted)', fontSize: '9px', marginLeft: '1px' }}>▾</span>
          </button>

          {open && (
            <>
              {/* Backdrop */}
              <div
                onClick={() => setOpen(false)}
                style={{ position: 'fixed', inset: 0, zIndex: 99 }}
              />
              <div style={{
                position: 'absolute', right: 0, top: 'calc(100% + 8px)',
                backgroundColor: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: '10px', boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                minWidth: '190px', overflow: 'hidden', zIndex: 100,
              }}>
                <div style={{ padding: '8px 12px 6px', fontSize: '10px', color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid var(--border)' }}>
                  Ingelogd als
                </div>
                {employees.map(emp => (
                  <button
                    key={emp.id}
                    onClick={() => { setActiveEmployee(emp); setOpen(false) }}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: '9px',
                      padding: '9px 14px', border: 'none',
                      backgroundColor: activeEmployee?.id === emp.id ? 'var(--bg)' : 'transparent',
                      cursor: 'pointer', textAlign: 'left', fontSize: '13px', color: 'var(--text)',
                    }}
                  >
                    <span style={{ width: '9px', height: '9px', borderRadius: '50%', backgroundColor: emp.color ?? '#888', flexShrink: 0, display: 'inline-block' }} />
                    <span style={{ flex: 1 }}>{emp.naam}</span>
                    <span style={{ fontSize: '10px', color: emp.color ?? 'var(--muted)', backgroundColor: `${emp.color ?? '#888'}18`, padding: '2px 6px', borderRadius: '8px', fontWeight: 600 }}>
                      {(emp.functie ?? '').slice(0, 2).toUpperCase() || '—'}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </nav>
  )
}
