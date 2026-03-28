import Retell from 'retell-sdk'

export const runtime     = 'nodejs'
export const maxDuration = 10

const retell = new Retell({ apiKey: process.env.RETELL_API_KEY! })

export async function POST(req: Request) {
  try {
    const { employee_id, employee_naam, ghl_user_id, calendar_id } = await req.json() as {
      employee_id?:  string
      employee_naam?: string
      ghl_user_id?:  string
      calendar_id?:  string
    }

    const webCall = await retell.call.createWebCall({
      agent_id: process.env.RETELL_AGENT_ID!.trim(),
      metadata: {
        source:        'browser',
        employee_id:   employee_id   ?? '',
        employee_naam: employee_naam ?? '',
        ghl_user_id:   ghl_user_id   ?? '',
        calendar_id:   calendar_id   ?? '',
      },
      // Dynamic variables injected into the Conversation Flow nodes
      retell_llm_dynamic_variables: {
        caller_name:  employee_naam ?? '',
        firstname:    (employee_naam ?? '').split(' ')[0],
        ghl_user_id:  ghl_user_id   ?? '',
        calendar_id:  calendar_id   ?? '',
      },
    })

    return Response.json({
      access_token: webCall.access_token,
      call_id:      webCall.call_id,
    })
  } catch (err) {
    console.error('[retell/create-call]', err)
    return Response.json({ error: 'Failed to create call' }, { status: 500 })
  }
}
