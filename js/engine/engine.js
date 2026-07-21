/**
 * The impure orchestrator.
 *
 * Owns the mutable current GameState, drives the loop, pulls input, and fans
 * core's event descriptions out to whoever subscribed. This is the boundary:
 * everything below is pure, everything above reacts to events.
 */

import { createGame, step, applyAction, ACTIONS, nextPieces } from '../core/game.js';
import { STATES, EVENTS, transition } from '../core/fsm.js';
import { createLoop } from './loop.js';
import { createAutoRepeat } from '../input/autorepeat.js';
import { createEmitter } from '../util/emitter.js';
import { on } from '../util/dom.js';

export function createEngine({ input, startLevel = 1 } = {}) {
  const emitter = createEmitter();
  const autoRepeat = createAutoRepeat();

  let state = createGame({ seed: randomSeed(), startLevel });
  let renderFn = () => {};

  function randomSeed() {
    // Seeding is impure by nature, which is exactly why it lives out here and
    // not in core.
    return (Math.random() * 2 ** 31) >>> 0;
  }

  function dispatchEvents(events) {
    for (const event of events) emitter.emit(event.type, { ...event, state });
    if (events.length) emitter.emit('changed', state);
  }

  function tick(dt) {
    const actions = input ? input.consumeQueue() : [];

    // Auto-repeat produces extra horizontal moves, applied through the same
    // path as a tap so lock-delay accounting is identical either way.
    if (input && state.fsm === STATES.PLAYING) {
      const repeats = autoRepeat.tick(dt, input.horizontal);
      const action = repeats < 0 ? ACTIONS.MOVE_LEFT : ACTIONS.MOVE_RIGHT;
      for (let i = 0; i < Math.min(Math.abs(repeats), 10); i++) actions.push(action);
    }

    const { events } = step(state, dt, {
      actions,
      softDrop: Boolean(input?.softDrop),
      seed: randomSeed()
    });
    dispatchEvents(events);
  }

  const loop = createLoop({
    step: tick,
    render: (alpha) => renderFn(state, alpha)
  });

  // Backgrounding the tab auto-pauses rather than letting a huge delta build up.
  const offVisibility = on(document, 'visibilitychange', () => {
    if (document.hidden && state.fsm === STATES.PLAYING) {
      state.fsm = transition(state.fsm, EVENTS.BLUR);
      autoRepeat.reset();
      emitter.emit('pause', { paused: true, state });
      emitter.emit('changed', state);
    }
  });

  return {
    on: emitter.on,
    emit: emitter.emit,

    getState: () => state,
    getNextPieces: () => nextPieces(state),

    setRenderer(fn) { renderFn = fn; },

    /** Applies an action immediately, outside the step boundary. */
    dispatch(action) {
      const events = [];
      applyAction(state, action, events, randomSeed());
      autoRepeat.reset();
      dispatchEvents(events);
    },

    setStartLevel(level) {
      state.startLevel = level;
      if (state.fsm === STATES.MENU) state.level = level;
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
