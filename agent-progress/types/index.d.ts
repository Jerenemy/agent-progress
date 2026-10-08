export type RunningAgent = { id: string; type: string; description: string }

/** The current batch of agents: every agent spawned since the last time none were running. */
export type Progress = {
  total: number
  done: number
  failed: number
  running: RunningAgent[]
}

declare module 'claude-code' {
  interface PluginState {
    'agent-progress': { progress: Progress | null }
  }
}
