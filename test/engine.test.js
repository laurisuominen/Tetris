/**
 * Tests for the shared fixed-timestep loop.
 *
 * createLoop used to import TIMESTEP_MS from Tetris constants; it now takes the
 * timestep as an argument so other games can drive it at their own rate. That
 * made the tick rate a caller's responsibility, and a wrong one is not a
 * visible failure — the game just runs at the wrong speed — so it is asserted
 * here rather than left to manual play.
 *
 * The loop is DOM-free once given a fake clock, so this runs under Node.
 */

import { describe, it, expect } from './harness.js';
import { createLoop } from '../js/shared/engine/loop.js';
import { createFakeClock } from '../js/shared/engine/clock.js';

/** Runs a loop for `ms` of fake time and reports the deltas it stepped with. */
function stepsOver(timestep, ms) {
  const clock = createFakeClock(0);
  const steps = [];
  const loop = createLoop({
    clock,
    timestep,
    step: (dt) => steps.push(dt),
    render: () => {}
  });
  loop.start();
  clock.advance(ms);
  return steps;
}

describe('fixed-timestep loop', () => {
  it('advances in whole increments of the timestep it was given', () => {
    const steps = stepsOver(20, 100);
    expect(steps.length).toBe(5);
    expect(steps.every((dt) => dt === 20)).toBeTruthy();
  });

  /**
   * The regression this file exists for: a hardcoded 1000/60 would step 6 times
   * here instead of 2, and nothing on screen would say so.
   */
  it('honours a timestep other than 60Hz', () => {
    // Both stay under MAX_STEPS_PER_FRAME so the spiral cap is not in play.
    expect(stepsOver(50, 100).length).toBe(2);
    expect(stepsOver(15, 90).length).toBe(6);
  });

  it('carries the remainder into the next frame rather than dropping it', () => {
    const clock = createFakeClock(0);
    const steps = [];
    const loop = createLoop({
      clock, timestep: 20, step: () => steps.push(1), render: () => {}
    });
    loop.start();
    clock.advance(30);            // one step, 10ms left over
    expect(steps.length).toBe(1);
    clock.advance(10);            // the leftover completes a second step
    expect(steps.length).toBe(2);
  });

  /**
   * Spiral-of-death guard. A frame that wants more than MAX_STEPS_PER_FRAME
   * sub-steps discards the surplus instead of queueing ever more work.
   */
  it('caps sub-steps per frame and discards the surplus', () => {
    // 250ms is the delta clamp; at 20ms that is 12.5 steps, capped to 8.
    const steps = stepsOver(20, 400);
    expect(steps.length).toBe(8);
  });

  it('stops stepping once stopped', () => {
    const clock = createFakeClock(0);
    const steps = [];
    const loop = createLoop({
      clock, timestep: 20, step: () => steps.push(1), render: () => {}
    });
    loop.start();
    clock.advance(100);
    const before = steps.length;
    loop.stop();
    clock.advance(100);
    expect(steps.length).toBe(before);
  });

  it('refuses to run without a timestep rather than guessing one', () => {
    let threw = false;
    try {
      createLoop({ step: () => {}, render: () => {} });
    } catch {
      threw = true;
    }
    expect(threw).toBeTruthy();
  });
});
