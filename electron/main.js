import { app, BrowserWindow, dialog, shell } from 'electron';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createMarketServer } from '../server.js';

app.setName('GOLD-3Po Market Lab');
app.setPath('userData', path.join(app.getPath('appData'), 'GOLD-3Po Market Lab'));

const isSmokeTest = process.argv.includes('--smoke-test');
const hasSingleInstanceLock = app.requestSingleInstanceLock();

let mainWindow = null;
let marketServer = null;
let localOrigin = null;
let isClosingServer = false;

function logError(error) {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  process.stderr.write(message + '\n');
}

async function readOrCreateSettings(userDataPath) {
  const settingsPath = path.join(userDataPath, 'settings.json');

  try {
    const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
    if (typeof settings.marketIngestToken !== 'string' || settings.marketIngestToken.length < 24) {
      throw new Error('The local settings file does not contain a valid market ingestion token.');
    }
    return settings;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;

    const settings = {
      marketIngestToken: randomBytes(32).toString('hex'),
      createdAt: new Date().toISOString()
    };
    await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
    return settings;
  }
}

function listen(server) {
  return new Promise((resolve, reject) => {
    const onError = error => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve(server.address());
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(0, '127.0.0.1');
  });
}

async function startLocalApi() {
  const userDataPath = app.getPath('userData');
  await mkdir(userDataPath, { recursive: true });

  const settings = await readOrCreateSettings(userDataPath);
  const storagePath = path.join(userDataPath, 'market-events.jsonl');
  marketServer = createMarketServer({
    token: settings.marketIngestToken,
    storageFile: storagePath
  }).server;

  const address = await listen(marketServer);
  localOrigin = `http://127.0.0.1:${address.port}`;
  return localOrigin;
}

async function stopLocalApi() {
  if (!marketServer?.listening || isClosingServer) return;
  isClosingServer = true;

  const server = marketServer;
  await new Promise(resolve => {
    server.close(() => resolve());
    server.closeAllConnections?.();
  });

  marketServer = null;
  isClosingServer = false;
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 980,
    minWidth: 1040,
    minHeight: 720,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#090b13',
    title: 'GOLD-3Po Market Lab',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url);
      if (target.protocol === 'https:') void shell.openExternal(url);
    } catch {
      // Reject malformed or unsupported external URLs.
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    try {
      if (new URL(targetUrl).origin !== localOrigin) event.preventDefault();
    } catch {
      event.preventDefault();
    }
  });

  mainWindow.once('ready-to-show', () => {
    if (!isSmokeTest) mainWindow?.show();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow.loadURL(localOrigin);
}

async function runSmokeTest() {
  const healthResponse = await fetch(`${localOrigin}/health`, { signal: AbortSignal.timeout(10000) });
  if (!healthResponse.ok) throw new Error(`Health endpoint returned HTTP ${healthResponse.status}.`);

  const health = await healthResponse.json();
  if (health.status !== 'ok' || health.ingestConfigured !== true) {
    throw new Error('The local market API did not report a configured healthy state.');
  }

  const pageResponse = await fetch(localOrigin, { signal: AbortSignal.timeout(10000) });
  if (!pageResponse.ok) throw new Error(`Application page returned HTTP ${pageResponse.status}.`);

  const html = await pageResponse.text();
  if (!html.includes('priceChart') || !html.includes('market-client.js')) {
    throw new Error('The packaged application HTML is missing required workspace elements.');
  }

  for (const asset of ['/app.js', '/market-client.js', '/research-client.js', '/styles.css']) {
    const response = await fetch(localOrigin + asset, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`Application asset ${asset} returned HTTP ${response.status}.`);
  }

  process.stdout.write('GOLD3PO_ELECTRON_SMOKE_OK\n');
  await stopLocalApi();
  app.exit(0);
}

async function bootstrap() {
  await startLocalApi();

  if (isSmokeTest) {
    await runSmokeTest();
    return;
  }

  await createMainWindow();
}

function handleStartupFailure(error) {
  logError(error);
  if (isSmokeTest) {
    app.exit(1);
    return;
  }

  dialog.showErrorBox(
    'GOLD-3Po Market Lab',
    'The application could not start its local market service. Check the application data folder and restart the app.\n\n' +
      (error instanceof Error ? error.message : String(error))
  );
  app.exit(1);
}

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) {
      if (localOrigin) void createMainWindow().catch(handleStartupFailure);
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(bootstrap).catch(handleStartupFailure);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && localOrigin) {
      void createMainWindow().catch(handleStartupFailure);
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', event => {
    if (!marketServer?.listening || isClosingServer) return;
    event.preventDefault();
    void stopLocalApi().finally(() => app.quit());
  });
}
