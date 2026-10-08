const { app, BrowserWindow, ipcMain, screen, Notification, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const DATA_FILE = path.join(app.getPath('userData'), 'readlify-data.json');
const APP_ICON = path.join(__dirname, 'build', 'icon.png');

// Without this, Windows has no registered display name to show on the
// notification toast (especially in dev mode, running unpackaged via
// `npm start`), so it falls back to showing Electron's own internal
// default ID literally — that's the "electron.app.Readlify" text seen at
// the top of the notification. Setting it explicitly makes the toast
// header just say "Readlify". Must be called before `app.whenReady()` /
// before any Notification is created.
if (process.platform === 'win32') {
  app.setAppUserModelId('Readlify');
}

let mainWindow = null;
let miniTimerWindow = null;
// Last timer tick/state forwarded by the main window. Cached here so that
// whenever the floating widget window is (re)opened it can be painted with
// the real, current countdown immediately — otherwise it would sit on the
// hardcoded "25:00 / Fokus" placeholder baked into mini-timer.html until the
// next tick or button press in the main window, which read as "the widget
// doesn't show up / doesn't work" even though the window itself was there.
let lastTimerState = null;

// Only ever hand off plain http(s) links to the OS browser — blocks
// javascript:, file:, data: and other schemes that could otherwise be
// abused to reach local files or run script via a crafted link.
function isSafeExternalUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch (e) {
    return false;
  }
}

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

  // Any link that tries to open a new window (target="_blank", window.open,
  // dsb.) gets handed off to the OS default browser instead of spawning a
  // second Electron window — dipakai buat tombol donasi & link eksternal
  // lainnya.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // Extra safety net: kalau ada yang nyoba nge-navigate window utama itu
  // sendiri ke URL luar (klik link biasa yang lolos, dsb.), batalin
  // navigasinya dan lempar ke browser default aja, bukan dimuat di dalam app.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      if (isSafeExternalUrl(url)) shell.openExternal(url);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (miniTimerWindow) { miniTimerWindow.close(); miniTimerWindow = null; }
  });
}

function createMiniTimerWindow() {
  if (miniTimerWindow) {
    // It can already exist but be minimized/hidden behind other windows —
    // .focus() alone doesn't un-minimize or re-map a hidden window on every
    // platform, so explicitly restore + show first.
    if (miniTimerWindow.isMinimized()) miniTimerWindow.restore();
    miniTimerWindow.show();
    miniTimerWindow.focus();
    return;
  }
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
    // Fully-transparent 32-bit background. Leaving this unset can make a
    // transparent+frameless window fail to composite correctly on some
    // Windows setups (GPU/driver dependent) and render as blank/invisible
    // instead of showing the card — explicit ARGB avoids that.
    backgroundColor: '#00000000',
    hasShadow: true,
    show: false, // paint fully (and apply always-on-top) before showing
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

  miniTimerWindow.once('ready-to-show', () => {
    // Re-assert after the OS has actually mapped the window — on Windows the
    // always-on-top flag is occasionally dropped by the window manager if
    // it's set only before the first paint.
    miniTimerWindow.setAlwaysOnTop(true, 'screen-saver');
    miniTimerWindow.show();
  });

  miniTimerWindow.webContents.once('did-finish-load', () => {
    if (lastTimerState) miniTimerWindow.webContents.send('timer:state', lastTimerState);
  });

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

// Main window -> mini window: forward every tick/state update, and cache it
// so a freshly (re)opened widget window can be painted with the real state
// right away instead of a stale placeholder.
ipcMain.on('timer:state', (_evt, state) => {
  lastTimerState = state;
  if (miniTimerWindow) miniTimerWindow.webContents.send('timer:state', state);
});

// Mini window -> main window: forward control actions (pause/resume/skip)
ipcMain.on('timer:control', (_evt, action) => {
  if (mainWindow) mainWindow.webContents.send('timer:control', action);
});

// ---------- Native notifications (pengingat jam belajar & deadline) ----------
// The renderer decides WHEN and WHAT to say (it's the one holding the
// task/reminder state) but the actual popup is created here with Electron's
// own Notification, not the browser's. That way it looks/behaves like a
// real OS notification (Action Center / Notification Center / libnotify),
// still shows up even when Readlify isn't the focused window, and doesn't
// need a permission prompt the way the web Notification API would inside a
// renderer.
ipcMain.on('notify:show', (_evt, payload = {}) => {
  if (!Notification.isSupported()) return;
  const n = new Notification({
    title: payload.title || 'Readlify',
    body: payload.body || '',
    icon: APP_ICON,
    // The Pomodoro chime (or any in-app toast) already covers sound for
    // things happening while the app is open; a second OS ping on top of
    // that would double up and feel jarring — especially for the exact
    // audience (ADHD-friendly reminders) these notifications are for.
    silent: true,
  });
  n.on('click', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    if (payload.goto) mainWindow.webContents.send('notify:clicked', payload.goto);
  });
  n.show();
});

app.whenReady().then(() => {
  // Readlify tidak boleh membuka dirinya sendiri saat PC baru menyala.
  // Aplikasi ini tidak pernah mendaftarkan diri sebagai program startup;
  // baris ini juga membersihkan entri startup lama (misalnya dari versi
  // sebelumnya) yang pernah terdaftar lewat API Electron. Hanya berlaku
  // di build hasil install, bukan saat `npm start`.
  if (app.isPackaged) {
    try { app.setLoginItemSettings({ openAtLogin: false }); } catch (_) { /* abaikan */ }
  }

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
