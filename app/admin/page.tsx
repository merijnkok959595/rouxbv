'use client'

import { useState, useRef, useEffect } from 'react'
import { useEmployee }                 from '@/lib/employee-context'
import { cn }                          from '@/lib/utils'
import AdminGate                       from '@/components/AdminGate'

const MONO = "'SF Mono', 'Fira Code', monospace"

interface TestResult {
  intent: string; example: string; category: string; passed: boolean
  toolsCalled: string[]; ghlSuccess: boolean; errorDetail?: string
  responseText: string; steps: number; durationMs: number
}
interface SseEvent {
  type: string; message?: string; twilioCount?: number; retellCount?: number
  total?: number; intents?: { intent: string; example: string; category: string }[]
  index?: number; intent?: string; example?: string; result?: TestResult
  passed?: number; failed?: number; passRate?: number; avgDurationMs?: number
  results?: TestResult[]; error?: string
}

export default function EvalPage() {
  const [running,  setRunning]  = useState(false)
  const [log,      setLog]      = useState<string[]>([])
  const [results,  setResults]  = useState<TestResult[]>([])
  const [summary,  setSummary]  = useState<SseEvent | null>(null)
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [mode,     setMode]     = useState<'intents' | 'raw'>('intents')
  const [since,    setSince]    = useState<string>(() => {
    const d = new Date(); d.setDate(d.getDate() - 14); return d.toISOString().slice(0, 10)
  })
  const abortRef = useRef<AbortController | null>(null)
  const { activeEmployee } = useEmployee()

  function addLog(msg: string) { setLog(p => [...p.slice(-200), msg]) }

  async function runStream(res: Response) {
    if (!res.body) throw new Error('No stream')
    const reader = res.body.getReader(); const decoder = new TextDecoder(); let buf = ''
    while (true) {
      const { done, value } = await reader.read(); if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n\n'); buf = lines.pop() ?? ''
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
              const idx = p.findIndex(r => r.intent === evt.result!.intent && r.example === evt.result!.example)
              if (idx >= 0) { const n = [...p]; n[idx] = evt.result!; return n }
              return [...p, evt.result!]
            })
            const r = evt.result
            addLog(`${r.passed ? '✅' : '❌'} ${r.intent} — ${r.toolsCalled.join(' → ') || 'geen tools'} (${r.durationMs}ms)${r.errorDetail ? ` | ${r.errorDetail.slice(0, 80)}` : ''}`)
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
    setRunning(true); setLog([]); setResults([]); setSummary(null); setProgress({ current: 0, total: 0 })
    abortRef.current = new AbortController()
    try {
      const params = new URLSearchParams({ mode })
      if (activeEmployee) params.set('employee_id', activeEmployee.id)
      if (since) params.set('since', since)
      await runStream(await fetch(`/api/admin/eval?${params}`, { signal: abortRef.current.signal }))
    } catch (err: unknown) {
      if ((err as Error)?.name !== 'AbortError') addLog(`❌ ${String(err)}`)
    } finally { setRunning(false) }
  }

  async function retryFailed() {
    const failed = results.filter(r => !r.passed); if (!failed.length) return
    setRunning(true); setLog([`🔁 Hertesten: ${failed.length} gefaalde tests…`]); setResults([]); setSummary(null)
    setProgress({ current: 0, total: failed.length })
    abortRef.current = new AbortController()
    try {
      await runStream(await fetch('/api/admin/eval', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intents: failed.map(r => ({ intent: r.intent, example: r.example, category: r.category })), employee_id: activeEmployee?.id }),
        signal: abortRef.current.signal,
      }))
    } catch (err: unknown) {
      if ((err as Error)?.name !== 'AbortError') addLog(`❌ ${String(err)}`)
    } finally { setRunning(false) }
  }

  const passed = results.filter(r => r.passed).length
  const failed = results.filter(r => !r.passed).length

  return (
    <AdminGate>
      <div className="px-4 sm:px-6 py-4 sm:py-6 max-w-[1100px] mx-auto">
        <h1 className="text-[18px] font-bold text-primary mb-1">Admin</h1>
        <p className="text-[13px] text-muted mb-6">
          SUUS Eval — haalt logs op van Twilio &amp; Retell → test door SUUS + GHL (dry-run, schrijft niets naar GHL)
        </p>

        {activeEmployee && (
          <div className="flex items-center gap-1.5 mb-4 text-xs text-muted">
            Chat als:
            <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: activeEmployee.color ?? '#888' }} />
            <span className="text-primary font-medium">{activeEmployee.naam}</span>
            <span>— wissel bovenin de header</span>
          </div>
        )}

        {/* Controls */}
        <div className="flex gap-2.5 mb-6 items-center flex-wrap">
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <span>Vanaf</span>
            <input type="date" value={since} onChange={e => setSince(e.target.value)} disabled={running}
              className="px-2 py-1 rounded-lg border border-border bg-surface text-primary text-xs outline-none disabled:cursor-default" />
          </div>

          <div className="flex rounded-lg border border-border overflow-hidden text-xs">
            {(['intents', 'raw'] as const).map(m => (
              <button key={m} onClick={() => !running && setMode(m)}
                className={cn('px-3.5 py-1.5 border-none cursor-pointer transition-colors',
                  mode === m ? 'bg-[#111] text-white font-semibold' : 'bg-transparent text-muted font-normal hover:bg-active')}>
                {m === 'intents' ? '🧠 Intents' : '📨 Echte berichten'}
              </button>
            ))}
          </div>

          <button onClick={startEval} disabled={running}
            className="px-5 py-2 rounded-lg border-none font-semibold text-[13px] cursor-pointer transition-colors disabled:cursor-default"
            style={{ backgroundColor: running ? 'var(--border)' : '#111', color: running ? 'var(--muted)' : '#fff' }}>
            {running ? 'Bezig…' : '▶ Start eval'}
          </button>

          {!running && results.some(r => !r.passed) && (
            <button onClick={retryFailed}
              className="px-4 py-2 rounded-lg border border-red-600 bg-transparent text-red-600 cursor-pointer font-semibold text-[13px] hover:bg-red-50 transition-colors">
              🔁 Hertesten ({results.filter(r => !r.passed).length} gefaald)
            </button>
          )}
          {running && (
            <button onClick={() => { abortRef.current?.abort(); setRunning(false) }}
              className="px-4 py-2 rounded-lg border border-border bg-bg text-red-600 cursor-pointer text-[13px] hover:bg-active transition-colors">
              Stop
            </button>
          )}
          {progress.total > 0 && (
            <span className="text-xs text-muted" style={{ fontFamily: MONO }}>
              {progress.current}/{progress.total}{' — '}
              <span className="text-green-600">{passed} ✅</span>{' '}
              <span className="text-red-500">{failed} ❌</span>
            </span>
          )}
        </div>

        {/* Summary tiles */}
        {summary && (
          <div className="grid grid-cols-4 gap-3 mb-6">
            {[
              { label: 'Geslaagd',  value: `${summary.passed}/${summary.total}`, color: '#16a34a' },
              { label: 'Gefaald',   value: String(summary.failed),               color: '#dc2626' },
              { label: 'Pass rate', value: `${summary.passRate}%`,               color: summary.passRate! >= 80 ? '#16a34a' : summary.passRate! >= 60 ? '#d97706' : '#dc2626' },
              { label: 'Gem. tijd', value: `${summary.avgDurationMs}ms`,         color: 'var(--text)' },
            ].map(tile => (
              <div key={tile.label} className="px-4 py-3.5 rounded-[10px] border border-border bg-surface">
                <div className="text-xl font-bold" style={{ color: tile.color, fontFamily: MONO }}>{tile.value}</div>
                <div className="text-xs text-muted mt-0.5">{tile.label}</div>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          {/* Log */}
          <div>
            <p className="text-xs font-semibold text-muted mb-2 uppercase tracking-[0.05em]">Log</p>
            <div className="bg-[#0a0a0a] rounded-[10px] px-3.5 py-3.5 h-[480px] overflow-y-auto text-[#ccc] text-[11px] leading-[1.7]"
              style={{ fontFamily: MONO }}>
              {log.map((l, i) => (
                <div key={i} style={{ color: l.startsWith('✅') ? '#4ade80' : l.startsWith('❌') ? '#f87171' : l.startsWith('▶') ? '#93c5fd' : '#ccc' }}>{l}</div>
              ))}
              {running && <div className="text-[#555] animate-pulse">▌</div>}
            </div>
          </div>

          {/* Results table */}
          <div>
            <p className="text-xs font-semibold text-muted mb-2 uppercase tracking-[0.05em]">Resultaten</p>
            <div className="border border-border rounded-[10px] overflow-hidden max-h-[480px] overflow-y-auto">
              {results.length === 0 ? (
                <div className="px-6 py-6 text-center text-muted text-[13px]">Nog geen resultaten</div>
              ) : (
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="bg-surface">
                      {['', 'Intent', 'Tools', 'ms'].map(h => (
                        <th key={h} className="px-2.5 py-2 text-left text-muted font-semibold border-b border-border whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((r, i) => (
                      <tr key={i} className={cn('border-b border-border', i % 2 === 0 ? 'bg-bg' : 'bg-surface')}>
                        <td className="px-2.5 py-1.5 text-sm">{r.passed ? '✅' : '❌'}</td>
                        <td className="px-2.5 py-1.5 text-primary max-w-[180px]">
                          <div className="font-medium overflow-hidden text-ellipsis whitespace-nowrap">{r.intent}</div>
                          {r.errorDetail && <div className="text-red-400 text-[10px] mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap">{r.errorDetail.slice(0, 60)}</div>}
                          {r.responseText && !r.errorDetail && <div className="text-muted text-[10px] mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap">{r.responseText}</div>}
                        </td>
                        <td className="px-2.5 py-1.5 text-muted text-[10px] whitespace-nowrap" style={{ fontFamily: MONO }}>
                          {r.toolsCalled.join(' → ') || '—'}
                        </td>
                        <td className="px-2.5 py-1.5 text-muted text-right whitespace-nowrap" style={{ fontFamily: MONO }}>{r.durationMs}</td>
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
          <div className="mt-6">
            <p className="text-xs font-semibold text-red-600 mb-3 uppercase tracking-[0.05em]">❌ Gefaalde tests — detail</p>
            <div className="flex flex-col gap-2">
              {results.filter(r => !r.passed).map((r, i) => (
                <div key={i} className="px-3.5 py-3 rounded-lg border border-red-200 bg-red-50">
                  <div className="font-semibold text-[13px] text-red-600 mb-1">{r.intent}</div>
                  <div className="text-xs text-[#555] mb-1">Input: <em>&quot;{r.example}&quot;</em></div>
                  <div className="text-[11px] text-[#666]" style={{ fontFamily: MONO }}>
                    Tools: {r.toolsCalled.join(' → ') || 'geen'} | Steps: {r.steps} | {r.durationMs}ms
                  </div>
                  {r.errorDetail && <div className="text-[11px] text-red-600 mt-1" style={{ fontFamily: MONO }}>{r.errorDetail.slice(0, 200)}</div>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </AdminGate>
  )
}
