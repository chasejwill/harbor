export type Mode = 'video' | 'audio'
export type AudioFormat = 'mp3' | 'wav'
export type Stage = 'preparing' | 'downloading' | 'merging' | 'encoding' | 'finishing'

export interface EngineFlags {
  ytdlp: boolean
  ffmpeg: boolean
  ffprobe: boolean
}

export interface AppState {
  outputDir: string
  engines: EngineFlags
  engineMessage: string | null
}

export interface StartRequest {
  url: string
  mode: Mode
  audioFormat: AudioFormat
}

export interface StartResult {
  ok: boolean
  stopped?: boolean
  message?: string
  filePath?: string
  fileName?: string
}

export interface ProgressPayload {
  stage: Stage
  percent: number | null
  speed: string | null
  eta: string | null
}
