import path from 'node:path';
import { existsSync } from 'node:fs';

// The connector is built with PyInstaller --onedir, so its executable lives in a folder of its own inside the
// packaged resources. A --onefile build would put it one level up, so both layouts are honoured: the installed app
// used to look one level too high, which made every connection fail with «модуль MT5 не найден».
export const WORKER_LAYOUTS = [
  ['mt5-runtime', 'gold3po-mt5', 'gold3po-mt5.exe'],
  ['mt5-runtime', 'gold3po-mt5.exe']
];

export function workerPath(resources, exists = existsSync) {
  const found = WORKER_LAYOUTS.map(parts => path.join(resources, ...parts)).find(candidate => exists(candidate));
  return found ?? path.join(resources, ...WORKER_LAYOUTS[0]);
}
