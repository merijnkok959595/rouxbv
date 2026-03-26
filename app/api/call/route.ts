import { NextResponse } from 'next/server'
import Retell           from 'retell-sdk'

const retell = new Retell({ apiKey: process.env.RETELL_API_KEY ?? '' })

export async function POST(req: Request) {
  try {
    const { session_id } = await req.json()

    const agentId = process.env.RETELL_AGENT_ID
    if (!agentId) {
      return NextResponse.json({ error: 'RETELL_AGENT_ID not configured' }, { status: 500 })
    }
    if (!process.env.RETELL_API_KEY) {
      return NextResponse.json({ error: 'RETELL_API_KEY not configured' }, { status: 500 })
    }

    const webCall = await retell.call.createWebCall({
      agent_id: agentId,
      metadata: { session_id, org_id: process.env.ORGANIZATION_ID },
    })

    return NextResponse.json({
      call_id:      webCall.call_id,
      access_token: webCall.access_token,
    })
  } catch (err) {
    console.error('[call/create]', err)
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
