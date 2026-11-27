// The phone composer and the voice-review card share one Send path. Decide
// which text that path submits in one place so the transcript button cannot
// silently submit the empty composer.

const REVIEW_STATUS = /TRANSCRIPT READY|REVIEW \/ PROMPT|REVIEW \/ COMMAND/i

export function isReviewingDraft(status: string): boolean {
  return REVIEW_STATUS.test(status)
}

export function draftTextForSubmit(status: string, draftText: string, currentDraft: string): string {
  return (isReviewingDraft(status) ? draftText : currentDraft).trimEnd()
}
