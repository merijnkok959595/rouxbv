/**
 * SUUS Intent Router
 *
 * Step 1 (gpt-4o-mini, ~100ms, ~$0.0001):
 *   - Classify intent category
 *   - Normalize the raw message to clear Dutch
 *   - Determine complexity + confidence
 *
 * Step 2 (main agent):
 *   - Simple + high confidence → gpt-4o-mini + small toolset
 *   - Complex or low confidence → gpt-4.1 + full toolset
 */

import { generateObject } from 'ai'
import { openai }         from '@ai-sdk/openai'
import { z }              from 'zod'
import { suusTools }      from './suus-tools'

// ─── Intent → tool subset ─────────────────────────────────────────────────────

type ToolKey = keyof typeof suusTools

export const toolsByIntent: Record<string, ToolKey[]> = {
  contact:    ['contact_zoek', 'render_form', 'render_edit_form', 'contact_update', 'google_zoek_adres', 'get_team_members'],
  notitie:    ['contact_zoek', 'note_create', 'note_get', 'note_update'],
  taak:       ['contact_zoek', 'task_create', 'task_get', 'task_update', 'get_team_members'],
  agenda:     ['contact_zoek', 'calendar_get_free_slot', 'calendar_create', 'calendar_get_many', 'calendar_block', 'calendar_get', 'calendar_update', 'get_team_members'],
  adres:      ['contact_zoek', 'google_zoek_adres', 'contact_create', 'contact_update'],
  briefing:   ['contact_zoek', 'contact_briefing'],
  stats:      ['get_stats', 'get_team_members'],
  multi:      Object.keys(suusTools) as ToolKey[],
  onduidelijk: Object.keys(suusTools) as ToolKey[],
}

// ─── Routing result ───────────────────────────────────────────────────────────

export interface RoutingResult {
  intent:     string
  normalized: string
  complexity: 'simple' | 'complex'
  confidence: 'high' | 'low'
  /** Selected model id */
  model:      'gpt-4o-mini' | 'gpt-4.1'
  /** Filtered tool subset */
  tools:      Partial<typeof suusTools>
}

// ─── Route a message ──────────────────────────────────────────────────────────

export async function routeMessage(
  userMessage: string,
  recentHistory: { role: 'user' | 'assistant'; content: string }[] = [],
): Promise<RoutingResult> {
  try {
    const { object } = await generateObject({
      model:  openai('gpt-4o-mini'),
      system: `Je analyseert berichten van sales reps aan een CRM-assistent (SUUS).
Bepaal de intent, normaliseer het bericht en inschat de complexiteit.

## Bevestigingen en selecties (HOOGSTE PRIORITEIT)
Als het huidige bericht een bevestiging of selectie is:
- Enkel getal ("1", "2", "20") na een lijst → selectie
  - Zoek in de vorige assistant tekst het bijbehorende item op (naam + [contactId: xyz] als aanwezig)
  - normalized = "Gebruik contact [naam] (contactId: [id uit lijst]) — voer de gevraagde actie uit, GEEN nieuwe contact_zoek"
- "Ja", "Jaa", "doe", "ja doe", "maak aan", "ja maak aan", "jaa maak aan", "jaa nieuw contact", "nieuw contact", "prima", "oke", "klopt", "jaa doe" → bevestiging van de voorgestelde actie uit het vorige bericht
  - normalized = herhaal de actie concreet met de contactgegevens uit het vorige assistant bericht
  - Als de vorige actie "nieuw contact aanmaken" was na 0 zoekresultaten: normalized = "render_form aanroepen voor [bedrijfsnaam], [stad] — GEEN nieuwe contact_zoek (al 0 resultaten gevonden)"
  - intent = zelfde als de vorige actie, confidence = high, complexity = simple
- "die", "die bedoel ik", "jaa die", "jaa die bedoel ik", "dat klopt", "ja die" na een genummerde lijst:
  - Zoek in de vorige assistant tekst welk item als meest logische keuze benoemd werd (bijv. "Bedoel je nr 3: ...")
  - Als contactId zichtbaar in tekst: normalized = "Gebruik contact [naam] (contactId: [id]) — voer render_edit_form direct uit, GEEN nieuwe contact_zoek"
  - Als geen contactId zichtbaar: normalized = "Bevestiging van [naam] — voer de gevraagde actie uit"
- "hey", "hoi", "hallo", "jooo" → begroeting, intent = onduidelijk, normalized = "[begroeting]", confidence = high

## Intents
- contact:     nieuw contact aanmaken, contact zoeken of updaten
- notitie:     note/aantekening/bezoekverslag toevoegen of wijzigen
- taak:        taak/herinnering aanmaken of wijzigen voor een contact
- agenda:      afspraak plannen, bezoek registreren, agenda bekijken
- adres:       adres opzoeken, Google Maps link verwerken
- briefing:    briefing/overzicht opvragen over een contact
- stats:       statistieken, aantallen leads, teamleden opvragen
- multi:       meerdere acties in één bericht (bijv. bezoek + note + taak)
- onduidelijk: niet te classificeren of echt onduidelijk

## normalized
Schrijf de opdracht als een complete, zelfstandige zin in helder Nederlands.
- Verbeter spelfouten ("vaster 33 amsterda" → "Venster 33 Amsterdam")
- Maak vage follow-ups concreet met context uit history ("Voeg toe" → "Voeg [contact] toe als GHL contact")
- Behoud alle concrete info: namen, adressen, telefoonnummers, contactIds

## complexity
- simple: 1 actie, duidelijke input — alleen voor notitie/taak/stats op bestaand contact
- complex: ALTIJD bij contact aanmaken/zoeken/updaten, adres opzoeken, briefing, multi-step, of onduidelijke input

## confidence
- high: duidelijke intent
- low: twijfelgeval → gebruik dan altijd gpt-4.1 + alle tools`,
      messages: [
        ...recentHistory.slice(-3),
        { role: 'user', content: userMessage },
      ],
      schema: z.object({
        intent:     z.enum(['contact', 'notitie', 'taak', 'agenda', 'adres', 'briefing', 'stats', 'multi', 'onduidelijk']),
        normalized: z.string().describe('Opgeschoonde opdracht in helder Nederlands'),
        complexity: z.enum(['simple', 'complex']),
        confidence: z.enum(['high', 'low']),
      }),
    })

    // These intents always need multi-step flows — mini can't reliably orchestrate them
    const alwaysFullPower = new Set(['contact', 'adres', 'multi', 'onduidelijk', 'briefing'])
    const useFullPower = object.complexity === 'complex'
      || object.confidence === 'low'
      || alwaysFullPower.has(object.intent)
    const model  = useFullPower ? 'gpt-4.1' : 'gpt-4o-mini'
    const keys   = useFullPower
      ? (Object.keys(suusTools) as ToolKey[])
      : (toolsByIntent[object.intent] ?? Object.keys(suusTools) as ToolKey[])

    const tools = Object.fromEntries(
      keys.filter(k => k in suusTools).map(k => [k, suusTools[k]])
    ) as Partial<typeof suusTools>

    return { ...object, model, tools }

  } catch (err) {
    console.warn('[suus-router] routing failed, falling back to full gpt-4.1:', err)
    return {
      intent:     'onduidelijk',
      normalized: userMessage,
      complexity: 'complex',
      confidence: 'low',
      model:      'gpt-4.1',
      tools:      suusTools,
    }
  }
}
