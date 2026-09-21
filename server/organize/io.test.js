// @vitest-environment node
/**
 * Repo Atlas — organize/io helpers: read-or-null, atomic write, append.
 * Real mktemp directory, removed in afterAll. Never touches ~/Projects.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readTextOrNull, readTextOrMissing, writeTextAtomic, appendLine } from './io.js';

let root;
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'organize-io-'));
});
afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('readTextOrNull', () => {
  it('returns the file text', async () => {
    const f = path.join(root, 'a.txt');
    fs.writeFileSync(f, 'hello\n');
    expect(await readTextOrNull(f)).toBe('hello\n');
  });
  it('returns null for a missing file', async () => {
    expect(await readTextOrNull(path.join(root, 'nope.txt'))).toBeNull();
  });
  it('returns null for a directory', async () => {
    expect(await readTextOrNull(root)).toBeNull();
  });
});

describe('readTextOrMissing', () => {
  it('returns null for a missing file', async () => {
    expect(await readTextOrMissing(path.join(root, 'nope-missing.txt'))).toBeNull();
  });
  it('returns the file text for a readable file', async () => {
    const f = path.join(root, 'missing-a.txt');
    fs.writeFileSync(f, 'hello\n');
    expect(await readTextOrMissing(f)).toBe('hello\n');
  });
  it('rejects for a directory (EISDIR), not treating it as missing', async () => {
    await expect(readTextOrMissing(root)).rejects.toMatchObject({ code: 'EISDIR' });
  });
});

describe('writeTextAtomic', () => {
  it('creates parent directories and writes the text', async () => {
    const f = path.join(root, 'deep', 'er', 'b.md');
    await writeTextAtomic(f, '# B\n');
    expect(fs.readFileSync(f, 'utf8')).toBe('# B\n');
  });
  it('overwrites an existing file', async () => {
    const f = path.join(root, 'c.md');
    await writeTextAtomic(f, 'one\n');
    await writeTextAtomic(f, 'two\n');
    expect(fs.readFileSync(f, 'utf8')).toBe('two\n');
  });
  it('leaves no temp file behind', async () => {
    const dir = path.join(root, 'clean');
    await writeTextAtomic(path.join(dir, 'd.md'), 'x\n');
    expect(fs.readdirSync(dir)).toEqual(['d.md']);
  });
});

describe('appendLine', () => {
  it('creates the file and appends lines with newlines', async () => {
    const f = path.join(root, 'logs', 'moves.log');
    await appendLine(f, 'first');
    await appendLine(f, 'second');
    expect(fs.readFileSync(f, 'utf8')).toBe('first\nsecond\n');
  });
});
