import { NextRequest, NextResponse } from 'next/server'
import { adminSupabase } from '@/lib/supabase'

export const runtime = 'nodejs'

const ORG_ID = () => process.env.ORGANIZATION_ID?.trim() ?? ''

export async function POST(req: NextRequest) {
  try {
    const { session_id, role, content } = await req.json() as {
      session_id: string
      role: 'user' | 'assistant'
      content: string
    }
    if (!session_id || !role || !content) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    }
    await adminSupabase().from('chat_messages').insert({
      session_id,
      organization_id: ORG_ID(),
      surface: 'web',
      role,
      content,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[save-message]', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
