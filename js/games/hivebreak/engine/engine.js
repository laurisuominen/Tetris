/**
 * The impure orchestrator.
 *
 * Owns the mutable GameState, drives the loop, pulls input, and fans core's
 * event descriptions out to whoever subscribed. Everything below is pure,
 * everything above reacts to events.
 *
 * The injected `input` exposes four things — `consumeQueue()`, `axis`,
 * `pointer` and `firing` — read at the step boundary and passed straight
 * through. Composing them from the keyboard, the on-screen buttons and a drag
 * is main.js's job; this just reads them.
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
    const { events } = step(state, dt, {
      actions,
      axis: input ? input.axis : 0,
      pointer: input ? input.pointer : null,
      firing: input ? input.firing : false
    });
    dispatchEvents(events);
  }

  const loop = createLoop({
    timestep: TIMESTEP_MS,
    step: tick,
    render: (alpha) => renderFn(state, alpha)
  });

  // Backgrounding auto-pauses rather than letting a huge delta build up and
  // teleport a diver through the ship while nobody is looking.
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

    /** Settings. The difficulty tier takes effect on the next start. */
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
