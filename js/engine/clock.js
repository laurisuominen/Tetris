/**
 * Time source, behind an interface so the loop can be driven by a fake clock in
 * a test rather than by real wall time.
 */

export const realClock = {
  now: () => performance.now(),
  raf: (fn) => requestAnimationFrame(fn),
  cancel: (id) => cancelAnimationFrame(id)
};

/** Manually advanced clock for tests. */
export function createFakeClock(start = 0) {
  let time = start;
  let queued = [];
  return {
    now: () => time,
    raf: (fn) => { queued.push(fn); return queued.length; },
    cancel: () => { queued = []; },
    advance(ms) {
      time += ms;
      const due = queued;
      queued = [];
      for (const fn of due) fn(time);
    }
  };
}
