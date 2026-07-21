/**
 * Tests for the pure parts outside core/: auto-repeat timing and the
 * device-pixel snapping that delivers crisp rendering.
 */

import { describe, it, expect } from './harness.js';
import { createAutoRepeat } from '../js/input/autorepeat.js';
import { fitPlayfield, fitPreview, backingSize, crispOffset } from '../js/render/geometry.js';
import { COLS, VISIBLE_ROWS, TIMESTEP_MS } from '../js/core/constants.js';

describe('DAS and ARR', () => {
  /**
   * Contract: auto-repeat contributes ONLY repeats, never the initial move.
   * The keypress itself is already queued by keyboard.js, so returning a move
   * here on first press would step the piece two cells per tap.
   */
  it('contributes no move on the initial press', () => {
    const repeat = createAutoRepeat({ das: 170, arr: 50 });
    expect(repeat.tick(TIMESTEP_MS, -1)).toBe(0);
  });

  it('stays silent until DAS has charged', () => {
    const repeat = createAutoRepeat({ das: 170, arr: 50 });
    repeat.tick(TIMESTEP_MS, 1);           // initial move

    let elapsed = 0;
    let moves = 0;
    while (elapsed < 160) {
      moves += repeat.tick(TIMESTEP_MS, 1);
      elapsed += TIMESTEP_MS;
    }
    expect(moves).toBe(0);
  });

  it('repeats at the ARR rate once charged', () => {
    const repeat = createAutoRepeat({ das: 170, arr: 50 });
    repeat.tick(TIMESTEP_MS, 1);

    let elapsed = 0;
    let moves = 0;
    // 170ms DAS then 500ms of repeats at 50ms is about 10 moves.
    while (elapsed < 670) {
      moves += repeat.tick(TIMESTEP_MS, 1);
      elapsed += TIMESTEP_MS;
    }
    expect(moves).toBeGreaterThan(8);
    expect(moves).toBeLessThan(13);
  });

  it('returns more than one move when ARR is shorter than a timestep', () => {
    const repeat = createAutoRepeat({ das: 0, arr: 5 });
    repeat.tick(TIMESTEP_MS, 1);
    let sawMultiple = false;
    for (let i = 0; i < 10; i++) {
      if (Math.abs(repeat.tick(TIMESTEP_MS, 1)) > 1) sawMultiple = true;
    }
    expect(sawMultiple).toBeTruthy();
  });

  it('discards the old charge on a direction change', () => {
    const repeat = createAutoRepeat({ das: 170, arr: 50 });
    for (let i = 0; i < 20; i++) repeat.tick(TIMESTEP_MS, -1);   // fully charged left

    // Switching must not inherit the left charge and burst rightward.
    expect(repeat.tick(TIMESTEP_MS, 1)).toBe(0);
    expect(repeat.tick(TIMESTEP_MS, 1)).toBe(0);

    // It has to serve a full DAS again before repeating.
    let elapsed = 0;
    let moves = 0;
    while (elapsed < 150) {
      moves += repeat.tick(TIMESTEP_MS, 1);
      elapsed += TIMESTEP_MS;
    }
    expect(moves).toBe(0);
  });

  it('discharges on release so the next press starts fresh', () => {
    const repeat = createAutoRepeat({ das: 170, arr: 50 });
    for (let i = 0; i < 20; i++) repeat.tick(TIMESTEP_MS, 1);    // fully charged
    expect(repeat.tick(TIMESTEP_MS, 0)).toBe(0);

    // Re-pressing must serve DAS again rather than repeating immediately.
    let elapsed = 0;
    let moves = 0;
    while (elapsed < 150) {
      moves += repeat.tick(TIMESTEP_MS, 1);
      elapsed += TIMESTEP_MS;
    }
    expect(moves).toBe(0);
  });

  it('treats both directions held as neither', () => {
    const repeat = createAutoRepeat();
    expect(repeat.tick(TIMESTEP_MS, 0)).toBe(0);
  });
});

describe('canvas geometry', () => {
  it('snaps the cell size to whole device pixels', () => {
    // Fractional ratios are the risky case: Windows scaling at 125% and 150%
    // gives 1.25 and 1.5, where an unsnapped cell leaves seams between blocks.
    for (const dpr of [1, 1.25, 1.5, 1.75, 2, 3]) {
      const { cell } = fitPlayfield(437, 913, dpr);
      const devicePixels = cell * dpr;
      expect(Math.abs(devicePixels - Math.round(devicePixels))).toBeLessThan(1e-9);
    }
  });

  it('fits inside the available box', () => {
    for (const dpr of [1, 1.5, 2]) {
      const fit = fitPlayfield(400, 700, dpr);
      expect(fit.width).toBeLessThan(400.001);
      expect(fit.height).toBeLessThan(700.001);
    }
  });

  it('keeps the ten by twenty aspect ratio', () => {
    const fit = fitPlayfield(1000, 1000, 1);
    expect(fit.width / COLS).toBeCloseTo(fit.height / VISIBLE_ROWS, 1e-9);
  });

  it('never returns a zero or negative cell size', () => {
    expect(fitPlayfield(1, 1, 1).cell).toBeGreaterThan(0);
    expect(fitPlayfield(0, 0, 2).cell).toBeGreaterThan(0);
    expect(fitPreview(0, 0, 4, 2, 1)).toBeGreaterThan(0);
  });

  it('rounds the backing store to whole pixels', () => {
    const { width, height } = backingSize(300.4, 600.6, 1.5);
    expect(Number.isInteger(width)).toBeTruthy();
    expect(Number.isInteger(height)).toBeTruthy();
  });

  it('offsets strokes by half a device pixel', () => {
    expect(crispOffset(1)).toBe(0.5);
    expect(crispOffset(2)).toBe(0.25);
  });
});
