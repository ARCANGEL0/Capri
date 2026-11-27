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

  console.log('chat pipeline: 8 checks passed')
} finally {
  await rm(dir, { recursive: true, force: true })
}
