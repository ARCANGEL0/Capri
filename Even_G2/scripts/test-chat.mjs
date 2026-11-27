// Regression tests for the glasses chat pipeline.
// Run with: npm test
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const dir = await mkdtemp(join(tmpdir(), 'capri-chat-'))
try {
  await build({
    entryPoints: [
      'src/agent-output.ts',
      'src/agent-presentation.ts',
      'src/chat-view.ts',
      'src/review-text.ts',
      'src/session-order.ts',
      'src/phone-draft.ts',
      'src/gesture.ts',
      'src/hud-text.ts',
      'src/input-router.ts',
    ],
    outdir: dir,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    bundle: true,
    logLevel: 'silent',
  })
  const { AgentOutput } = await import(pathToFileURL(join(dir, 'agent-output.js')).href)
  const { presentAgentScreen } = await import(pathToFileURL(join(dir, 'agent-presentation.js')).href)
  const { maxScrollOffset, pageFromEnd, transcriptLines: turnLines } = await import(pathToFileURL(join(dir, 'chat-view.js')).href)
  const { maxReviewOffset, reviewBody } = await import(pathToFileURL(join(dir, 'review-text.js')).href)
  const { sortSessionsByLastUsed, updatedAtMs } = await import(pathToFileURL(join(dir, 'session-order.js')).href)
  const { draftTextForSubmit } = await import(pathToFileURL(join(dir, 'phone-draft.js')).href)
  const { interactionActive, moveSelection, shouldDeliverSwipe, swipePageDelta } = await import(pathToFileURL(join(dir, 'gesture.js')).href)
  const { liveTexts } = await import(pathToFileURL(join(dir, 'hud-text.js')).href)
  const { resolveTapIndex } = await import(pathToFileURL(join(dir, 'input-router.js')).href)

  // Cursor-left redraws must replace text, not concatenate it.
  const redraw = new AgentOutput()
  redraw.feed('Hello world\u001b[5Dthere\n')
  assert.equal(redraw.text(), 'Hello there', 'CSI cursor-left should overwrite the old fragment')

  // A carriage-return redraw must not leave the old tail behind.
  const carriage = new AgentOutput()
  carriage.feed('loading...\rDone\n')
  assert.equal(carriage.text(), 'Done', 'bare CR should restart the current line')

  // Erase-line redraws must not leave the previous line behind.
  const erased = new AgentOutput()
  erased.feed('working...\u001b[2Kdone\n')
  assert.equal(erased.text(), 'done', 'CSI erase line should drop the old fragment')

  // OSC title updates and colour codes carry no visible text.
  const noise = new AgentOutput()
  noise.feed('\u001b]0;Capri\u0007\u001b[31mIt is available\u001b[0m to beta testers.\n')
  assert.equal(noise.text(), 'It is available to beta testers.')

  // A control sequence split across network chunks must still be applied.
  const streamed = new AgentOutput()
  streamed.feed('Hello world\u001b')
  streamed.feed('[5Dthere\n')
  assert.equal(streamed.text(), 'Hello there')

  // Tool calls and their output stay out of the reply; only prose remains.
  const transcript = [
    '● Bash(npm run build)',
    '⎿  exit code: 0',
    '● It is available to active beta testers; public release requires portal review.',
    '● It uses the shared app-server path.',
  ].join('\n')
  const presentation = presentAgentScreen(transcript)
  assert.match(presentation.response, /public release requires portal review/)
  assert.match(presentation.response, /shared app-server path/)
  assert.doesNotMatch(presentation.response, /npm run build|exit code/i)
  assert.match(presentation.action, /RUNNING|TOOL DONE/)

  // Spaces in ordinary prose are preserved verbatim; no camelCase mangling.
  const reply = presentAgentScreen('● Use getUserInfo before calling requestJson.\n').response
  assert.equal(reply, 'Use getUserInfo before calling requestJson.')

  // Chat paging must scroll the whole transcript, not just the last reply.
  const transcriptLines = Array.from({ length: 40 }, (_, index) => `line ${index}`)
  assert.equal(maxScrollOffset(transcriptLines.length, 7), 33)
  assert.deepEqual(pageFromEnd(transcriptLines, 14, 7), transcriptLines.slice(19, 26))
  assert.deepEqual(pageFromEnd(transcriptLines, 999, 7), transcriptLines.slice(0, 7))

  // Session pages are strict last-used: harness identity never outranks recency.
  const now = Date.now()
  const sessions = [
    { agent: 'opencode', id: 'stale-opencode', updatedAt: (now - 30 * 86_400_000) / 1000 },
    { agent: 'claude', id: 'fresh-claude', updatedAt: now - 60_000 },
    { agent: 'codex', id: 'middle-codex', updatedAt: now - 3_600_000 },
    { agent: 'nclaude', id: 'missing-time' },
  ]
  assert.equal(updatedAtMs(1_700_000_000), 1_700_000_000_000)
  assert.deepEqual(
    sortSessionsByLastUsed(sessions).map((session) => session.id),
    ['fresh-claude', 'middle-codex', 'stale-opencode', 'missing-time'],
  )

  // Rapid swipes must reach the app; only an exact echo is suppressed.
  const first = { type: 1, source: 'glasses', at: 1000 }
  assert.equal(shouldDeliverSwipe(first, 1, 'glasses', 1005), false)
  assert.equal(shouldDeliverSwipe(first, 2, 'glasses', 1005), true)
  assert.equal(shouldDeliverSwipe(first, 1, 'ring', 1005), true)
  assert.equal(shouldDeliverSwipe(first, 1, 'glasses', 1030), true)
  assert.equal(swipePageDelta(7), 14)
  assert.equal(interactionActive(1200, 1000), true)
  assert.equal(interactionActive(3000, 1000), false)

  // Lists advance exactly one row, so the selection never jumps 1 -> 3.
  assert.equal(moveSelection(0, 'down', 10), 1)
  assert.equal(moveSelection(1, 'down', 10), 2)
  assert.equal(moveSelection(1, 'up', 10), 0)
  assert.equal(moveSelection(0, 'up', 10), 0)
  assert.equal(moveSelection(9, 'down', 10), 9)
  assert.equal(moveSelection(3, 'down', 0), 0)

  // Turns stay chronological: a sent message is the bottom line until the
  // agent answers, then the answer is the bottom line.
  assert.deepEqual(
    turnLines(['first', 'second'], ['reply one']),
    ['YOU> first', 'AGENT> reply one', 'YOU> second'],
  )
  assert.deepEqual(
    turnLines(['first', 'second'], ['reply one', 'reply two']),
    ['YOU> first', 'AGENT> reply one', 'YOU> second', 'AGENT> reply two'],
  )

  // Review is text-only: action rows stay visible while the transcript pages.
  const actions = [{ label: '> Send' }, { label: '  Cancel' }]
  const shortReview = reviewBody('alpha\nbeta\ngamma\ndelta', actions, 0, 0)
  assert.equal(shortReview.length, 7)
  assert.deepEqual(shortReview.slice(-3), ['──────────', '▶ Send', '  Cancel'])
  assert.deepEqual(shortReview.slice(0, 4), ['alpha', 'beta', 'gamma', 'delta'])
  assert.equal(reviewBody('alpha\nbeta\ngamma\ndelta', actions, 1, 0).at(-1), '▶ Cancel')
  const longTranscript = Array.from({ length: 12 }, (_, index) => `line ${index}`).join('\n')
  assert.equal(maxReviewOffset(longTranscript, actions.length), 8)
  assert.deepEqual(reviewBody(longTranscript, actions, 0, 0).slice(0, 4), ['line 8', 'line 9', 'line 10', 'line 11'])
  assert.deepEqual(reviewBody(longTranscript, actions, 0, 8).slice(0, 4), ['line 0', 'line 1', 'line 2', 'line 3'])

  // Gesture acknowledgement is a cheap text write, no canvas/tile repaint.
  const ackText = liveTexts({
    title: 'CAPRI',
    lines: ['AGENT> ready'],
    active: true,
    status: 'LIVE',
    footer: { left: 'LIVE  ·  TAP TO TALK' },
  }, true)
  assert.equal(ackText.hint, '› LIVE  ·  TAP TO TALK')
  assert.equal(ackText.body, 'AGENT> ready')

  // The transcript Send button and the typed composer take different sources.
  assert.equal(draftTextForSubmit('TRANSCRIPT READY  ·  SEND OR CANCEL', 'ship it', ''), 'ship it')
  assert.equal(draftTextForSubmit('LIVE  ·  TAP TO TALK', 'old transcript', 'typed message'), 'typed message')

  // Text-only review has no native list, so unmatched host indices must fall
  // back to the app's selection instead of dropping the Send tap.
  const reviewRows = [{ label: '> Send' }, { label: '  Cancel' }]
  assert.equal(resolveTapIndex(reviewRows, undefined, undefined, 0), 0)
  assert.equal(resolveTapIndex(reviewRows, undefined, -1, 0), 0)
  assert.equal(resolveTapIndex(reviewRows, 'Send', undefined, 0), 0)
  assert.equal(resolveTapIndex(reviewRows, '▶ Cancel', undefined, 0), 1)
  assert.equal(resolveTapIndex(reviewRows, undefined, 99, 0), 0)
  assert.equal(resolveTapIndex(reviewRows, undefined, 1, 0), 1)
  assert.equal(resolveTapIndex([], undefined, 0, 0), -1)

  console.log('chat, scroll, session and send regressions passed')
} finally {
  await rm(dir, { recursive: true, force: true })
}
