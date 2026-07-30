/**
 * The impure orchestrator.
 *
 * Owns the mutable GameState, drives the loop, pulls input, and fans core's
 * event descriptions out to whoever subscribed. Everything below is pure,
 * everything above reacts to events.
 *
 * The one structural difference from Snake's engine: input is not just a queue.
 * A paddle needs a continuous axis and, when the player is using a pointer, an
 * absolute target — so the injected `input` is expected to expose
 * `consumeQueue()`, `axis` and `pointer` (cell space, or null). Composing those
 * three from the keyboard, the on-screen arrows and the pointer is main.js's
 * job; the engine just reads them at the step boundary.
 */

import { createGame, step, applyAction, configure, ACTIONS } from '../core/game.js';
import { STATES, EVENTS, transition } from '../core/fsm.js';
import { TIMESTEP_MS } from '../core/constants.js';
import { createLoop } from '../../../shared/engine/loop.js';
import { createEmitter } from '../../../shared/util/emitter.js';
import { on } from '../../../shared/util/dom.js';

export function createEngine({ input, speed } = {}) {
  const emitter = createEmitter();

  let state = createGame({ speed });
  let renderFn = () => {};

  function dispatchEvents(events) {
    for (const event of events) emitter.emit(event.type, { ...event, state });
    if (events.length) emitter.emit('changed', state);
  }

  function tick(dt) {
    const actions = input ? input.consumeQueue() : [];
    const axis = input ? input.axis : 0;
    const pointer = input ? input.pointer : null;
    const { events } = step(state, dt, { actions, axis, pointer });
    dispatchEvents(events);
  }

  const loop = createLoop({
    timestep: TIMESTEP_MS,
    step: tick,
    render: (alpha) => renderFn(state, alpha)
  });

  // Backgrounding the tab auto-pauses rather than letting a huge delta build up
  // and teleport the ball through the wall while nobody is looking. The loop's
  // own MAX_DELTA clamp limits that, but a paused game is the honest response.
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
      applyAction(state, action, events);
      dispatchEvents(events);
    },

    /** Settings. The speed tier takes effect on the next start, never mid-run. */
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
