import type { AppState, AudioFormat, Mode, ProgressPayload, StartResult } from '../shared/types'

export interface HarborApi {
  getState: () => Promise<AppState>
  chooseFolder: () => Promise<string | null>
  start: (payload: { url: string; mode: Mode; audioFormat: AudioFormat }) => Promise<StartResult>
  stop: () => Promise<void>
  showSaved: () => Promise<{ ok: boolean; message?: string }>
  onProgress: (handler: (payload: ProgressPayload) => void) => () => void
}

declare global {
  interface Window {
    harbor: HarborApi
  }
}

export {}
