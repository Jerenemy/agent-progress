import { atom, read, update } from 'claude-code'
import type { AgentInfo, AgentStatus, EngineInterface, Register } from 'claude-code'

import type { Progress } from '../types'

const progress = atom({ plugin: 'agent-progress', key: 'progress' } as const, null)

const ACTIVE: AgentStatus[] = ['pending', 'running', 'waiting']
const FAILED: AgentStatus[] = ['failed', 'killed']
const BAR_WIDTH = 24
const MAX_LISTED = 3

// Agents already seen, so ones that finished before this module loaded are not counted.
const known = new Set<string>()
// The current batch: everything spawned since the last moment nothing was running.
let batch = new Set<string>()
let isFirstPoll = true
let last = ''

const isActive = (a: AgentInfo) => ACTIVE.includes(a.status)

async function poll($: EngineInterface) {
  const agents = await $.agent.list()
  const byId = new Map(agents.map(a => [a.id, a]))
  let isSettled = [...batch].every(id => {
    const a = byId.get(id)
    return a === undefined || !isActive(a)
  })

  for (const a of agents) {
    if (known.has(a.id)) continue
    known.add(a.id)
    if (isFirstPoll && !isActive(a)) continue
    // A new agent after the last batch finished starts a fresh bar.
    if (isSettled) {
      batch = new Set()
      isSettled = false
    }
    batch.add(a.id)
  }
  isFirstPoll = false

  const members = [...batch].map(id => byId.get(id)).filter((a): a is AgentInfo => a !== undefined)
  const next: Progress | null =
    members.length === 0
      ? null
      : {
          total: members.length,
          done: members.filter(a => !isActive(a) && !FAILED.includes(a.status)).length,
          failed: members.filter(a => FAILED.includes(a.status)).length,
          running: members
            .filter(isActive)
            .map(a => ({ id: a.id, type: a.type, description: a.description })),
        }

  const key = JSON.stringify(next)
  if (key !== last) {
    last = key
    await update($, progress, () => next)
  }
}

// Once a batch has fully finished, the next prompt clears the bar.
async function clearIfFinished($: EngineInterface) {
  const p = await read($, progress)
  if (p !== null && p.running.length === 0) {
    batch = new Set()
    last = JSON.stringify(null)
    await update($, progress, () => null)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await poll($)
    $.clock.every(1000, () => void poll($))

    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    await poll($)

    return started
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined) await poll($)

    return done
  })

  on('prompt.submit', async ($, e, next) => {
    await clearIfFinished($)

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const p = await read($, progress)
    if (p === null || e.props.hasSurvey) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const doneCells = Math.round((p.done / p.total) * BAR_WIDTH)
    const failedCells = Math.min(BAR_WIDTH - doneCells, Math.round((p.failed / p.total) * BAR_WIDTH))
    const restCells = BAR_WIDTH - doneCells - failedCells
    const finished = p.done + p.failed
    const isComplete = p.running.length === 0
    const listed = p.running.slice(0, MAX_LISTED)
    const more = p.running.length - listed.length

    return (
      <Box flexDirection="column">
        <Text>
          <Text bold>{isComplete ? '✓ Agents ' : '⏵ Agents '}</Text>
          <Text color="green">{'█'.repeat(doneCells)}</Text>
          <Text color="red">{'█'.repeat(failedCells)}</Text>
          <Text dimColor>{'░'.repeat(restCells)}</Text>
          <Text>{` ${finished}/${p.total}`}</Text>
          <Text dimColor>
            {isComplete ? ' all finished' : ` · ${p.running.length} running`}
            {p.failed > 0 ? ` · ${p.failed} failed` : ''}
          </Text>
        </Text>
        {listed.map(a => (
          <Text key={a.id} dimColor wrap="truncate-end">
            {'  ↳ '}
            <Text color="cyan">{a.type}</Text>
            {` ${a.description}`}
          </Text>
        ))}
        {more > 0 ? <Text dimColor>{`  … and ${more} more`}</Text> : null}
      </Box>
    )
  })
}
