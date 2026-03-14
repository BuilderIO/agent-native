/**
 * Spring animation utilities for bouncy, natural-feeling animations
 * Similar to iMessage bubble animations
 */

/**
 * Spring animation with overshoot and bounce
 * @param progress - Linear progress from 0 to 1
 * @param stiffness - How "stiff" the spring is (higher = faster bounce)
 * @param damping - How much the spring dampens (higher = less bounce)
 * @returns Animated value from 0 to 1 with spring physics
 */
export function spring(
  progress: number,
  stiffness = 300,
  damping = 25,
): number {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;

  // Simulate spring physics
  const mass = 1;
  const angularFreq = Math.sqrt(stiffness / mass);
  const dampingRatio = damping / (2 * Math.sqrt(stiffness * mass));

  if (dampingRatio < 1) {
    // Underdamped (bouncy)
    const dampedFreq = angularFreq * Math.sqrt(1 - dampingRatio * dampingRatio);
    const envelope = Math.exp(-dampingRatio * angularFreq * progress);
    const phase = Math.atan(
      dampingRatio / Math.sqrt(1 - dampingRatio * dampingRatio),
    );

    return (
      1 - (envelope * Math.cos(dampedFreq * progress - phase)) / Math.cos(phase)
    );
  } else if (dampingRatio === 1) {
    // Critically damped
    const envelope = Math.exp(-angularFreq * progress);
    return 1 - envelope * (1 + angularFreq * progress);
  } else {
    // Overdamped (no bounce)
    const r1 =
      -angularFreq *
      (dampingRatio + Math.sqrt(dampingRatio * dampingRatio - 1));
    const r2 =
      -angularFreq *
      (dampingRatio - Math.sqrt(dampingRatio * dampingRatio - 1));
    const c2 = -1 / (r2 - r1);
    const c1 = 1 - c2;

    return 1 - (c1 * Math.exp(r1 * progress) + c2 * Math.exp(r2 * progress));
  }
}

/**
 * iMessage-style bubble spring
 * Quick bounce with nice overshoot
 */
export function iMessageSpring(progress: number): number {
  return spring(progress, 400, 22);
}

/**
 * Gentle spring with subtle bounce
 */
export function gentleSpring(progress: number): number {
  return spring(progress, 200, 20);
}

/**
 * Energetic spring with pronounced bounce
 */
export function energeticSpring(progress: number): number {
  return spring(progress, 500, 18);
}
