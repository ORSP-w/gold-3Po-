import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';

const pkg = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));
const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
const files = pkg.build.files;

async function localImports(file, seen = new Set()) {
  if (seen.has(file)) return seen;
  seen.add(file);
  const src = await readFile(new URL('./' + file, import.meta.url), 'utf8');
  for (const m of src.matchAll(/(?:import|export)\s[^'"]*?from\s+['"]\.\/([^'"]+)['"]/g)) await localImports(m[1], seen);
  return seen;
}

test('every module the installed app loads is packaged', async () => {
  const needed = new Set([...await localImports('server.js')]);
  for (const m of html.matchAll(/<script[^>]+src="\.\/([^"]+)"/g)) for (const f of await localImports(m[1])) needed.add(f);
  for (const f of needed) assert.ok(files.includes(f), `${f} is loaded but missing from build.files`);
});

test('every page asset is served by the local server and packaged', async () => {
  const server = await readFile(new URL('./server.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('./styles.css', import.meta.url), 'utf8');
  const assets = [...html.matchAll(/(?:src|href)="\.\/([^"#?]+)"/g)].map(m => m[1])
    .concat([...css.matchAll(/url\(["']?\.\/([^"')]+)["']?\)/g)].map(m => m[1]));
  for (const a of new Set(assets)) {
    await access(new URL('./' + a, import.meta.url));
    assert.ok(server.includes(`'/${a}'`), `${a} is referenced by the page but not served`);
    assert.ok(files.includes(a), `${a} is referenced by the page but not packaged`);
  }
});

test('the desktop app stores zone/MT5 settings in userData, apart from its own settings.json', async () => {
  const main = await readFile(new URL('./electron/main.js', import.meta.url), 'utf8');
  assert.match(main, /createSettingsStore\(\{ file: path\.join\(userDataPath, 'zone-settings\.json'\) \}\)/);
  assert.match(main, /createMarketServer\(\{[\s\S]*settingsStore[\s\S]*\}\)/);
});
