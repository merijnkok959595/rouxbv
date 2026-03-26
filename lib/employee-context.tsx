'use client'

import { createContext, useContext, useState, useEffect } from 'react'

export type Employee = {
  id:           string
  naam:         string
  functie:      string | null
  color:        string | null
  ghl_user_id:  string | null
  calendar_id:  string | null
  phone?:       string | null
  email?:       string | null
}

type EmployeeCtx = {
  employees:         Employee[]
  activeEmployee:    Employee | null
  setActiveEmployee: (e: Employee) => void
}

const Ctx = createContext<EmployeeCtx>({
  employees:         [],
  activeEmployee:    null,
  setActiveEmployee: () => {},
})

export function EmployeeProvider({ children }: { children: React.ReactNode }) {
  const [employees,      setEmployees]      = useState<Employee[]>([])
  const [activeEmployee, setActiveEmployee] = useState<Employee | null>(null)

  useEffect(() => {
    fetch('/api/settings/employees')
      .then(r => r.json())
      .then(d => {
        const list: Employee[] = Array.isArray(d) ? d : (d.members ?? [])
        setEmployees(list)

        // Restore last selection from localStorage
        const saved = typeof window !== 'undefined' ? localStorage.getItem('roux_active_employee') : null
        const match = saved ? list.find(e => e.id === saved) : null
        setActiveEmployee(match ?? list[0] ?? null)
      })
      .catch(() => {})
  }, [])

  function handleSet(e: Employee) {
    setActiveEmployee(e)
    if (typeof window !== 'undefined') localStorage.setItem('roux_active_employee', e.id)
  }

  return (
    <Ctx.Provider value={{ employees, activeEmployee, setActiveEmployee: handleSet }}>
      {children}
    </Ctx.Provider>
  )
}

export function useEmployee() {
  return useContext(Ctx)
}
