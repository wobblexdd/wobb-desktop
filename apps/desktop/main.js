const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');
const { XrayManager } = require('./services/XrayManager');

let mainWindow = null;
let isQuitting = false;
const DEV_SERVER_URL = process.env.ELECTRON_RENDERER_URL || 'http://127.0.0.1:5173';
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

const wobbState = {
  state: 'ready',
  pid: null,
  binaryPath: null,
  configPath: 'stdin:',
  stealthMode: false,
  error: null,
};

function getRendererEntry() {
  return path.join(app.getAppPath(), 'dist', 'apps', 'web', 'index.html');
}

function getDesktopBinRoot() {
  if (app.isPackaged) {
    return path.join(path.dirname(process.execPath), 'bin');
  }

  return path.join(PROJECT_ROOT, 'bin');
}

function sendToRenderer(channel, payload) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, payload);
    }
  }
}

function updateWobbState(patch) {
  Object.assign(wobbState, patch);
  sendToRenderer('wobb:status', { ...wobbState });
}

function pushLog(message, level = 'info', stream = 'system') {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    timestamp: new Date().toISOString(),
    level,
    stream,
    message: String(message),
  };

  if (level === 'error') {
    console.error(`[${stream}] ${entry.message}`);
  } else if (level === 'warn') {
    console.warn(`[${stream}] ${entry.message}`);
  } else {
    console.log(`[${stream}] ${entry.message}`);
  }

  sendToRenderer('wobb:log', entry);
}

const engine = new XrayManager({
  binRoot: getDesktopBinRoot(),
  logger: {
    info: (message, ...args) => pushLog([message, ...args].join(' '), 'info', 'manager'),
    warn: (message, ...args) => pushLog([message, ...args].join(' '), 'warn', 'manager'),
    error: (message, ...args) => pushLog([message, ...args].join(' '), 'error', 'manager'),
    log: (message, ...args) => pushLog([message, ...args].join(' '), 'info', 'manager'),
  },
});

engine.on('started', (status) => {
  updateWobbState({
    state: wobbState.stealthMode ? 'bypassing-dpi' : 'protected',
    pid: status.pid,
    binaryPath: status.binaryPath,
    configPath: status.configPath,
    error: null,
  });
});

engine.on('stdout', (line) => {
  pushLog(line, 'info', 'engine');
});

engine.on('stderr', (line) => {
  pushLog(line, 'warn', 'engine');
});

engine.on('exit', ({ code, signal, manualStop }) => {
  updateWobbState({
    state: 'ready',
    pid: null,
    configPath: 'stdin:',
    error: manualStop ? null : `Engine exited unexpectedly (code=${code}, signal=${signal || 'none'})`,
  });
});

engine.on('error', (error) => {
  updateWobbState({
    state: 'ready',
    pid: null,
    configPath: 'stdin:',
    error: error.message,
  });
});

function createWindow() {
  const isDev = !app.isPackaged;

  mainWindow = new BrowserWindow({
    width: 1240,
    height: 900,
    minWidth: 980,
    minHeight: 760,
    backgroundColor: '#f5f7fb',
    title: 'Wobb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL(DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(getRendererEntry());
  }

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

ipcMain.handle('wobb:start', async (_event, payload = {}) => {
  const stealthMode = Boolean(payload.stealthMode);
  const profile = payload.profile && typeof payload.profile === 'object' ? payload.profile : null;

  if (!profile) {
    throw new Error('Resolved access profile is required.');
  }

  const serverAddress = String(profile.serverAddress || '').trim();
  const uuid = String(profile.uuid || '').trim();
  const serverPort = Number(profile.serverPort);

  if (!serverAddress) {
    throw new Error('Resolved profile is missing a server address.');
  }

  if (!uuid) {
    throw new Error('Resolved profile is missing a UUID.');
  }

  if (!Number.isInteger(serverPort) || serverPort < 1 || serverPort > 65535) {
    throw new Error('Resolved profile has an invalid port.');
  }

  updateWobbState({
    state: 'starting',
    stealthMode,
    error: null,
  });

  const config = XrayManager.createBasicVlessConfig(
    {
      ...profile,
      logLevel: 'info',
    },
    stealthMode
  );

  try {
    const status = await engine.startXray(config);

    updateWobbState({
      state: stealthMode ? 'bypassing-dpi' : 'protected',
      pid: status.pid,
      binaryPath: status.binaryPath,
      configPath: status.configPath,
      stealthMode,
      error: null,
    });

    return { ok: true, status: { ...wobbState } };
  } catch (error) {
    updateWobbState({
      state: 'ready',
      pid: null,
      configPath: 'stdin:',
      stealthMode,
      error: error.message,
    });

    pushLog(error.message, 'error', 'system');
    throw error;
  }
});

ipcMain.handle('wobb:stop', async () => {
  updateWobbState({
    state: 'stopping',
    error: null,
  });

  try {
    const stopped = await engine.stopXray();

    updateWobbState({
      state: 'ready',
      pid: null,
      configPath: 'stdin:',
      error: null,
    });

    return { ok: true, stopped, status: { ...wobbState } };
  } catch (error) {
    updateWobbState({
      state: 'ready',
      error: error.message,
    });

    pushLog(error.message, 'error', 'system');
    throw error;
  }
});

ipcMain.handle('wobb:get-status', async () => {
  return { ...wobbState };
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  updateWobbState({
    binaryPath: engine.binaryPath,
  });

  pushLog(`Desktop core root: ${getDesktopBinRoot()}`, 'info', 'system');
});

app.on('before-quit', async (event) => {
  if (isQuitting) {
    return;
  }

  isQuitting = true;
  event.preventDefault();

  try {
    await engine.dispose();
  } finally {
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
