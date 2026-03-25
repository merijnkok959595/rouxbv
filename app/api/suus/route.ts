import { NextResponse } from 'next/server'

/**
 * Proxy to the Supabase Edge Function `suus`.
 * Forwards the request and streams the response back to the client.
 */
export async function POST(req: Request) {
  const edgeFnUrl = process.env.SUPABASE_SUUS_EDGE_URL
  if (!edgeFnUrl) {
    return NextResponse.json({ error: 'SUPABASE_SUUS_EDGE_URL not configured' }, { status: 500 })
  }

  const body = await req.text()

  const upstream = await fetch(edgeFnUrl, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
    },
    body,
  })

  // Stream the response through
  return new Response(upstream.body, {
    status:  upstream.status,
    headers: {
      'Content-Type':  upstream.headers.get('Content-Type') ?? 'text/plain',
      'Cache-Control': 'no-cache',
    },
  })
}
