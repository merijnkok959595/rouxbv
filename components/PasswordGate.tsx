'use client'

import { useState, useEffect } from 'react'
import type { Employee } from '@/lib/employee-context'

const PASSWORD    = process.env.NEXT_PUBLIC_APP_PASSWORD ?? 'ROUX2026'
const KEY_UNLOCK  = 'roux_unlocked'
const KEY_EMP     = 'roux_active_employee'

type Step = 'loading' | 'password' | 'employee' | 'done'

export default function PasswordGate({ children }: { children: React.ReactNode }) {
  const [step,      setStep]      = useState<Step>('loading')
  const [input,     setInput]     = useState('')
  const [error,     setError]     = useState(false)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [empError,  setEmpError]  = useState(false)

  useEffect(() => {
    const unlocked = localStorage.getItem(KEY_UNLOCK) === '1'
    const savedEmp = localStorage.getItem(KEY_EMP)

    if (unlocked && savedEmp) {
      setStep('done')
    } else if (unlocked) {
      loadEmployees('employee')
    } else {
      setStep('password')
    }
  }, [])

  async function loadEmployees(nextStep: Step) {
    try {
      const res  = await fetch('/api/settings/employees')
      const data = await res.json()
      // /api/settings/employees returns an array directly
      const list: Employee[] = Array.isArray(data) ? data : (data.members ?? [])
      setEmployees(list)
      setStep(nextStep)
    } catch {
      setEmpError(true)
      setStep(nextStep)
    }
  }

  function attemptPassword() {
    if (input === PASSWORD) {
      localStorage.setItem(KEY_UNLOCK, '1')
      setError(false)
      loadEmployees('employee')
    } else {
      setError(true)
      setInput('')
    }
  }

  function selectEmployee(emp: Employee) {
    localStorage.setItem(KEY_EMP, emp.id)
    setStep('done')
  }

  if (step === 'loading') return null
  if (step === 'done')    return <>{children}</>

  return (
    <div className="fixed inset-0 z-[9999] bg-[#0a0a0a] flex items-center justify-center px-6">

      {/* ── Step 1: Password ── */}
      {step === 'password' && (
        <div className="w-full max-w-[360px] flex flex-col items-center gap-6">
          <div className="text-center">
            <div className="text-[22px] font-extrabold tracking-[0.18em] text-white mb-1.5">ROUX</div>
            <div className="text-xs text-[#555] tracking-[0.06em]">Voer de toegangscode in</div>
          </div>
          <div className="w-full flex flex-col gap-2.5">
            <input
              type="password"
              value={input}
              autoFocus
              placeholder="Wachtwoord"
              onChange={e => { setInput(e.target.value); setError(false) }}
              onKeyDown={e => e.key === 'Enter' && attemptPassword()}
              className="w-full px-4 py-3 rounded-[10px] bg-white text-[#0a0a0a] text-[15px] outline-none tracking-[0.1em] transition-colors box-border placeholder:text-[#999]"
              style={{ border: `1px solid ${error ? '#ef4444' : '#ddd'}` }}
            />
            {error && (
              <p className="text-xs text-red-400 text-center">Onjuiste code. Probeer opnieuw.</p>
            )}
            <button
              onClick={attemptPassword}
              className="w-full py-3 rounded-[10px] border-none bg-white text-[#0a0a0a] text-sm font-bold cursor-pointer tracking-[0.04em] hover:opacity-90 transition-opacity"
            >
              Doorgaan
            </button>
          </div>
        </div>
      )}

      {/* ── Step 2: Employee selector ── */}
      {step === 'employee' && (
        <div className="w-full max-w-[420px] flex flex-col items-center gap-6">
          <div className="text-center">
            <div className="text-[22px] font-extrabold tracking-[0.18em] text-white mb-1.5">ROUX</div>
            <div className="text-xs text-[#555] tracking-[0.06em]">Wie ben jij?</div>
          </div>

          {empError ? (
            <p className="text-xs text-red-400 text-center">Kon medewerkers niet laden. Probeer opnieuw.</p>
          ) : employees.length === 0 ? (
            <p className="text-xs text-[#555] text-center">Laden…</p>
          ) : (
            <div className="w-full grid grid-cols-2 gap-2.5">
              {employees.map(emp => (
                <button
                  key={emp.id}
                  onClick={() => selectEmployee(emp)}
                  className="flex flex-col items-center gap-2.5 px-4 py-4 rounded-[12px] bg-[#111] border border-[#222] text-white cursor-pointer hover:border-[#444] hover:bg-[#161616] transition-all text-left"
                >
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-[15px] flex-shrink-0"
                    style={{ backgroundColor: emp.color || '#333' }}
                  >
                    {emp.naam.split(' ').map(w => w[0]).slice(0, 2).join('')}
                  </div>
                  <div className="text-center">
                    <div className="text-[14px] font-semibold leading-snug">
                      {emp.naam.split(' ')[0]}
                    </div>
                    {emp.functie && (
                      <div className="text-[11px] text-[#555] mt-0.5 leading-tight">{emp.functie}</div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
