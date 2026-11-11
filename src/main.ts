import '@fontsource/fraunces/latin-500.css'
import '@fontsource/fraunces/latin-600.css'
import '@fontsource/outfit/latin-400.css'
import '@fontsource/outfit/latin-500.css'
import '@fontsource/outfit/latin-600.css'
import './style.css'
import { formatEta, planSentence, stageDetail, validateYouTubeUrl } from '../shared/plan'
import type { AudioFormat, Mode, ProgressPayload } from '../shared/types'

type Phase = 'empty' | 'running' | 'error' | 'success' | 'stopped'

function must<T extends Element>(element: T | null, name: string): T {
  if (!element) throw new Error(`Harbor’s window is missing ${name}.`)
  return element
}

const form = must(document.querySelector<HTMLFormElement>('#save-form'), 'the form')
const urlInput = must(document.querySelector<HTMLInputElement>('#url'), 'the link field')
const folderInput = must(document.querySelector<HTMLInputElement>('#folder'), 'the folder field')
const chooseButton = must(document.querySelector<HTMLButtonElement>('#choose'), 'the folder button')
const startButton = must(document.querySelector<HTMLButtonElement>('#start'), 'the Start button')
const plan = must(document.querySelector<HTMLParagraphElement>('#plan'), 'the summary')
const formatHint = must(document.querySelector<HTMLParagraphElement>('#format-hint'), 'the format note')
const audioFormatField = must(document.querySelector<HTMLFieldSetElement>('#audio-format'), 'the audio choices')
const banner = must(document.querySelector<HTMLDivElement>('#engine-banner'), 'the notice')
const statusEl = must(document.querySelector<HTMLElement>('#status'), 'the status')

let phase: Phase = 'empty'
let running = false
let runId = 0
let progress: ProgressPayload = { stage: 'preparing', percent: null, speed: null, eta: null }
let errorMessage = ''
let savedPath = ''
let savedName = ''

form.addEventListener('change', syncChoice)
form.addEventListener('submit', (event) => {
  event.preventDefault()
  if (running) {
    void window.harbor.stop()
    return
  }
  void begin()
})

chooseButton.addEventListener('click', async () => {
  const next = await window.harbor.chooseFolder()
  if (!next) return
  showFolder(next)
})

statusEl.addEventListener('click', (event) => {
  const target = event.target
  if (!(target instanceof HTMLElement)) return
  if (target.id !== 'show-saved') return
  void window.harbor.showSaved().then((result) => {
    if (!result.ok && result.message) {
      errorMessage = result.message
      phase = 'error'
      renderStatus()
    }
  })
})

syncChoice()
void loadState()

function choice(): { mode: Mode; audioFormat: AudioFormat } {
  const modeValue = form.querySelector<HTMLInputElement>('input[name="mode"]:checked')?.value
  const formatValue = form.querySelector<HTMLInputElement>('input[name="audioFormat"]:checked')?.value
  return {
    mode: modeValue === 'audio' ? 'audio' : 'video',
    audioFormat: formatValue === 'wav' ? 'wav' : 'mp3',
  }
}

function syncChoice() {
  const selected = choice()
  audioFormatField.hidden = selected.mode !== 'audio'
  formatHint.textContent =
    selected.audioFormat === 'wav'
      ? 'Uncompressed. A larger file, with no extra MP3 compression.'
      : 'Smaller file. Plays on phones, cars, and computers.'
  plan.textContent = planSentence(selected.mode, selected.audioFormat, running ? 'active' : 'ready')
}

function showFolder(dir: string) {
  folderInput.value = dir
  folderInput.title = dir
  folderInput.scrollLeft = folderInput.scrollWidth
}

async function loadState() {
  if (!window.harbor) {
    banner.hidden = false
    banner.textContent = 'The app shell didn’t load. Restart Harbor.'
    return
  }
  try {
    const state = await window.harbor.getState()
    showFolder(state.outputDir)
    banner.hidden = !state.engineMessage
    banner.textContent = state.engineMessage ?? ''
  } catch {
    banner.hidden = false
    banner.textContent = 'Harbor couldn’t read its settings. Restart the app.'
  }
}

function setBusy(busy: boolean) {
  running = busy
  urlInput.disabled = busy
  chooseButton.disabled = busy
  for (const input of form.querySelectorAll<HTMLInputElement>('input[type="radio"]')) {
    input.disabled = busy
  }
  startButton.textContent = busy ? 'Stop' : 'Start'
  startButton.classList.toggle('stop', busy)
  startButton.setAttribute('aria-pressed', busy ? 'true' : 'false')
  syncChoice()
}

async function begin() {
  const selected = choice()
  const checked = validateYouTubeUrl(urlInput.value)
  if (!checked.ok) {
    phase = 'error'
    errorMessage = checked.message
    renderStatus()
    urlInput.focus()
    return
  }

  const id = ++runId
  phase = 'running'
  progress = { stage: 'preparing', percent: null, speed: null, eta: null }
  setBusy(true)
  renderStatus()

  const unsubscribe = window.harbor.onProgress((payload) => {
    if (id !== runId || !running) return
    progress = payload
    renderStatus()
  })

  try {
    const result = await window.harbor.start({
      url: checked.url,
      mode: selected.mode,
      audioFormat: selected.audioFormat,
    })
    if (id !== runId) return
    if (result.ok && result.filePath) {
      phase = 'success'
      savedPath = result.filePath
      savedName = result.fileName || result.filePath
    } else if (result.stopped) {
      phase = 'stopped'
    } else {
      phase = 'error'
      errorMessage = result.message || 'The download failed before a file was saved.'
    }
  } catch {
    if (id !== runId) return
    phase = 'error'
    errorMessage = 'Harbor lost the download before a file was saved.'
  } finally {
    unsubscribe()
    if (id === runId) {
      setBusy(false)
      renderStatus()
    }
  }
}

function renderStatus() {
  statusEl.className = `status panel ${phase === 'running' ? 'running' : phase}`
  statusEl.setAttribute('aria-live', phase === 'running' ? 'off' : 'polite')
  statusEl.replaceChildren()

  if (phase === 'running') {
    const selected = choice()
    const row = document.createElement('div')
    row.className = 'stage-row'
    const label = document.createElement('p')
    label.textContent = stageDetail(progress.stage, selected.audioFormat)
    row.append(label)
    if (progress.percent !== null) {
      const percent = document.createElement('span')
      percent.className = 'percent'
      percent.textContent = `${Math.round(progress.percent)}%`
      row.append(percent)
    }

    const bar = document.createElement('div')
    bar.className = progress.percent === null ? 'bar indeterminate' : 'bar'
    bar.setAttribute('role', 'progressbar')
    bar.setAttribute('aria-label', label.textContent ?? 'Download progress')
    bar.setAttribute('aria-valuemin', '0')
    bar.setAttribute('aria-valuemax', '100')
    const fill = document.createElement('span')
    if (progress.percent === null) {
      bar.setAttribute('aria-busy', 'true')
    } else {
      const shown = Math.max(0, Math.min(100, progress.percent))
      bar.setAttribute('aria-valuenow', String(Math.round(shown)))
      fill.style.width = `${shown}%`
    }
    bar.append(fill)

    statusEl.append(row, bar)
    const meta = metaLine()
    if (meta) {
      const line = document.createElement('p')
      line.className = 'meta'
      line.textContent = meta
      statusEl.append(line)
    }
    return
  }

  if (phase === 'error') {
    statusEl.append(heading('Couldn’t save it'), paragraph(errorMessage))
    return
  }
  if (phase === 'success') {
    const name = document.createElement('p')
    name.className = 'filename'
    name.textContent = savedName
    const pathLine = document.createElement('p')
    pathLine.className = 'path'
    pathLine.textContent = savedPath
    const show = document.createElement('button')
    show.type = 'button'
    show.id = 'show-saved'
    show.className = 'secondary show'
    show.textContent = 'Show in folder'
    statusEl.append(heading('Saved'), name, pathLine, show)
    return
  }
  if (phase === 'stopped') {
    statusEl.append(heading('Stopped'), paragraph('No file was saved. You can start again when you want.'))
    return
  }
  statusEl.append(heading('Nothing saved yet'), paragraph('Paste a link, choose video or audio, and press Start.'))
}

function heading(text: string) {
  const node = document.createElement('h2')
  node.textContent = text
  return node
}

function paragraph(text: string) {
  const node = document.createElement('p')
  node.textContent = text
  return node
}

function metaLine(): string | null {
  if (progress.stage !== 'downloading') return null
  const parts: string[] = []
  if (progress.speed) parts.push(progress.speed)
  const eta = formatEta(progress.eta)
  if (eta) parts.push(eta)
  return parts.length ? parts.join(' · ') : null
}
