// The state contract: self-contained, so the settings shape is spelled out here (hooks/settings.ts mirrors it)
declare module 'claude-code' {
  interface PluginState {
    caffeinate: {
      view: {
        settings: { mode: 'turn' | 'session' | 'off'; program: 'caffeinate' | 'custom'; flags: string; custom: string }
        holding: string | undefined
        problem: string | undefined
      }
    }
  }
}
