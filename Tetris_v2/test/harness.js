/**
 * A zero-dependency test harness.
 *
 * Deliberately tiny. It runs unchanged in a browser (test/index.html) and under
 * Node (test/run-node.mjs), because the modules it exercises are pure and the
 * project has no build step to hang a real test runner off.
 */

const suites = [];
let current = null;

export function describe(name, fn) {
  current = { name, tests: [] };
  suites.push(current);
  fn();
  current = null;
}

export function it(name, fn) {
  if (!current) throw new Error('it() called outside describe()');
  current.tests.push({ name, fn });
}

/* --- assertions ----------------------------------------------------------- */

class AssertionError extends Error {}

function fail(message) {
  throw new AssertionError(message);
}

function stringify(value) {
  if (value instanceof Uint8Array) return `Uint8Array(${value.length})`;
  if (typeof value === 'object' && value !== null) {
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return String(value);
}

export function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;

  if (a instanceof Uint8Array && b instanceof Uint8Array) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (typeof a !== 'object') return false;

  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual(a[k], b[k]));
}

export function expect(actual) {
  return {
    toBe(expected) {
      if (!Object.is(actual, expected)) {
        fail(`expected ${stringify(expected)}, got ${stringify(actual)}`);
      }
    },
    toEqual(expected) {
      if (!deepEqual(actual, expected)) {
        fail(`expected ${stringify(expected)}, got ${stringify(actual)}`);
      }
    },
    toBeTruthy() {
      if (!actual) fail(`expected truthy, got ${stringify(actual)}`);
    },
    toBeFalsy() {
      if (actual) fail(`expected falsy, got ${stringify(actual)}`);
    },
    toBeNull() {
      if (actual !== null) fail(`expected null, got ${stringify(actual)}`);
    },
    toBeCloseTo(expected, tolerance = 1e-6) {
      if (Math.abs(actual - expected) > tolerance) {
        fail(`expected ${expected} +/- ${tolerance}, got ${actual}`);
      }
    },
    toBeLessThan(limit) {
      if (!(actual < limit)) fail(`expected < ${limit}, got ${actual}`);
    },
    toBeGreaterThan(limit) {
      if (!(actual > limit)) fail(`expected > ${limit}, got ${actual}`);
    },
    toThrow() {
      let threw = false;
      try { actual(); } catch { threw = true; }
      if (!threw) fail('expected function to throw');
    }
  };
}

/* --- runner --------------------------------------------------------------- */

export function run({ onResult } = {}) {
  let passed = 0;
  const failures = [];

  for (const suite of suites) {
    for (const test of suite.tests) {
      const label = `${suite.name} > ${test.name}`;
      try {
        test.fn();
        passed++;
        onResult?.({ label, ok: true });
      } catch (error) {
        failures.push({ label, error });
        onResult?.({ label, ok: false, error });
      }
    }
  }

  return { passed, failures, total: passed + failures.length };
}
