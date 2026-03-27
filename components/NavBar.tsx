'use client'

import Link            from 'next/link'
import { usePathname } from 'next/navigation'
import { useState }    from 'react'
import { Menu, X }     from 'lucide-react'
import { useEmployee } from '@/lib/employee-context'
import { cn }          from '@/lib/utils'

const NAV = [
  { href: '/formulier',    label: 'Formulier'    },
  { href: '/leads',        label: 'Leads'        },
  { href: '/awards',       label: 'Awards'       },
  { href: '/instellingen', label: 'Instellingen' },
  { href: '/admin',        label: 'Admin'        },
  { href: '/test',         label: 'Test'         },
]

export default function NavBar() {
  const pathname  = usePathname()
  const { employees, activeEmployee, setActiveEmployee } = useEmployee()
  const [empOpen,    setEmpOpen]    = useState(false)
  const [menuOpen,   setMenuOpen]   = useState(false)

  return (
    <>
      <nav className="roux-nav relative z-[200]">
        <Link href="/" className="roux-nav-logo">ROUX</Link>

        {/* Desktop nav items — hidden on mobile */}
        <div className="roux-nav-items max-sm:hidden">
          {NAV.map(({ href, label }) => {
            const active = pathname === href || pathname.startsWith(href + '/')
            return (
              <Link key={href} href={href} className={cn('roux-nav-item', active && 'active')}>
                {label}
              </Link>
            )
          })}
        </div>


        {/* Right side */}
        <div className="ml-auto flex items-center gap-2">
          {/* Employee switcher — desktop */}
          {employees.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setEmpOpen(o => !o)}
                className={cn(
                  'flex items-center gap-1.5 px-2.5 py-1 pl-[7px] rounded-full border border-border',
                  'text-xs text-primary whitespace-nowrap cursor-pointer bg-transparent transition-colors',
                  empOpen && 'bg-bg',
                )}
              >
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 inline-block"
                  style={{ backgroundColor: activeEmployee?.color ?? '#888' }} />
                <span className="font-medium max-sm:hidden">{activeEmployee?.naam ?? '—'}</span>
                <span className="text-muted text-[9px] ml-px max-sm:hidden">▾</span>
              </button>

              {empOpen && (
                <>
                  <div className="fixed inset-0 z-[99]" onClick={() => setEmpOpen(false)} />
                  <div className="absolute right-0 top-[calc(100%+8px)] bg-surface border border-border rounded-[10px] shadow-panel min-w-[190px] overflow-hidden z-[100]">
                    <div className="px-3 py-2 text-[10px] font-semibold text-muted uppercase tracking-[0.06em] border-b border-border">
                      Ingelogd als
                    </div>
                    {employees.map(emp => (
                      <button
                        key={emp.id}
                        onClick={() => { setActiveEmployee(emp); setEmpOpen(false) }}
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

          {/* Hamburger — mobile only */}
          <button
            onClick={() => setMenuOpen(o => !o)}
            className="sm:hidden w-9 h-9 flex items-center justify-center rounded-lg text-primary hover:bg-active transition-colors"
            aria-label="Menu"
          >
            {menuOpen ? <X size={20} strokeWidth={2} /> : <Menu size={20} strokeWidth={2} />}
          </button>
        </div>
      </nav>

      {/* Mobile full-screen drawer — always mounted, slides in/out via CSS */}
      <div className={cn(
        'sm:hidden fixed inset-0 z-[250] transition-all duration-[280ms]',
        menuOpen ? 'pointer-events-auto' : 'pointer-events-none',
      )}>
        {/* Backdrop */}
        <div
          className={cn(
            'absolute inset-0 bg-black/40 transition-opacity duration-[280ms]',
            menuOpen ? 'opacity-100' : 'opacity-0',
          )}
          onClick={() => setMenuOpen(false)}
        />

        {/* Drawer panel */}
        <div className={cn(
          'absolute top-0 right-0 h-full w-full bg-surface flex flex-col',
          'transition-transform duration-[280ms] ease-drawer',
          menuOpen ? 'translate-x-0' : 'translate-x-full',
        )}>

          {/* Drawer top bar */}
          <div className="flex items-center justify-between px-5 h-[56px] border-b border-border flex-shrink-0">
            <Link href="/suus" onClick={() => setMenuOpen(false)} className="text-[15px] font-black text-primary tracking-[-0.02em]">SUUS</Link>
            <button
              onClick={() => setMenuOpen(false)}
              className="w-9 h-9 flex items-center justify-center rounded-lg text-primary hover:bg-active transition-colors"
            >
              <X size={20} strokeWidth={2} />
            </button>
          </div>

          {/* Nav links */}
          <div className="flex-1 overflow-y-auto">
            {NAV.map(({ href, label }) => {
              const active = pathname === href || pathname.startsWith(href + '/')
              return (
                <Link
                  key={href} href={href}
                  onClick={() => setMenuOpen(false)}
                  className={cn(
                    'flex items-center justify-between px-6 py-4 text-[17px] border-b border-border transition-colors',
                    active
                      ? 'font-bold text-primary bg-bg'
                      : 'font-normal text-primary hover:bg-active',
                  )}
                >
                  <span>{label}</span>
                  {active && <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />}
                </Link>
              )
            })}
          </div>

          {/* Footer — accent brand block */}
          <div className="flex-shrink-0 bg-primary px-6 py-6 flex items-end justify-between">
            <div>
              <span className="block text-[28px] font-black text-white tracking-[-0.04em] leading-none">
                ROUX
              </span>
              <span className="block text-[11px] text-white/50 font-medium mt-1 uppercase tracking-[0.1em]">
                Sales Intelligence
              </span>
            </div>
            {/* Active employee in footer */}
            {activeEmployee && (
              <div className="flex items-center gap-2 bg-white/10 rounded-full px-3 py-1.5">
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: activeEmployee.color ?? '#fff' }}
                />
                <span className="text-white text-[12px] font-semibold">
                  {activeEmployee.naam?.split(' ')[0]}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
