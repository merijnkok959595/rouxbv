import Link from 'next/link'

export default function Home() {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      backgroundColor: 'var(--bg)',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '32px' }}>
        <div style={{ textAlign: 'center' }}>
          <h1 style={{ fontSize: '28px', fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.03em', marginBottom: '8px' }}>
            ROUX
          </h1>
          <p style={{ fontSize: '14px', color: 'var(--muted)' }}>Kies een module</p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', width: '100%', maxWidth: '480px' }}>
          <Link href="/formulier" style={{ textDecoration: 'none' }}>
            <div style={{
              padding: '28px 24px', backgroundColor: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: '12px', cursor: 'pointer', transition: 'box-shadow 0.15s',
            }}>
              <div style={{ fontSize: '28px', marginBottom: '10px' }}>📋</div>
              <p style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)', marginBottom: '4px' }}>Beurs formulier</p>
              <p style={{ fontSize: '12px', color: 'var(--muted)', lineHeight: 1.5 }}>Intake nieuwe beurs leads met Google Places autocomplete</p>
            </div>
          </Link>

          <Link href="/suus" style={{ textDecoration: 'none' }}>
            <div style={{
              padding: '28px 24px', backgroundColor: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: '12px', cursor: 'pointer', transition: 'box-shadow 0.15s',
            }}>
              <div style={{ fontSize: '28px', marginBottom: '10px' }}>🤖</div>
              <p style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)', marginBottom: '4px' }}>SUUS</p>
              <p style={{ fontSize: '12px', color: 'var(--muted)', lineHeight: 1.5 }}>AI sales assistant — CRM via chat en spraak</p>
            </div>
          </Link>
        </div>
      </div>
    </div>
  )
}
