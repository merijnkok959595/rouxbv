'use client'

import Link            from 'next/link'
import { usePathname } from 'next/navigation'
import { useState }    from 'react'
import { useEmployee } from '@/lib/employee-context'
import { cn }          from '@/lib/utils'

const NAV = [
  { href: '/suus',         label: 'SUUS'        },
  { href: '/formulier',    label: 'Formulier'    },
  { href: '/leads',        label: 'Leads'        },
  { href: '/instellingen', label: 'Instellingen' },
  { href: '/admin',        label: 'Admin'        },
  { href: '/test',         label: 'Test'         },
]

export default function NavBar() {
  const pathname = usePathname()
  const { employees, activeEmployee, setActiveEmployee } = useEmployee()
  const [open, setOpen] = useState(false)

  return (
    <nav className="roux-nav relative z-[200]">
      <Link href="/" className="roux-nav-logo">ROUX</Link>

      <div className="roux-nav-items">
        {NAV.map(({ href, label }) => {
          const active = pathname === href || pathname.startsWith(href + '/')
          return (
            <Link key={href} href={href} className={cn('roux-nav-item', active && 'active')}>
              {label}
            </Link>
          )
        })}
      </div>

      {employees.length > 0 && (
        <div className="ml-auto relative">
          <button
            onClick={() => setOpen(o => !o)}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 pl-[7px] rounded-full border border-border',
              'text-xs text-primary whitespace-nowrap cursor-pointer bg-transparent transition-colors',
              open && 'bg-bg',
            )}
          >
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 inline-block"
              style={{ backgroundColor: activeEmployee?.color ?? '#888' }} />
            <span className="font-medium">{activeEmployee?.naam ?? '—'}</span>
            <span className="text-muted text-[9px] ml-px">▾</span>
          </button>

          {open && (
            <>
              <div className="fixed inset-0 z-[99]" onClick={() => setOpen(false)} />
              <div className="absolute right-0 top-[calc(100%+8px)] bg-surface border border-border rounded-[10px] shadow-panel min-w-[190px] overflow-hidden z-[100]">
                <div className="px-3 py-2 text-[10px] font-semibold text-muted uppercase tracking-[0.06em] border-b border-border">
                  Ingelogd als
                </div>
                {employees.map(emp => (
                  <button
                    key={emp.id}
                    onClick={() => { setActiveEmployee(emp); setOpen(false) }}
                    className={cn(
                      'w-full flex items-center gap-2.5 px-3.5 py-2.5 border-none text-left text-[13px] text-primary cursor-pointer transition-colors',
                      activeEmployee?.id === emp.id ? 'bg-bg' : 'bg-transparent hover:bg-active',
                    )}
                  >
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 inline-block"
                      style={{ backgroundColor: emp.color ?? '#888' }} />
                    <span className="flex-1">{emp.naam}</span>
                    <span className="text-[10px] font-semibold px-1.5 py-px rounded-lg"
                      style={{ color: emp.color ?? 'var(--muted)', backgroundColor: `${emp.color ?? '#888'}18` }}>
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
