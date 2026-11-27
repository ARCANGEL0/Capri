// One place for the Even event-envelope quirks that cost real time on glass:
// protobuf omits zero, so CLICK_EVENT has no eventType, and a tap can arrive on
// either sysEvent or textEvent depending on the host version.

export interface EventEnvelope {
  eventType?: number
}

export interface EvenLikeEvent {
  sysEvent?: EventEnvelope | null
  textEvent?: EventEnvelope | null
  menuItemClickEvent?: { itemID?: number | string } | null
}

/** Return the event type, treating a missing type as CLICK_EVENT (0). */
export function eventTypeOf(envelope?: EventEnvelope | null): number | null {
  if (!envelope) return null
  const type = envelope.eventType
  return typeof type === 'number' && Number.isFinite(type) ? type : 0
}

/** True when either legacy envelope carries this event type. */
export function isEventType(event: EvenLikeEvent, type: number): boolean {
  return eventTypeOf(event.sysEvent) === type || eventTypeOf(event.textEvent) === type
}

/** Menu IDs are uint32 on the wire, but some hosts serialize them as strings. */
export function menuIDFromEvent(event: EvenLikeEvent): number | undefined {
  const raw = event.menuItemClickEvent?.itemID
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : undefined
  if (typeof raw === 'string') {
    const parsed = Number(raw.trim())
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}
