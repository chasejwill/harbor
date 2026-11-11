import { spawn } from 'node:child_process'
import { cleanSpeed, humanError, parseLine } from './plan'
import type { ProgressPayload, Stage } from './types'

export class DownloadError extends Error {
  readonly stopped: boolean

  constructor(message: string, stopped = false) {
    super(message)
    this.name = 'DownloadError'
    this.stopped = stopped
  }
}

export interface RunDownloadOptions {
  binary: string
  args: string[]
  signal: AbortSignal
  onProgress: (event: ProgressPayload) => void
}

export async function runDownload(options: RunDownloadOptions): Promise<{ filePath: string }> {
  if (options.signal.aborted) {
    throw new DownloadError('No file was saved.', true)
  }

  const child = spawn(options.binary, options.args, {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  })

  let settled = false
  let aborted = false
  let stderr = ''
  let stdout = ''
  let stage: Stage = 'preparing'
  let percent: number | null = null
  let speed: string | null = null
  let eta: string | null = null
  let best: { path: string; rank: number } | null = null
  let lastEmit = 0
  const stdoutRest = { buf: '' }
  const stderrRest = { buf: '' }

  const emit = (force = false) => {
    const now = Date.now()
    if (!force && stage === 'downloading' && percent !== 100 && now - lastEmit < 200) return
    lastEmit = now
    options.onProgress({
      stage,
      percent: stage === 'downloading' ? percent : null,
      speed: stage === 'downloading' ? speed : null,
      eta: stage === 'downloading' ? eta : null,
    })
  }

  const consider = (filePath: string | undefined, rank: number) => {
    if (!filePath) return
    if (!best || rank >= best.rank) best = { path: filePath, rank }
  }

  const handle = (line: string) => {
    const parsed = parseLine(line)
    if (parsed.kind === 'ignore') return
    if (parsed.kind === 'progress') {
      stage = 'downloading'
      percent = parsed.percent
      speed = cleanSpeed(parsed.speed)
      eta = parsed.eta
      emit()
      return
    }
    if (parsed.kind === 'filepath') {
      consider(parsed.filePath, 4)
      return
    }
    if (parsed.kind === 'already') {
      consider(parsed.filePath, 3)
      stage = 'finishing'
      emit(true)
      return
    }
    if (parsed.kind === 'destination') {
      consider(parsed.filePath, 1)
      stage = 'downloading'
      emit(true)
      return
    }
    stage = parsed.stage
    consider(parsed.filePath, 2)
    emit(true)
  }

  emit(true)

  return new Promise((resolve, reject) => {
    const finish = (run: () => void) => {
      if (settled) return
      settled = true
      options.signal.removeEventListener('abort', onAbort)
      run()
    }

    const onAbort = () => {
      aborted = true
      killTree(child.pid)
    }

    options.signal.addEventListener('abort', onAbort, { once: true })

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = appendCapped(stdout, chunk.toString('utf8'))
      consume(chunk, stdoutRest, handle)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = appendCapped(stderr, chunk.toString('utf8'))
      consume(chunk, stderrRest, handle)
    })

    child.on('error', (error: NodeJS.ErrnoException) => {
      finish(() => {
        reject(
          new DownloadError(
            error.code === 'ENOENT'
              ? 'Harbor couldn’t start yt-dlp. Run npm run fetch-engines, or install yt-dlp and restart.'
              : 'Harbor couldn’t start yt-dlp.',
          ),
        )
      })
    })

    child.on('close', (code) => {
      consume(Buffer.from('\n'), stdoutRest, handle)
      consume(Buffer.from('\n'), stderrRest, handle)
      finish(() => {
        if (code === 0 && best) {
          resolve({ filePath: best.path })
          return
        }
        if (aborted) {
          reject(new DownloadError('No file was saved.', true))
          return
        }
        reject(new DownloadError(humanError(`${stderr}\n${stdout}`)))
      })
    })
  })
}

function consume(chunk: Buffer, rest: { buf: string }, push: (line: string) => void) {
  rest.buf += chunk.toString('utf8')
  const lines = rest.buf.split(/\r\n|\n|\r/)
  rest.buf = lines.pop() ?? ''
  for (const line of lines) push(line)
}

function appendCapped(current: string, next: string, max = 40_000): string {
  const combined = current + next
  return combined.length > max ? combined.slice(combined.length - max) : combined
}

function killTree(pid: number | undefined) {
  if (!pid) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' })
    return
  }
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // The process already exited.
    }
  }
  setTimeout(() => {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // Already gone.
      }
    }
  }, 1500).unref()
}
