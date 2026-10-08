import { expect, test } from 'claude-code/testing'
import type { AgentInfo, RenderElement } from 'claude-code'

const SURFACES = ['terminal', 'desktop'] as const

const agent = (id: string, status: AgentInfo['status']): AgentInfo => ({
  id,
  type: 'Explore',
  description: `task ${id}`,
  status,
})

const turnDone = (agentId: string) => ({
  answer: '',
  durationMs: 1,
  isAborted: false,
  turnId: `t-${agentId}`,
  agentId,
  reason: 'answer' as const,
})

const text = (tree: unknown) => JSON.stringify(tree)

for (const surface of SURFACES) {
  test(`tracks a batch of agents to completion on ${surface}`, async ($, on) => {
    let agents: AgentInfo[] = []
    on('agent.list', () => ({ value: agents }))
    on('turn.complete', (_, e) => ({ text: e.answer }))
    // Stands in for the engine's own band when the mod draws nothing.
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      const { Box } = $.ui.resolve(e)
      return h(Box, {}) as RenderElement
    })

    const band = () =>
      $.ui.mount({
        plugin: 'agent-progress',
        surface,
        component: 'AbovePrompt',
        props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} },
      })

    // Nothing running: the band is left to the engine.
    agents = []
    await $.turn.complete(turnDone('none'))
    expect(text(await (await band()).drawn())).not.toContain('Agents')

    agents = [agent('a', 'running'), agent('b', 'running')]
    await $.turn.complete(turnDone('a'))
    let drawn = text(await (await band()).drawn())
    expect(drawn).toContain('0/2')
    expect(drawn).toContain('2 running')
    expect(drawn).toContain('task a')

    agents = [agent('a', 'completed'), agent('b', 'failed')]
    await $.turn.complete(turnDone('b'))
    drawn = text(await (await band()).drawn())
    expect(drawn).toContain('2/2')
    expect(drawn).toContain('all finished')
    expect(drawn).toContain('1 failed')

    // A new agent after the batch finished starts a fresh bar.
    agents = [...agents, agent('c', 'running')]
    await $.turn.complete(turnDone('c'))
    drawn = text(await (await band()).drawn())
    expect(drawn).toContain('0/1')
  })
}
