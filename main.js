const { app, BrowserWindow, ipcMain, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const DATA_FILE = path.join(app.getPath('userData'), 'readlify-data.json');
const APP_ICON = path.join(__dirname, 'build', 'icon.png');

let mainWindow = null;
let miniTimerWindow = null;
let nudgeWindow = null;
let focusGuardActive = false;
let guardBlurTimer = null;

// ---------- Data persistence (plain JSON file — no DB needed for a prototype) ----------
function loadData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    return null; // renderer will fall back to its default state
  }
}

function saveData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (e) {
    console.error('Gagal menyimpan data:', e);
    return false;
  }
}

// ---------- Focus Mode "reminder medsos" ----------
// This used to try to actually enforce blocking at the OS network level,
// which needed elevated permission and modified a protected system file —
// a combination that antivirus/SmartScreen reliably treat as malware, even
// with harmless intent. That approach is gone for good. This is now purely
// a soft, in-app reminder — nothing here touches anything outside the
// app's own data file, and nothing requests elevated permission.
async function setSoftFocusReminder(domains) {
  return { ok: true, soft: true, domains };
}


// ---------- Buka PDF dari luar (klik dua kali di Explorer / "Buka dengan" Readlify) ----------
// Installer mendaftarkan Readlify sebagai penampil PDF. File yang dikirim OS lewat argumen
// baris perintah dibaca di sini lalu dikirim ke renderer; renderer yang membukanya di EdPDF.
// Cuma file berekstensi .pdf yang diterima, dan Readlify cuma membaca file-nya (nggak mengubah).
const PDF_RE = /\.pdf$/i;
let pendingPdfPaths = [];
let rendererReady = false;

function pdfPathsFromArgv(argv, cwd) {
  return (argv || [])
    .filter((a) => typeof a === 'string' && !a.startsWith('-') && PDF_RE.test(a))
    .map((a) => path.resolve(cwd || process.cwd(), a))
    .filter((p) => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } });
}
async function deliverPdfs(paths) {
  const files = [];
  for (const p of paths) {
    try { files.push({ name: path.basename(p), data: await fs.promises.readFile(p) }); } catch (e) { /* file hilang/terkunci: lewati */ }
  }
  if (files.length && mainWindow) mainWindow.webContents.send('edpdf:open-files', files);
}
function flushPdfs() {
  if (!rendererReady || !mainWindow || !pendingPdfPaths.length) return;
  const list = pendingPdfPaths;
  pendingPdfPaths = [];
  deliverPdfs(list);
}
function queuePdfs(paths) {
  if (!paths.length) return;
  pendingPdfPaths.push(...paths);
  flushPdfs();
}

// Satu jendela Readlify aja: buka file PDF lagi = nambah tab di jendela yang udah ada.
const gotInstanceLock = app.requestSingleInstanceLock();
if (!gotInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_evt, argv, cwd) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
    queuePdfs(pdfPathsFromArgv(argv.slice(1), cwd));
  });
  queuePdfs(pdfPathsFromArgv(process.argv.slice(app.isPackaged ? 1 : 2), process.cwd()));
}
app.on('open-file', (evt, p) => { // macOS
  evt.preventDefault();
  if (PDF_RE.test(p)) queuePdfs([p]);
});

// ---------- Windows ----------
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 860,
    minHeight: 560,
    backgroundColor: '#F7F1E7',
    titleBarStyle: 'hiddenInset', // native-looking inset traffic lights on macOS
    vibrancy: 'sidebar',          // macOS-only soft translucency; ignored elsewhere
    visualEffectState: 'active',
    icon: APP_ICON,                // taskbar/window icon on Windows & Linux
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // The Pomodoro countdown runs as a setInterval in THIS window's
      // renderer (the mini widget just mirrors it over IPC). By default
      // Chromium throttles timers in a window once it's occluded/minimized
      // to save power — that's the "kadang berhenti sendiri" bug: minimize
      // Readlify or put another window fully over it and the countdown
      // could stall or drift. Keeping it un-throttled means it keeps
      // ticking accurately no matter what's on top of it.
      backgroundThrottling: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.webContents.on('did-start-loading', () => { rendererReady = false; });
  mainWindow.on('closed', () => {
    rendererReady = false;
    mainWindow = null;
    if (miniTimerWindow) { miniTimerWindow.close(); miniTimerWindow = null; }
    clearTimeout(guardBlurTimer);
    hideNudgeWindow();
  });

  // ---------- "Balik fokus" nudge (safe stand-in for cross-app blocking) ----------
  // The renderer tells us (via focus-guard:set) whenever an active work
  // session with the reminder toggle on is actually counting down. While
  // that's true, switching away from Readlify for more than a few seconds
  // brings up a full-screen "balik fokus" card with one button. This only
  // ever looks at THIS app's own window-focus events — it never inspects,
  // lists, or touches any other program, so there's nothing here that
  // resembles process/window surveillance.
  mainWindow.on('blur', () => {
    if (!focusGuardActive) return;
    clearTimeout(guardBlurTimer);
    guardBlurTimer = setTimeout(() => {
      if (focusGuardActive) createNudgeWindow();
    }, 4000);
  });
  mainWindow.on('focus', () => {
    clearTimeout(guardBlurTimer);
    hideNudgeWindow();
  });
}

function createNudgeWindow() {
  if (nudgeWindow) { nudgeWindow.show(); return; }
  const display = screen.getPrimaryDisplay();
  const { width, height } = display.workAreaSize;

  nudgeWindow = new BrowserWindow({
    width, height, x: 0, y: 0,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    icon: APP_ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  nudgeWindow.setAlwaysOnTop(true, 'screen-saver');
  nudgeWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  nudgeWindow.loadFile(path.join(__dirname, 'src', 'focus-nudge.html'));

  nudgeWindow.on('closed', () => { nudgeWindow = null; });
}

function hideNudgeWindow() {
  if (nudgeWindow) { nudgeWindow.close(); nudgeWindow = null; }
}

function createMiniTimerWindow() {
  if (miniTimerWindow) { miniTimerWindow.focus(); return; }
  const display = screen.getPrimaryDisplay();
  const { width } = display.workAreaSize;

  miniTimerWindow = new BrowserWindow({
    width: 220,
    height: 150,
    x: width - 240,
    y: 40,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    frame: false,
    transparent: true,
    hasShadow: true,
    icon: APP_ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  // 'floating' still sits below some apps that mark themselves always-on-top
  // (fullscreen games, some video players, the taskbar on certain setups).
  // 'screen-saver' is Electron's highest level — the widget stays visible
  // above literally everything else, which is the actual point of a
  // floating timer widget.
  miniTimerWindow.setAlwaysOnTop(true, 'screen-saver');
  // Keep it in view even if the user switches virtual desktops (macOS
  // Spaces) or another app goes fullscreen.
  miniTimerWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  miniTimerWindow.loadFile(path.join(__dirname, 'src', 'mini-timer.html'));

  miniTimerWindow.on('closed', () => {
    miniTimerWindow = null;
    if (mainWindow) mainWindow.webContents.send('mini-timer-closed');
  });
}

// ---------- IPC ----------
ipcMain.handle('data:load', () => loadData());
ipcMain.handle('data:save', (_evt, data) => saveData(data));

ipcMain.on('mini-timer:open', () => createMiniTimerWindow());
ipcMain.on('mini-timer:close', () => { if (miniTimerWindow) miniTimerWindow.close(); });

// Main window -> mini window: forward every tick/state update
ipcMain.on('timer:state', (_evt, state) => {
  if (miniTimerWindow) miniTimerWindow.webContents.send('timer:state', state);
});

// Mini window -> main window: forward control actions (pause/resume/skip)
ipcMain.on('timer:control', (_evt, action) => {
  if (mainWindow) mainWindow.webContents.send('timer:control', action);
});

ipcMain.handle('app:version', () => app.getVersion());
ipcMain.on('edpdf:ready', () => { rendererReady = true; flushPdfs(); });
// Cetak: tampilkan dialog cetak sistem (pilih printer / "Microsoft Print to PDF", jumlah salinan, dll).
ipcMain.handle('edpdf:print', (evt, opts) => new Promise((resolve) => {
  evt.sender.print(
    { silent: false, printBackground: true, landscape: !!(opts && opts.landscape) },
    (success, reason) => resolve({ ok: !!success, reason: reason || '' })
  );
}));
// Windows nggak ngizinin aplikasi mengganti default sendiri; buka halamannya biar user yang milih.
ipcMain.handle('app:open-default-apps', async () => {
  if (process.platform !== 'win32') return false;
  try { await shell.openExternal('ms-settings:defaultapps'); return true; } catch (e) { return false; }
});
ipcMain.handle('focus:block', (_evt, domains) => setSoftFocusReminder(domains || []));
ipcMain.handle('focus:unblock', () => setSoftFocusReminder([]));

ipcMain.on('focus-guard:set', (_evt, active) => {
  focusGuardActive = !!active;
  if (!focusGuardActive) {
    clearTimeout(guardBlurTimer);
    hideNudgeWindow();
  }
});

ipcMain.on('focus-guard:return', () => {
  hideNudgeWindow();
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

app.whenReady().then(() => {
  if (!gotInstanceLock) return;
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(APP_ICON); // dev-mode dock icon; packaged builds use build/icon.png via electron-builder
  }
  createMainWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
