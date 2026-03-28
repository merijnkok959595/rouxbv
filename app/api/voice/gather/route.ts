/**
 * POST /api/voice/gather
 *
 * Called by Twilio after each speech turn (Deepgram STT result posted here).
 * Runs GPT-4.1 + tools and responds with OpenAI TTS audio via <Play>.
 *
 * Cost: ~$0.00015/turn (GPT-4.1) vs $0.37/min (old Realtime API)
 */

import { generateText, tool } from 'ai'
import { openai }              from '@ai-sdk/openai'
import { z }                   from 'zod'
import { suusTools }           from '@/lib/suus-tools'
import { getVoiceConv, clearVoiceConv } from '@/lib/voice-conversation'
import { gatherResponse, playAndHangup } from '@/lib/twilio-twiml'

export const runtime     = 'nodejs'
export const maxDuration = 45

const APP_URL = () => (process.env.NEXT_PUBLIC_APP_URL ?? 'https://rouxbv.vercel.app').replace(/\/$/, '')

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

export async function POST(req: Request) {
  const gatherUrl = `${APP_URL()}/api/voice/gather`

  let callSid = ''
  try {
    const form         = await req.formData()
    callSid            = form.get('CallSid')?.toString()      ?? ''
    const speechResult = form.get('SpeechResult')?.toString() ?? ''
    const confidence   = parseFloat(form.get('Confidence')?.toString() ?? '0')

    const conv = getVoiceConv(callSid)
    if (!conv) {
      return playAndHangup('Sorry, ik ben de sessie kwijt. Bel me opnieuw.')
    }

    // Handle silence / low-confidence speech
    const silent = !speechResult || confidence < 0.2
    if (silent) {
      conv.silenceCount++
      if (conv.silenceCount >= 3) {
        clearVoiceConv(callSid)
        return playAndHangup('Ik hoor niets. Tot de volgende keer!')
      }
      const nudge = conv.silenceCount === 1 ? 'Ik hoor je niet goed. Kun je iets zeggen?' : 'Ben je er nog?'
      return gatherResponse(nudge, gatherUrl)
    }

    conv.silenceCount = 0
    conv.messages.push({ role: 'user', content: speechResult })

    console.log(`[voice/gather] ${callSid} user: "${speechResult}" (conf ${confidence.toFixed(2)})`)

    const result = await generateText({
      model:    openai('gpt-4.1'),
      system:   conv.systemPrompt,
      messages: conv.messages,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools:    phoneTools as any,
      maxSteps: 6,
    })

    const responseText = result.text.trim() || 'Er is iets misgegaan. Probeer opnieuw.'

    const wantsHangup = result.steps.some(step =>
      step.toolResults?.some(
        (tr: { result: unknown }) => (tr.result as { action?: string })?.action === 'hang_up',
      ),
    )

    conv.messages.push({ role: 'assistant', content: responseText })

    console.log(`[voice/gather] ${callSid} suus: "${responseText.slice(0, 80)}${responseText.length > 80 ? '…' : ''}"${wantsHangup ? ' [hang_up]' : ''}`)

    if (wantsHangup) {
      clearVoiceConv(callSid)
      return playAndHangup(responseText)
    }

    return gatherResponse(responseText, gatherUrl)

  } catch (err) {
    console.error(`[voice/gather] ${callSid}`, err)
    return gatherResponse('Even een probleem. Wat wil je doen?', gatherUrl)
  }
}
