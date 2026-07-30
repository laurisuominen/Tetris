/**
 * The ball: state, serving, and rescaling its speed without touching its angle.
 */

import { BALL_RADIUS, PADDLE_Y, MAX_DEFLECT_RAD } from './constants.js';

export function createBall() {
  return { x: 0, y: 0, vx: 0, vy: 0 };
}

/** Parks the ball on the paddle, waiting for a launch. */
export function attachToPaddle(ball, paddle) {
  ball.x = paddle.x;
  ball.y = PADDLE_Y - BALL_RADIUS;
  ball.vx = 0;
  ball.vy = 0;
}

/**
 * Serves the ball upward, angled by where along the paddle it was sitting.
 *
 * Reusing the paddle's own deflection rule means the serve is aimable: nudge
 * the paddle before launching and the ball goes where you pointed it. A fixed
 * serve angle makes the first bounce of every life identical, which is both
 * duller and, on a symmetric wall, genuinely repetitive.
 *
 * `offset` is -1..1, the same convention as paddle.deflect.
 */
export function launch(ball, speed, offset = 0) {
  const clamped = Math.min(Math.max(offset, -1), 1);
  // Half deflection on the serve: a full-tilt 30-degree launch skims the wall
  // and takes an age to reach the bricks.
  const angle = clamped * MAX_DEFLECT_RAD * 0.5;
  ball.vx = speed * Math.sin(angle);
  ball.vy = -speed * Math.cos(angle);
}

/**
 * Rescales velocity to a new speed, preserving direction exactly.
 *
 * This is what keeps the angle invariant true across the classic speed-ups: the
 * components are scaled together, so the trajectory the paddle chose is
 * unchanged. Setting one component and recomputing the other would not be.
 */
export function setSpeed(ball, speed) {
  const current = Math.hypot(ball.vx, ball.vy);
  if (current === 0) return;
  const scale = speed / current;
  ball.vx *= scale;
  ball.vy *= scale;
}

export const ballSpeed = (ball) => Math.hypot(ball.vx, ball.vy);
