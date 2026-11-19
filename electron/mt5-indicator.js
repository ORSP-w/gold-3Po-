import { execFile } from 'node:child_process';
import { copyFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
export async function installIndicator({ source, terminalPath, terminalDataPath }) {
  const dir = path.join(terminalDataPath, 'MQL5', 'Indicators');
  const target = path.join(dir, 'Gold3PoLevels.mq5');
  const binary = path.join(dir, 'Gold3PoLevels.ex5');
  await mkdir(dir, { recursive: true });
  await copyFile(source, target);
  const before = await stat(binary).catch(() => null);
  const compiler = path.join(path.dirname(terminalPath), 'metaeditor64.exe');
  if ((await stat(compiler).catch(() => null))?.isFile()) {
    try { await execute(compiler, [`/compile:${target}`], { windowsHide: true, timeout: 30_000 }); } catch { /* MetaEditor need not return a conventional exit code. */ }
    const after = await stat(binary).catch(() => null);
    if (after?.size && (!before || before.mtimeMs !== after.mtimeMs)) {
      return 'Индикатор скомпилирован. В MT5 обновите «Навигатор → Индикаторы» и перетащите Gold3PoLevels на график золота.';
    }
  }
  return 'Исходник индикатора скопирован. В MetaEditor откройте Gold3PoLevels.mq5 из MQL5 → Indicators, нажмите F7 и добавьте его на график в MT5.';
}
