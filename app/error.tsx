'use client'

import { useEffect } from 'react'

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error('[app/error]', error) }, [error])

  return (
    <div className="min-h-[calc(100vh-44px)] flex items-center justify-center px-6">
      <div className="text-center max-w-[360px]">
        <div className="text-[13px] font-bold text-muted uppercase tracking-[0.08em] mb-2">Fout</div>
        <p className="text-sm text-muted mb-5">
          Er is iets misgegaan. Probeer de pagina te vernieuwen.
        </p>
        <button
          onClick={reset}
          className="px-4 py-2 text-[13px] font-semibold rounded-lg border border-border bg-surface text-primary hover:bg-active transition-colors cursor-pointer"
        >
          Opnieuw proberen
        </button>
      </div>
    </div>
  )
}
