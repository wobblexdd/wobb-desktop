const path = require('node:path');
const { app, BrowserWindow, clipboard, ipcMain } = require('electron');
const { XrayManager } = require('./services/XrayManager');

let mainWindow = null;
let isQuitting = false;
const DEV_SERVER_URL = process.env.ELECTRON_RENDERER_URL || 'http://127.0.0.1:5173';
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

const wobbState = {
  state: 'idle',
  pid: null,
  binaryPath: null,
  configPath: 'stdin:',
  stealthMode: false,
  error: null,
};

function getRendererEntry() {
  const appPath = app?.getAppPath?.() || PROJECT_ROOT;
  return path.join(appPath, 'dist', 'apps', 'web', 'index.html');
}

function getDesktopBinRoot() {
  if (app?.isPackaged) {
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
  logger: {
    info: (message, ...args) => pushLog([message, ...args].join(' '), 'info', 'manager'),
    warn: (message, ...args) => pushLog([message, ...args].join(' '), 'warn', 'manager'),
    error: (message, ...args) => pushLog([message, ...args].join(' '), 'error', 'manager'),
    log: (message, ...args) => pushLog([message, ...args].join(' '), 'info', 'manager'),
  },
});

engine.on('started', (status) => {
  updateWobbState({
    state: 'connected',
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
    state: 'idle',
    pid: null,
    configPath: 'stdin:',
    error: manualStop ? null : `Engine exited unexpectedly (code=${code}, signal=${signal || 'none'})`,
  });
});

engine.on('error', (error) => {
  updateWobbState({
    state: 'error',
    pid: null,
    configPath: 'stdin:',
    error: error.message,
  });
});

function createWindow() {
  const isDev = !app.isPackaged;

  mainWindow = new BrowserWindow({
    width: 1240,
    height: 860,
    minWidth: 1040,
    minHeight: 720,
    backgroundColor: '#0b1220',
    title: 'Wobb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL(DEV_SERVER_URL).catch((error) => {
      pushLog(`Renderer failed to load: ${error.message}`, 'error', 'system');
    });
  } else {
    mainWindow.loadFile(getRendererEntry()).catch((error) => {
      pushLog(`Renderer failed to load: ${error.message}`, 'error', 'system');
    });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    pushLog(
      `Renderer load failure (${errorCode}): ${errorDescription} ${validatedURL || ''}`.trim(),
      'error',
      'system'
    );
  });
}

ipcMain.handle('wobb:start', async (_event, payload = {}) => {
  const stealthMode = Boolean(payload.stealthMode);
  const profile = payload.profile && typeof payload.profile === 'object' ? payload.profile : null;

  if (!profile) {
    throw new Error('Resolved profile is required.');
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
    state: 'connecting',
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
      state: 'connected',
      pid: status.pid,
      binaryPath: status.binaryPath,
      configPath: status.configPath,
      stealthMode,
      error: null,
    });

    return { ok: true, status: { ...wobbState } };
  } catch (error) {
    updateWobbState({
      state: 'error',
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
    state: 'disconnecting',
    error: null,
  });

  try {
    const stopped = await engine.stopXray();

    updateWobbState({
      state: 'idle',
      pid: null,
      configPath: 'stdin:',
      error: null,
    });

    return { ok: true, stopped, status: { ...wobbState } };
  } catch (error) {
    updateWobbState({
      state: 'error',
      error: error.message,
    });

    pushLog(error.message, 'error', 'system');
    throw error;
  }
});

ipcMain.handle('wobb:get-status', async () => {
  return { ...wobbState };
});

ipcMain.handle('wobb:copy-text', async (_event, text = '') => {
  clipboard.writeText(String(text));
  return true;
});

ipcMain.handle('wobb:read-text', async () => {
  return clipboard.readText();
});

app.whenReady().then(() => {
  engine.binRoot = getDesktopBinRoot();
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
