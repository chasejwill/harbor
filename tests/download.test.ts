import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { runDownload } from '../shared/download'

describe('runDownload', () => {
  it('records progress and returns the file a downloader prints', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'harbor-run-'))
    const file = path.join(dir, 'Clip [id].mp4')
    const script = path.join(dir, 'fake-ytdlp')
    writeFileSync(
      script,
      `#!/bin/sh
echo "[download]  25.0% of    1.00MiB at  500.00KiB/s ETA 00:03" >&2
sleep 0.25
echo "[download]  80.0% of    1.00MiB at  500.00KiB/s ETA 00:01" >&2
echo "[Merger] Merging formats into \\"${file}\\"" >&2
printf 'saved' > '${file}'
echo 'filepath:${file}'
`,
    )
    chmodSync(script, 0o755)

    const events: Array<{ stage: string; percent: number | null }> = []
    const result = await runDownload({
      binary: script,
      args: ['--no-playlist'],
      signal: new AbortController().signal,
      onProgress: (event) => events.push({ stage: event.stage, percent: event.percent }),
    })

    expect(result.filePath).toBe(file)
    expect(readFileSync(file, 'utf8')).toBe('saved')
    expect(events.some((event) => event.stage === 'downloading' && event.percent === 80)).toBe(true)
    expect(events.some((event) => event.stage === 'merging')).toBe(true)
  })

  it('stops when the download is cancelled', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'harbor-stop-'))
    const script = path.join(dir, 'sleep-ytdlp')
    writeFileSync(script, '#!/bin/sh\nsleep 30\n')
    chmodSync(script, 0o755)
    const controller = new AbortController()
    const pending = runDownload({
      binary: script,
      args: [],
      signal: controller.signal,
      onProgress: () => {},
    })
    const assertion = expect(pending).rejects.toMatchObject({ stopped: true })
    controller.abort()
    await assertion
  })
})
