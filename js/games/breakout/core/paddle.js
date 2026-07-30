/**
 * The paddle: movement, bounds, and the one formula that sets the ball's angle.
 */

import {
  COLS, PADDLE_Y, PADDLE_H, PADDLE_W, PADDLE_W_SMALL,
  PADDLE_SPEED, PADDLE_ACCEL, MAX_DEFLECT_RAD
} from './constants.js';

export function createPaddle() {
  return { x: COLS / 2, width: PADDLE_W, vx: 0 };
}

export function resetPaddle(paddle) {
  paddle.x = COLS / 2;
  paddle.width = PADDLE_W;
  paddle.vx = 0;
}

/** The classic rule: break through to the ceiling and your paddle halves. */
export function shrinkPaddle(paddle) {
  paddle.width = PADDLE_W_SMALL;
}

const clampX = (x, halfWidth) => Math.min(Math.max(x, halfWidth), COLS - halfWidth);

export const paddleLeft = (paddle) => paddle.x - paddle.width / 2;
export const paddleRight = (paddle) => paddle.x + paddle.width / 2;
export const paddleTop = () => PADDLE_Y;
export const paddleBottom = () => PADDLE_Y + PADDLE_H;

/**
 * Advances the paddle for one step.
 *
 * `pointer` is an absolute target in cell space, or null when the player is on
 * the keyboard. The two are mutually exclusive by construction — the input
 * layer decides which was used last and sends only that one — because blending
 * an absolute target with an accelerating axis produces a paddle that fights
 * whichever hand is not moving.
 *
 * The pointer path deliberately TELEPORTS rather than easing towards the
 * target. Easing feels like lag on a touchscreen, where the player's finger is
 * the paddle. The cost is that the paddle can materialise on top of the ball,
 * which core/game.js has to handle; that is a cheaper problem than sluggish
 * controls.
 *
 * @param {number} dt milliseconds
 * @param {number} axis -1, 0 or +1 from the keyboard
 * @param {number|null} pointer absolute x in cells, or null
 */
export function movePaddle(paddle, dt, axis, pointer) {
  const seconds = dt / 1000;
  const half = paddle.width / 2;

  if (pointer !== null && pointer !== undefined) {
    const next = clampX(pointer, half);
    // Report the implied velocity so the renderer and any future spin logic see
    // a paddle that moved, not one that blinked.
    paddle.vx = seconds > 0 ? (next - paddle.x) / seconds : 0;
    paddle.x = next;
    return;
  }

  const target = axis * PADDLE_SPEED;
  const delta = target - paddle.vx;
  const maxChange = PADDLE_ACCEL * seconds;

  if (Math.abs(delta) <= maxChange) paddle.vx = target;
  else paddle.vx += Math.sign(delta) * maxChange;

  const moved = clampX(paddle.x + paddle.vx * seconds, half);
  // Hitting a side wall kills the momentum rather than storing it up, so the
  // paddle leaves the wall the instant the key reverses.
  if (moved === paddle.x && paddle.vx !== 0) paddle.vx = 0;
  paddle.x = moved;
}

/**
 * Sets the ball's velocity from where it struck the paddle.
 *
 * THE ANGLE INVARIANT. This is the only place in the game that decides a
 * direction. Every other bounce is an axis-aligned reflection, which flips a
 * sign and leaves |vx| and |vy| untouched, and every speed-up scales both
 * components together — so whatever angle is chosen here survives, exactly,
 * until the ball comes back. One clamp, one place, no drift.
 *
 * Position-based deflection rather than mirror reflection is what players
 * expect: hitting the left edge of the paddle should send the ball left. A
 * physically correct bounce off a flat paddle reads as broken.
 *
 * Because the offset is clamped to +/-1 and multiplied by 60 degrees, the
 * steepest possible result is 30 degrees above horizontal. The formula IS the
 * angle clamp; there is no separate clamping step that could be forgotten.
 */
export function deflect(ball, paddle, speed) {
  const half = paddle.width / 2;
  const raw = (ball.x - paddle.x) / half;
  const offset = Math.min(Math.max(raw, -1), 1);
  const angle = offset * MAX_DEFLECT_RAD;

  ball.vx = speed * Math.sin(angle);
  ball.vy = -speed * Math.cos(angle);   // -y is up
}
