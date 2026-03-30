import type { Metadata, Viewport } from 'next'
import { Inter }            from 'next/font/google'
import NavBar               from '@/components/NavBar'
import PasswordGate         from '@/components/PasswordGate'
import { EmployeeProvider } from '@/lib/employee-context'
import './globals.css'

const inter = Inter({ subsets: ['latin'], display: 'swap' })

export const metadata: Metadata = {
  title: 'ROUX',
  description: 'Beurs formulier & SUUS AI',
}

export const viewport: Viewport = {
  width:        'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl" className={inter.className}>
      <head>
        {/* Preconnect to Google Maps so Places loads faster on first use */}
        <link rel="preconnect" href="https://maps.googleapis.com" />
        <link rel="preconnect" href="https://maps.gstatic.com" crossOrigin="" />
      </head>
      <body style={{ margin: 0, display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        <PasswordGate>
          <EmployeeProvider>
            <NavBar />
            <main style={{ flex: 1, minHeight: 0 }}>{children}</main>
          </EmployeeProvider>
        </PasswordGate>
      </body>
    </html>
  )
}
