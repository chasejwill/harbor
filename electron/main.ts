import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import { runDownload, DownloadError } from '../shared/download'
import { findJsRuntime, resolveEngines } from '../shared/engines'
import { buildArgs, fileBaseName, missingEnginesMessage, normalizeRequest, startupNotice } from '../shared/plan'
import { directoryExists, readSettings, writeSettings } from '../shared/settings'
import type { StartResult } from '../shared/types'

const here = path.dirname(fileURLToPath(import.meta.url))

let win: BrowserWindow | null = null
let outputDir = ''
let settingsFile = ''
let lastSaved: string | null = null
let currentAbort: AbortController | null = null

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })
  app.whenReady().then(start)
}

async function start() {
  app.setName('Harbor')
  if (process.platform === 'win32') app.setAppUserModelId('app.harbor.desktop')
  installMenu()

  settingsFile = path.join(app.getPath('userData'), 'settings.json')
  const saved = readSettings(settingsFile)
  outputDir = directoryExists(saved.outputDir) ? saved.outputDir : defaultDownloads()

  const engines = currentEngines()
  const runtime = currentRuntime()
  console.log(
    `Harbor engines: yt-dlp=${engines.ytdlp.path ?? 'missing'} ffmpeg=${engines.ffmpeg.path ?? 'missing'} js=${runtime ? runtime.path : 'missing'}`,
  )

  createWindow()
  registerIpc()
}

function defaultDownloads(): string {
  const home = app.getPath('home')
  let downloads = app.getPath('downloads')
  // Some Linux sessions report Downloads as the home directory. Harbor still
  // starts in a Downloads folder, which is what macOS and Windows already use.
  if (!downloads || path.resolve(downloads) === path.resolve(home)) {
    downloads = path.join(home, 'Downloads')
  }
  try {
    mkdirSync(downloads, { recursive: true })
  } catch (error) {
    console.error('Harbor could not create the Downloads folder.', error)
  }
  if (directoryExists(downloads)) return downloads
  return home
}

function engineBinDirs(): string[] {
  const dirs = [
    path.join(process.cwd(), 'bin'),
    path.join(app.getAppPath(), 'bin'),
    path.join(app.getAppPath(), '..', 'bin'),
  ]
  if (app.isPackaged) dirs.unshift(path.join(process.resourcesPath, 'bin'))
  return [...new Set(dirs)]
}

function currentEngines() {
  return resolveEngines({ binDirs: engineBinDirs() })
}

function currentRuntime() {
  return findJsRuntime({ binDirs: engineBinDirs() })
}

function installMenu() {
  const template: Electron.MenuItemConstructorOptions[] = []
  if (process.platform === 'darwin') {
    template.push({
      label: 'Harbor',
      submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }],
    })
  }
  template.push(
    { role: 'editMenu' },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'close' }],
    },
  )
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow() {
  const icon = windowIcon()
  win = new BrowserWindow({
    width: 460,
    height: 900,
    minWidth: 380,
    minHeight: 560,
    show: false,
    title: 'Harbor',
    backgroundColor: '#f3eee6',
    autoHideMenuBar: process.platform !== 'darwin',
    icon,
    webPreferences: {
      preload: path.join(here, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  })

  win.once('ready-to-show', () => win?.show())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    const dev = process.env.VITE_DEV_SERVER_URL
    if (dev && url.startsWith(dev)) return
    event.preventDefault()
  })

  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) {
    void win.loadURL(devUrl)
  } else {
    const index = path.join(here, '../dist/index.html')
    if (!existsSync(index)) {
      dialog.showErrorBox('Harbor', 'The app files are missing. Run npm run build and try again.')
      app.quit()
      return
    }
    void win.loadFile(index)
  }
}

function windowIcon(): string | undefined {
  const candidates = [
    path.join(process.cwd(), 'build/icon.png'),
    path.join(process.resourcesPath, 'icon.png'),
    path.join(app.getAppPath(), 'build/icon.png'),
  ]
  return candidates.find((candidate) => existsSync(candidate))
}

function registerIpc() {
  ipcMain.handle('harbor:get-state', () => {
    const engines = currentEngines()
    return {
      outputDir,
      engines: engines.flags,
      engineMessage: startupNotice(engines.flags, Boolean(currentRuntime())),
    }
  })

  ipcMain.handle('harbor:choose-folder', async () => {
    const dialogOptions: Electron.OpenDialogOptions = {
      title: 'Choose a save folder',
      defaultPath: outputDir,
      buttonLabel: 'Choose',
      properties: ['openDirectory', 'createDirectory'],
    }
    const result = win ? await dialog.showOpenDialog(win, dialogOptions) : await dialog.showOpenDialog(dialogOptions)
    const picked = result.filePaths[0]
    if (result.canceled || !picked || !directoryExists(picked)) return null
    outputDir = picked
    try {
      writeSettings(settingsFile, { outputDir })
    } catch (error) {
      console.error('Harbor could not remember that folder.', error)
    }
    return outputDir
  })

  ipcMain.handle('harbor:start', async (_event, payload: unknown): Promise<StartResult> => {
    if (currentAbort) return { ok: false, message: 'A download is already running.' }
    const body = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
    const normalized = normalizeRequest({
      url: body.url,
      mode: body.mode,
      audioFormat: body.audioFormat,
      outputDir,
    })
    if (!normalized.ok) return { ok: false, message: normalized.message }
    if (!directoryExists(normalized.request.outputDir)) {
      return { ok: false, message: 'That folder isn’t available. Choose another one.' }
    }

    const engines = currentEngines()
    if (!engines.ytdlp.path || !engines.ffmpeg.path) {
      return {
        ok: false,
        message:
          missingEnginesMessage(engines.flags) ??
          'Harbor needs yt-dlp and ffmpeg. Run npm run fetch-engines, then restart.',
      }
    }

    const controller = new AbortController()
    currentAbort = controller
    const args = buildArgs(normalized.request, {
      ffmpegLocation: engines.ffmpegLocation,
      jsRuntime: currentRuntime(),
    })

    try {
      const result = await runDownload({
        binary: engines.ytdlp.path,
        args,
        signal: controller.signal,
        onProgress: (progress) => {
          win?.webContents.send('harbor:progress', progress)
        },
      })
      lastSaved = result.filePath
      return { ok: true, filePath: result.filePath, fileName: fileBaseName(result.filePath) }
    } catch (error) {
      const stopped = error instanceof DownloadError && error.stopped
      const message = error instanceof Error ? error.message : 'The download failed before a file was saved.'
      return { ok: false, stopped, message }
    } finally {
      if (currentAbort === controller) currentAbort = null
    }
  })

  ipcMain.handle('harbor:stop', () => {
    currentAbort?.abort()
  })

  ipcMain.handle('harbor:show-saved', () => {
    if (!lastSaved || !existsSync(lastSaved)) {
      return { ok: false, message: 'That file isn’t there anymore.' }
    }
    shell.showItemInFolder(lastSaved)
    return { ok: true }
  })
}

app.on('before-quit', () => {
  currentAbort?.abort()
})

app.on('window-all-closed', () => {
  app.quit()
})
