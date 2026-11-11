import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { AppState, AudioFormat, Mode, ProgressPayload, StartResult } from '../shared/types'

const harbor = {
  getState: (): Promise<AppState> => ipcRenderer.invoke('harbor:get-state'),
  chooseFolder: (): Promise<string | null> => ipcRenderer.invoke('harbor:choose-folder'),
  start: (payload: { url: string; mode: Mode; audioFormat: AudioFormat }): Promise<StartResult> =>
    ipcRenderer.invoke('harbor:start', payload),
  stop: (): Promise<void> => ipcRenderer.invoke('harbor:stop'),
  showSaved: (): Promise<{ ok: boolean; message?: string }> => ipcRenderer.invoke('harbor:show-saved'),
  onProgress: (handler: (payload: ProgressPayload) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, payload: ProgressPayload) => handler(payload)
    ipcRenderer.on('harbor:progress', listener)
    return () => ipcRenderer.removeListener('harbor:progress', listener)
  },
}

contextBridge.exposeInMainWorld('harbor', harbor)
