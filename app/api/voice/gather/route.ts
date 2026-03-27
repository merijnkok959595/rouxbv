/**
 * POST /api/voice/gather
 *
 * Handles each speech turn in the Twilio phone conversation.
 * Twilio posts SpeechResult here after STT → we run GPT-4o-mini + tools
 * and respond with TwiML <Say voice="Polly.Lotte-Neural">.
 *
 * Cost: ~$0.00015/turn (GPT-4o-mini text + tools) vs $0.37/min (Realtime)
 */

import { generateText, tool } from 'ai'
import { openai }              from '@ai-sdk/openai'
import { z }                   from 'zod'
import { suusTools }           from '@/lib/suus-tools'
import { getVoiceConv, clearVoiceConv } from '@/lib/voice-conversation'
import { twiml, escapeXml, gatherResponse } from '@/lib/twilio-twiml'

export const runtime     = 'nodejs'
export const maxDuration = 45   // tool chains can take up to ~10s

const APP_URL = () => (process.env.NEXT_PUBLIC_APP_URL ?? 'https://rouxbv.vercel.app').replace(/\/$/, '')

// Tools available on phone: exclude UI-only tools, add hang_up
const BLOCKED = new Set(['render_form', 'render_edit_form'])

const phoneTools = {
  ...Object.fromEntries(
    Object.entries(suusTools).filter(([k]) => !BLOCKED.has(k)),
  ),
  hang_up: tool({
    description: 'Verbreek het gesprek nadat je afscheid hebt genomen.',
    parameters: z.object({}),
    execute: async () => ({ action: 'hang_up' }),
  }),
}

// ── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const gatherUrl = `${APP_URL()}/api/voice/gather`

  // Fallback TwiML when AI fails
  function retryGather(msg = 'Even een probleem. Wat wil je doen?') {
    return gatherResponse(msg, gatherUrl)
  }

  let callSid = ''
  try {
    const form         = await req.formData()
    callSid            = form.get('CallSid')?.toString()      ?? ''
    const speechResult = form.get('SpeechResult')?.toString() ?? ''
    const confidence   = parseFloat(form.get('Confidence')?.toString() ?? '0')

    const conv = getVoiceConv(callSid)
    if (!conv) {
      // Session lost (e.g. server restart) — apologise and hang up
      return twiml(
        '<Say voice="Polly.Lotte-Neural" language="nl-NL">' +
        'Sorry, ik ben de sessie kwijt. Bel me opnieuw.' +
        '</Say><Hangup/>',
      )
    }

    // Handle silence / low-confidence speech
    const silent = !speechResult || confidence < 0.2
    if (silent) {
      conv.silenceCount++
      if (conv.silenceCount >= 3) {
        clearVoiceConv(callSid)
        return twiml(
          '<Say voice="Polly.Lotte-Neural" language="nl-NL">' +
          'Ik hoor niets. Tot de volgende keer!' +
          '</Say><Hangup/>',
        )
      }
      const nudge = conv.silenceCount === 1
        ? 'Ik hoor je niet goed. Kun je iets zeggen?'
        : 'Ben je er nog?'
      return gatherResponse(nudge, gatherUrl)
    }

    // Reset silence counter on valid speech
    conv.silenceCount = 0
    conv.messages.push({ role: 'user', content: speechResult })

    console.log(`[voice/gather] ${callSid} user: "${speechResult}" (conf ${confidence.toFixed(2)})`)

    // Run AI — maxSteps handles multi-tool chains automatically
    const result = await generateText({
      model:    openai('gpt-4o-mini'),
      system:   conv.systemPrompt,
      messages: conv.messages,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools:    phoneTools as any,
      maxSteps: 6,
    })

    const responseText = result.text.trim() || 'Er is iets misgegaan. Probeer opnieuw.'

    // Check if hang_up was called in any step
    const wantsHangup = result.steps.some(step =>
      step.toolResults?.some(
        (tr: { result: unknown }) =>
          (tr.result as { action?: string })?.action === 'hang_up',
      ),
    )

    // Persist assistant turn
    conv.messages.push({ role: 'assistant', content: responseText })

    console.log(`[voice/gather] ${callSid} suus: "${responseText.slice(0, 80)}${responseText.length > 80 ? '…' : ''}"${wantsHangup ? ' [hang_up]' : ''}`)

    if (wantsHangup) {
      clearVoiceConv(callSid)
      return twiml(
        `<Say voice="Polly.Lotte-Neural" language="nl-NL">${escapeXml(responseText)}</Say>` +
        `<Hangup/>`,
      )
    }

    return gatherResponse(responseText, gatherUrl)

  } catch (err) {
    console.error(`[voice/gather] ${callSid}`, err)
    return retryGather()
  }
}
