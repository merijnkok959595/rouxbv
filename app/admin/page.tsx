'use client'

import { useState, useRef, useEffect } from 'react'
import { useEmployee }                 from '@/lib/employee-context'

const ADMIN_PW  = 'SUPERADMIN'
const ADMIN_KEY = 'roux_admin_unlocked'

function AdminGate({ children }: { children: React.ReactNode }) {
  const [unlocked, setUnlocked] = useState(false)
  const [input,    setInput]    = useState('')
  const [error,    setError]    = useState(false)
  const [ready,    setReady]    = useState(false)

  useEffect(() => {
    if (process.env.NODE_ENV === 'development') { setUnlocked(true); setReady(true); return }
    if (sessionStorage.getItem(ADMIN_KEY) === '1') setUnlocked(true)
    setReady(true)
  }, [])

  if (!ready) return null
  if (unlocked) return <>{children}</>

  function attempt() {
    if (input === ADMIN_PW) {
      sessionStorage.setItem(ADMIN_KEY, '1')
      setUnlocked(true)
    } else {
      setError(true)
      setInput('')
      setTimeout(() => setError(false), 1200)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
      <div style={{ backgroundColor: '#111', border: '1px solid #222', borderRadius: '12px', padding: '32px 28px', width: '280px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ fontSize: '13px', fontWeight: 700, color: '#fff', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Admin toegang</div>
        <input
          type="password"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && attempt()}
          placeholder="Wachtwoord"
          autoFocus
          style={{ padding: '9px 12px', borderRadius: '7px', border: `1px solid ${error ? '#dc2626' : '#333'}`, backgroundColor: '#1a1a1a', color: '#fff', fontSize: '14px', outline: 'none', transition: 'border-color 0.2s' }}
        />
        {error && <div style={{ fontSize: '12px', color: '#dc2626', marginTop: '-6px' }}>Ongeldig wachtwoord</div>}
        <button
          onClick={attempt}
          style={{ padding: '9px', borderRadius: '7px', border: 'none', backgroundColor: '#fff', color: '#000', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}
        >
          Toegang
        </button>
      </div>
    </div>
  )
}

interface TestResult {
  intent:       string
  example:      string
  category:     string
  passed:       boolean
  toolsCalled:  string[]
  ghlSuccess:   boolean
  errorDetail?: string
  responseText: string
  steps:        number
  durationMs:   number
}

interface SseEvent {
  type:          string
  message?:      string
  twilioCount?:  number
  retellCount?:  number
  total?:        number
  intents?:      { intent: string; example: string; category: string }[]
  index?:        number
  intent?:       string
  example?:      string
  result?:       TestResult
  passed?:       number
  failed?:       number
  passRate?:     number
  avgDurationMs?: number
  results?:      TestResult[]
  error?:        string
}

const MONO = "'SF Mono', 'Fira Code', monospace"

export default function EvalPage() {
  const [running,  setRunning]  = useState(false)
  const [log,      setLog]      = useState<string[]>([])
  const [results,  setResults]  = useState<TestResult[]>([])
  const [summary,  setSummary]  = useState<SseEvent | null>(null)
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [mode,     setMode]     = useState<'intents' | 'raw'>('intents')
  // Default: 2 weeks ago
  const [since,    setSince]    = useState<string>(() => {
    const d = new Date(); d.setDate(d.getDate() - 14)
    return d.toISOString().slice(0, 10)
  })
  const abortRef = useRef<AbortController | null>(null)

  const { activeEmployee } = useEmployee()

  function addLog(msg: string) {
    setLog(p => [...p.slice(-200), msg])
  }

  async function runStream(res: Response) {
    if (!res.body) throw new Error('No stream')
    const reader  = res.body.getReader()
    const decoder = new TextDecoder()
    let   buf     = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n\n')
      buf = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        try {
          const evt: SseEvent = JSON.parse(line.slice(6))
          if (evt.type === 'status')  addLog(evt.message ?? '')
          if (evt.type === 'logs')    addLog(`📊 ${evt.twilioCount} Twilio + ${evt.retellCount} Retell = ${evt.total} berichten`)
          if (evt.type === 'intents') addLog(`🎯 ${evt.intents?.length} ${mode === 'raw' ? 'echte berichten' : 'intents'} worden getest`)
          if (evt.type === 'running') {
            setProgress({ current: (evt.index ?? 0) + 1, total: evt.total ?? 0 })
            addLog(`▶ [${(evt.index ?? 0) + 1}/${evt.total}] ${evt.intent}${evt.example ? ` · "${evt.example}"` : ''}`)
          }
          if (evt.type === 'result' && evt.result) {
            setResults(p => {
              // Replace existing result for same intent (during retry), or append
              const idx = p.findIndex(r => r.intent === evt.result!.intent && r.example === evt.result!.example)
              if (idx >= 0) { const n = [...p]; n[idx] = evt.result!; return n }
              return [...p, evt.result!]
            })
            const r = evt.result
            const toolStr = r.toolsCalled.join(' → ') || 'geen tools'
            const errStr  = r.errorDetail ? ` | ${r.errorDetail.slice(0, 80)}` : ''
            addLog(`${r.passed ? '✅' : '❌'} ${r.intent} — ${toolStr} (${r.durationMs}ms)${errStr}`)
          }
          if (evt.type === 'summary') {
            setSummary(evt)
            addLog(`\n🏁 Klaar: ${evt.passed}/${evt.total} geslaagd (${evt.passRate}%) — gem ${evt.avgDurationMs}ms`)
          }
          if (evt.type === 'error') addLog(`❌ Error: ${evt.message}`)
        } catch { /**/ }
      }
    }
  }

  async function startEval() {
    setRunning(true)
    setLog([])
    setResults([])
    setSummary(null)
    setProgress({ current: 0, total: 0 })

    abortRef.current = new AbortController()

    try {
      const params = new URLSearchParams({ mode })
      if (activeEmployee) params.set('employee_id', activeEmployee.id)
      if (since) params.set('since', since)
      const res = await fetch(`/api/admin/eval?${params}`, { signal: abortRef.current.signal })
      await runStream(res)
    } catch (err: unknown) {
      if ((err as Error)?.name !== 'AbortError') addLog(`❌ ${String(err)}`)
    } finally {
      setRunning(false)
    }
  }

  async function retryFailed() {
    const failed = results.filter(r => !r.passed)
    if (!failed.length) return

    setRunning(true)
    setLog([`🔁 Hertesten: ${failed.length} gefaalde tests…`])
    setResults([])
    setSummary(null)
    setProgress({ current: 0, total: failed.length })
    abortRef.current = new AbortController()

    try {
      const res = await fetch('/api/admin/eval', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          intents:     failed.map(r => ({ intent: r.intent, example: r.example, category: r.category })),
          employee_id: activeEmployee?.id,
        }),
        signal: abortRef.current.signal,
      })
      await runStream(res)
    } catch (err: unknown) {
      if ((err as Error)?.name !== 'AbortError') addLog(`❌ ${String(err)}`)
    } finally {
      setRunning(false)
    }
  }

  function stopEval() {
    abortRef.current?.abort()
    setRunning(false)
  }

  const passed = results.filter(r => r.passed).length
  const failed = results.filter(r => !r.passed).length

  return (
    <AdminGate>
    <div style={{ padding: '24px', maxWidth: '1100px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '4px', color: 'var(--text)' }}>Admin</h1>
      <p style={{ fontSize: '13px', color: 'var(--muted)', marginBottom: '24px' }}>
        SUUS Eval — haalt logs op van Twilio &amp; Retell → test door SUUS + GHL (dry-run, schrijft niets naar GHL)
      </p>

      {/* Active employee indicator */}
      {activeEmployee && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '16px', fontSize: '12px', color: 'var(--muted)' }}>
          Chat als:
          <span style={{ width: '9px', height: '9px', borderRadius: '50%', backgroundColor: activeEmployee.color ?? '#888', display: 'inline-block' }} />
          <span style={{ color: 'var(--text)', fontWeight: 500 }}>{activeEmployee.naam}</span>
          <span style={{ color: 'var(--muted)' }}>— wissel bovenin de header</span>
        </div>
      )}

      {/* Controls */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '24px', alignItems: 'center', flexWrap: 'wrap' }}>
        {/* Date filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--muted)' }}>
          <span>Vanaf</span>
          <input
            type="date"
            value={since}
            onChange={e => setSince(e.target.value)}
            disabled={running}
            style={{ padding: '5px 8px', borderRadius: '7px', border: '1px solid var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text)', fontSize: '12px', cursor: running ? 'default' : 'pointer' }}
          />
        </div>

        {/* Mode toggle */}
        <div style={{ display: 'flex', borderRadius: '8px', border: '1px solid var(--border)', overflow: 'hidden', fontSize: '12px' }}>
          {(['intents', 'raw'] as const).map(m => (
            <button
              key={m}
              onClick={() => !running && setMode(m)}
              style={{
                padding: '6px 14px', border: 'none', cursor: running ? 'default' : 'pointer',
                backgroundColor: mode === m ? '#111' : 'transparent',
                color: mode === m ? '#fff' : 'var(--muted)',
                fontWeight: mode === m ? 600 : 400,
              }}
            >
              {m === 'intents' ? '🧠 Intents' : '📨 Echte berichten'}
            </button>
          ))}
        </div>

        <button
          onClick={startEval}
          disabled={running}
          style={{ padding: '8px 20px', borderRadius: '8px', border: 'none', backgroundColor: running ? 'var(--border)' : '#111', color: running ? 'var(--muted)' : '#fff', cursor: running ? 'default' : 'pointer', fontWeight: 600, fontSize: '13px' }}
        >
          {running ? 'Bezig…' : '▶ Start eval'}
        </button>

        {/* Retry failed button — only shown when there are failed results */}
        {!running && results.some(r => !r.passed) && (
          <button
            onClick={retryFailed}
            style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid #dc2626', backgroundColor: 'transparent', color: '#dc2626', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}
          >
            🔁 Hertesten ({results.filter(r => !r.passed).length} gefaald)
          </button>
        )}
        {running && (
          <button
            onClick={stopEval}
            style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid var(--border)', backgroundColor: 'var(--bg)', color: '#dc2626', cursor: 'pointer', fontSize: '13px' }}
          >
            Stop
          </button>
        )}
        {progress.total > 0 && (
          <span style={{ fontSize: '12px', color: 'var(--muted)', fontFamily: MONO }}>
            {progress.current}/{progress.total}
            {' — '}
            <span style={{ color: '#16a34a' }}>{passed} ✅</span>
            {' '}
            <span style={{ color: '#dc2626' }}>{failed} ❌</span>
          </span>
        )}
      </div>

      {/* Summary bar */}
      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '24px' }}>
          {[
            { label: 'Geslaagd',   value: `${summary.passed}/${summary.total}`, color: '#16a34a' },
            { label: 'Gefaald',    value: String(summary.failed),               color: '#dc2626' },
            { label: 'Pass rate',  value: `${summary.passRate}%`,               color: summary.passRate! >= 80 ? '#16a34a' : summary.passRate! >= 60 ? '#d97706' : '#dc2626' },
            { label: 'Gem. tijd',  value: `${summary.avgDurationMs}ms`,         color: 'var(--text)' },
          ].map(tile => (
            <div key={tile.label} style={{ padding: '14px 16px', borderRadius: '10px', border: '1px solid var(--border)', backgroundColor: 'var(--surface)' }}>
              <div style={{ fontSize: '20px', fontWeight: 700, color: tile.color, fontFamily: MONO }}>{tile.value}</div>
              <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '2px' }}>{tile.label}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        {/* Log */}
        <div>
          <p style={{ fontSize: '12px', fontWeight: 600, color: 'var(--muted)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Log</p>
          <div style={{ backgroundColor: '#0a0a0a', borderRadius: '10px', padding: '14px', height: '480px', overflowY: 'auto', fontFamily: MONO, fontSize: '11px', lineHeight: 1.7, color: '#ccc' }}>
            {log.map((l, i) => (
              <div key={i} style={{ color: l.startsWith('✅') ? '#4ade80' : l.startsWith('❌') ? '#f87171' : l.startsWith('▶') ? '#93c5fd' : '#ccc' }}>{l}</div>
            ))}
            {running && <div style={{ color: '#555', animation: 'pulse 1s infinite' }}>▌</div>}
          </div>
        </div>

        {/* Results table */}
        <div>
          <p style={{ fontSize: '12px', fontWeight: 600, color: 'var(--muted)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Resultaten</p>
          <div style={{ border: '1px solid var(--border)', borderRadius: '10px', overflow: 'hidden', maxHeight: '480px', overflowY: 'auto' }}>
            {results.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--muted)', fontSize: '13px' }}>Nog geen resultaten</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr style={{ backgroundColor: 'var(--surface)' }}>
                    {['', 'Intent', 'Tools', 'ms'].map(h => (
                      <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: 'var(--muted)', fontWeight: 600, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {results.map((r, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border)', backgroundColor: i % 2 === 0 ? 'var(--bg)' : 'var(--surface)' }}>
                      <td style={{ padding: '6px 10px', fontSize: '14px' }}>{r.passed ? '✅' : '❌'}</td>
                      <td style={{ padding: '6px 10px', color: 'var(--text)', maxWidth: '180px' }}>
                        <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.intent}</div>
                        {r.errorDetail && <div style={{ color: '#f87171', fontSize: '10px', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.errorDetail.slice(0, 60)}</div>}
                        {r.responseText && !r.errorDetail && <div style={{ color: 'var(--muted)', fontSize: '10px', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.responseText}</div>}
                      </td>
                      <td style={{ padding: '6px 10px', fontFamily: MONO, color: 'var(--muted)', fontSize: '10px', whiteSpace: 'nowrap' }}>
                        {r.toolsCalled.join(' → ') || '—'}
                      </td>
                      <td style={{ padding: '6px 10px', fontFamily: MONO, color: 'var(--muted)', textAlign: 'right', whiteSpace: 'nowrap' }}>{r.durationMs}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Failed details */}
      {results.filter(r => !r.passed).length > 0 && (
        <div style={{ marginTop: '24px' }}>
          <p style={{ fontSize: '12px', fontWeight: 600, color: '#dc2626', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>❌ Gefaalde tests — detail</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {results.filter(r => !r.passed).map((r, i) => (
              <div key={i} style={{ padding: '12px 14px', borderRadius: '8px', border: '1px solid #fecaca', backgroundColor: '#fef2f2' }}>
                <div style={{ fontWeight: 600, fontSize: '13px', color: '#dc2626', marginBottom: '4px' }}>{r.intent}</div>
                <div style={{ fontSize: '12px', color: '#555', marginBottom: '4px' }}>Input: <em>"{r.example}"</em></div>
                <div style={{ fontSize: '11px', fontFamily: MONO, color: '#666' }}>
                  Tools: {r.toolsCalled.join(' → ') || 'geen'} | Steps: {r.steps} | {r.durationMs}ms
                </div>
                {r.errorDetail && <div style={{ fontSize: '11px', color: '#dc2626', marginTop: '4px', fontFamily: MONO }}>{r.errorDetail.slice(0, 200)}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
    </AdminGate>
  )
}
