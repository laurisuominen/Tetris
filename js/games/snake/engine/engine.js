/**
 * The impure orchestrator.
 *
 * Owns the mutable GameState, drives the loop, pulls input, and fans core's
 * event descriptions out to whoever subscribed. Everything below is pure,
 * everything above reacts to events.
 *
 * Thinner than Tetris's engine in one respect: there is no auto-repeat. Holding
 * a direction should not queue a stream of turns — a turn is a discrete
 * decision, and repeating it would flood the two-slot buffer with duplicates
 * that the "same as last queued" guard has to keep throwing away.
 */

import { createGame, step, applyAction, configure, ACTIONS } from '../core/game.js';
import { STATES, EVENTS, transition } from '../core/fsm.js';
import { TIMESTEP_MS } from '../core/constants.js';
import { createLoop } from '../../../shared/engine/loop.js';
import { createEmitter } from '../../../shared/util/emitter.js';
import { on } from '../../../shared/util/dom.js';

export function createEngine({ input, speed, wrap } = {}) {
  const emitter = createEmitter();

  let state = createGame({ seed: randomSeed(), speed, wrap });
  let renderFn = () => {};

  function randomSeed() {
    // Seeding is impure by nature, which is exactly why it lives out here and
    // not in core. Every restart draws a fresh one, so a replayed run does not
    // hand the player the same apples in the same order.
    return (Math.random() * 2 ** 31) >>> 0;
  }

  function dispatchEvents(events) {
    for (const event of events) emitter.emit(event.type, { ...event, state });
    if (events.length) emitter.emit('changed', state);
  }

  function tick(dt) {
    const actions = input ? input.consumeQueue() : [];
    const { events } = step(state, dt, { actions, seed: randomSeed() });
    dispatchEvents(events);
  }

  const loop = createLoop({
    timestep: TIMESTEP_MS,
    step: tick,
    render: (alpha) => renderFn(state, alpha)
  });

  // Backgrounding the tab auto-pauses rather than letting a huge delta build up
  // and teleport the snake into a wall while nobody is looking.
  const offVisibility = on(document, 'visibilitychange', () => {
    if (document.hidden && state.fsm === STATES.PLAYING) {
      state.fsm = transition(state.fsm, EVENTS.BLUR);
      emitter.emit('pause', { paused: true, state });
      emitter.emit('changed', state);
    }
  });

  return {
    on: emitter.on,
    emit: emitter.emit,

    getState: () => state,

    setRenderer(fn) { renderFn = fn; },

    /** Applies an action immediately, outside the step boundary. */
    dispatch(action) {
      const events = [];
      applyAction(state, action, events, randomSeed());
      dispatchEvents(events);
    },

    /** Settings. Speed and wrap take effect on the next start, never mid-run. */
    configure(options) {
      configure(state, options);
      emitter.emit('changed', state);
    },

    start() { loop.start(); },
    stop() { loop.stop(); },

    destroy() {
      loop.stop();
      offVisibility();
      emitter.clear();
    }
  };
}

export { ACTIONS };
