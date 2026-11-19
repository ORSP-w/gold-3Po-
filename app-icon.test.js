import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));
const mainSource = await readFile(new URL('./electron/main.js', import.meta.url), 'utf8');
const iconBytes = await readFile(new URL('./assets/gold3po-icon.ico', import.meta.url));

test('C-3PO icon is configured for the app, installer and uninstaller', () => {
  assert.equal(pkg.build.win.icon, 'assets/gold3po-icon.ico');
  assert.equal(pkg.build.nsis.installerIcon, 'assets/gold3po-icon.ico');
  assert.equal(pkg.build.nsis.uninstallerIcon, 'assets/gold3po-icon.ico');
  assert.equal(pkg.build.nsis.installerHeaderIcon, 'assets/gold3po-icon.ico');
});

test('reinstall refreshes the desktop shortcut and packages the icon for Electron', () => {
  assert.equal(pkg.build.nsis.createDesktopShortcut, 'always');
  assert.ok(pkg.build.extraResources.some(item => item.from === 'assets/gold3po-icon.ico' && item.to === 'gold3po-icon.ico'));
  assert.match(mainSource, /nativeImage\.createFromPath\(appIconPath\)/);
  assert.match(mainSource, /icon: appIconPath/);
});

test('C-3PO icon is a valid multi-size Windows ICO', () => {
  assert.equal(iconBytes.readUInt16LE(0), 0);
  assert.equal(iconBytes.readUInt16LE(2), 1);
  assert.ok(iconBytes.readUInt16LE(4) >= 3);
});

test('C-3PO head is the startup splash and ships with the app', async () => {
  const splash = await readFile(new URL('./electron/splash.html', import.meta.url), 'utf8');
  const head = await readFile(new URL('./c3po.png', import.meta.url));
  assert.match(splash, /src="\.\.\/c3po\.png"/);
  assert.equal(head.subarray(1, 4).toString(), 'PNG');
  assert.ok(pkg.build.files.includes('c3po.png'));
  assert.match(mainSource, /splash\.html/);
  assert.match(mainSource, /closeSplash\(splashStartedAt\)/);
});
