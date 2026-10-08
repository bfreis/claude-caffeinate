// The state contract: self-contained, so the settings shape is spelled out here (hooks/settings.ts mirrors it)
declare module 'claude-code' {
  interface PluginState {
    caffeinate: {
      view: {
        settings: { mode: 'turn' | 'session' | 'off'; scheduled: boolean; program: 'caffeinate' | 'custom'; flags: string; custom: string; lid: boolean }
        lid: 'unknown' | 'unsupported' | 'missing' | 'outdated' | 'installed' | 'busy'
        lidMessage: string | undefined
        holding: string | undefined
        reason: string | undefined
        problem: string | undefined
      }
    }
  }
}
