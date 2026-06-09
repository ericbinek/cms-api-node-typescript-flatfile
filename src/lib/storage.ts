import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

const DATA_DIR = resolve(process.env.DATA_DIR || './data');

let writeLock: Promise<unknown> = Promise.resolve();

export function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeLock.then(fn, fn);
  writeLock = next.catch(() => {});
  return next;
}

function resolveDataFile(file: string): string {
  return resolve(DATA_DIR, file);
}

export async function readCollection<T = Record<string, unknown>>(file: string): Promise<T[]> {
  const path = resolveDataFile(file);
  try {
    const content = await readFile(path, 'utf-8');
    return JSON.parse(content) as T[];
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return [];
    if (error instanceof SyntaxError) {
      throw new Error(`Data file corrupted: ${path}`);
    }
    throw new Error(`Cannot read data file: ${path} (${code})`);
  }
}

export async function writeCollection(file: string, items: unknown[]): Promise<void> {
  const path = resolveDataFile(file);
  await mkdir(dirname(path), { recursive: true });
  // Write to a temp file and rename — rename is atomic on the same filesystem,
  // so a crash mid-write cannot leave a partially written collection behind.
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(items, null, 2), 'utf-8');
  await rename(tmp, path);
}
