/**
 * Node entry point for the core test suite.
 *
 *   node test/run-node.mjs
 *
 * The .mjs extension means ESM works with no package.json and no install, which
 * is the point — core/ imports nothing but itself and uses no browser globals,
 * so the same test files run here and in test/index.html.
 */

import { run } from './harness.js';
import './core.test.js';

const GREEN = '[32m';
const RED = '[31m';
const DIM = '[2m';
const RESET = '[0m';

const { passed, failures, total } = run({
  onResult: ({ label, ok, error }) => {
    if (ok) console.log(`${GREEN}pass${RESET} ${DIM}${label}${RESET}`);
    else console.log(`${RED}FAIL${RESET} ${label}\n     ${error.message}`);
  }
});

console.log(`\n${passed}/${total} passing`);

if (failures.length > 0) {
  console.log(`${RED}${failures.length} failing${RESET}`);
  process.exit(1);
}
