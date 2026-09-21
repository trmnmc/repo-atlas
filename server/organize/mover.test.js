// @vitest-environment node
/**
 * Repo Atlas — organize/mover: plan from decisions, apply with real
 * fs.rename in a mktemp root, log after success, skip with reasons.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ARCHIVE_SUBDIR, EMPTIES_SUBDIR, LOG_FILE,
  moveLogFile, ensureOutdatedDirs, planMoves, applyMoves,
} from './mover.js';

const NOW = '2026-09-21T12:00:00-05:00';
let root;
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'organize-mover-'));
  fs.mkdirSync(path.join(root, 'a'));
  fs.writeFileSync(path.join(root, 'a', 'file.txt'), 'a\n');
  fs.mkdirSync(path.join(root, 'b'));
  fs.mkdirSync(path.join(root, 'Outdated', 'archived-projects', 'b'), { recursive: true });
  fs.mkdirSync(path.join(root, 'E'));
});
afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('constants and paths', () => {
  it('names the convention', () => {
    expect(ARCHIVE_SUBDIR).toBe('archived-projects');
    expect(EMPTIES_SUBDIR).toBe('empties');
    expect(LOG_FILE).toBe('MOVES.log');
    expect(moveLogFile('/r')).toBe(path.join('/r', 'Outdated', 'MOVES.log'));
  });
  it('ensureOutdatedDirs creates the three folders', async () => {
    const r = fs.mkdtempSync(path.join(os.tmpdir(), 'organize-ensure-'));
    await ensureOutdatedDirs(r);
    expect(fs.statSync(path.join(r, 'Outdated', 'archived-projects')).isDirectory()).toBe(true);
    expect(fs.statSync(path.join(r, 'Outdated', 'empties')).isDirectory()).toBe(true);
    await ensureOutdatedDirs(r); // idempotent
    fs.rmSync(r, { recursive: true, force: true });
  });
});

describe('planMoves', () => {
  it('turns archive decisions into absolute from/to pairs, in order', () => {
    const moves = planMoves([
      { name: 'a', action: 'archive', subdir: 'archived-projects' },
      { name: 'k', action: 'keep' },
      { name: 'E', action: 'archive', subdir: 'empties' },
      { name: 't', action: 'theme', theme: 'games' },
    ], '/r');
    expect(moves).toEqual([
      { name: 'a', from: path.join('/r', 'a'), to: path.join('/r', 'Outdated', 'archived-projects', 'a') },
      { name: 'E', from: path.join('/r', 'E'), to: path.join('/r', 'Outdated', 'empties', 'E') },
    ]);
  });
});

describe('applyMoves', () => {
  it('moves, logs after success, skips with reasons, and keeps going', async () => {
    const logFile = moveLogFile(root);
    const moves = planMoves([
      { name: 'a', action: 'archive', subdir: 'archived-projects' },
      { name: 'b', action: 'archive', subdir: 'archived-projects' }, // destination exists
      { name: 'c', action: 'archive', subdir: 'archived-projects' }, // source vanished
      { name: 'E', action: 'archive', subdir: 'empties' },
    ], root);
    const result = await applyMoves(moves, { nowIso: NOW, logFile });

    expect(result.done.map((m) => m.name)).toEqual(['a', 'E']);
    expect(result.skipped.map((s) => [s.move.name, s.reason])).toEqual([
      ['b', 'destination exists'],
      ['c', 'source vanished'],
    ]);
    expect(fs.existsSync(path.join(root, 'a'))).toBe(false);
    expect(fs.readFileSync(path.join(root, 'Outdated', 'archived-projects', 'a', 'file.txt'), 'utf8')).toBe('a\n');
    expect(fs.existsSync(path.join(root, 'b'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'Outdated', 'empties', 'E'))).toBe(true);

    const log = fs.readFileSync(logFile, 'utf8').trimEnd().split('\n');
    expect(log).toEqual([
      `${NOW}\t${path.join(root, 'a')}\t${path.join(root, 'Outdated', 'archived-projects', 'a')}`,
      `${NOW}\t${path.join(root, 'E')}\t${path.join(root, 'Outdated', 'empties', 'E')}`,
    ]);
  });
  it('reports a cross-volume rename as different volume and writes no log line', async () => {
    const r = fs.mkdtempSync(path.join(os.tmpdir(), 'organize-xdev-'));
    fs.mkdirSync(path.join(r, 'x'));
    const rename = async () => { const e = new Error('EXDEV'); e.code = 'EXDEV'; throw e; };
    const result = await applyMoves(planMoves([{ name: 'x', action: 'archive', subdir: 'archived-projects' }], r), { nowIso: NOW, logFile: moveLogFile(r), rename });
    expect(result.done).toEqual([]);
    expect(result.skipped[0].reason).toBe('different volume');
    expect(fs.existsSync(moveLogFile(r))).toBe(false);
    fs.rmSync(r, { recursive: true, force: true });
  });
  it('does nothing with an empty plan', async () => {
    const result = await applyMoves([], { nowIso: NOW, logFile: moveLogFile(root) });
    expect(result).toEqual({ done: [], skipped: [] });
  });
});
