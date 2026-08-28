import { OCEAN_TUNING } from "./tuning";

/**
 * Time constants, not per-frame fractions. A fixed fraction per frame makes the
 * lag depend on how fast frames happen to be arriving, which is what turns a
 * hitch into a visible stutter in something tracking the cursor. Short enough to
 * feel attached to the mouse, long enough to keep a little water-like inertia.
 */
export const POINTER_POSITION_TAU_MS = 90;
export const POINTER_STRENGTH_TAU_MS = 140;

/** Fraction of the way to the target after `dtMs`, for a given time constant. */
export function easingAlpha(dtMs: number, tauMs: number): number {
  if (!(dtMs > 0)) return 0;
  return 1 - Math.exp(-dtMs / tauMs);
}

export interface PointerTarget {
  /** Where the influence sits on the water, in world x/z. */
  readonly worldX: number;
  readonly worldZ: number;
  /**
   * Camera distance to that point. The caller scales the deformation by it so
   * the well stays roughly the same size on screen instead of being a blob up
   * close and a pinprick near the horizon.
   */
  readonly distance: number;
}

/**
 * Where a cursor at these normalized device coordinates acts on the water, in
 * world x/z.
 *
 * Always defined, and that is the point. The rig is pitched up, so the ray from
 * the upper part of the hero never meets the water plane at all, and close to
 * the horizon it meets it thousands of units away. Returning nothing for those
 * cases is what made the cursor feel like it only worked over the visible band
 * of particles, and made it snap on and off at the boundary. Instead the ray is
 * clamped to a maximum reach, so a cursor in the sky acts on the far water in
 * the direction it is pointing and the mapping stays continuous everywhere.
 *
 * Solved on the CPU rather than in the shader because the camera is a pitch
 * rotation about X plus a translation, so its inverse is closed-form here and
 * would otherwise cost an extra inverse matrix in the uniform.
 */
export function projectPointerToOcean(
  ndcX: number,
  ndcY: number,
  size: readonly [number, number],
): PointerTarget {
  const { eye, target, pitchDegrees, fovDegrees } = OCEAN_TUNING.camera;
  const aspect = size[0] / Math.max(1, size[1]);
  const f = 1 / Math.tan((fovDegrees * Math.PI) / 360);

  // Same angle oceanCamera() builds its view matrix from; they have to agree or
  // the deformation lands somewhere other than under the cursor.
  const angle =
    Math.atan2(eye[1] - target[1], eye[2] - target[2]) -
    (pitchDegrees * Math.PI) / 180;
  const c = Math.cos(angle);
  const s = Math.sin(angle);

  // View-space ray through the pixel, then rotated into world space by the
  // transpose of that same X rotation.
  const viewX = (ndcX * aspect) / f;
  const viewY = ndcY / f;
  const viewZ = -1;
  const dirY = c * viewY + s * viewZ;
  const dirZ = -s * viewY + c * viewZ;

  const rayLength = Math.hypot(viewX, dirY, dirZ);
  // Particles past this are faded out anyway, so it is also the point beyond
  // which reaching further would buy nothing.
  const maxT = OCEAN_TUNING.particles.fadeFar / rayLength;
  const hitsWater = dirY < 0;
  const t = hitsWater ? Math.min(-eye[1] / dirY, maxT) : maxT;

  return {
    worldX: eye[0] + viewX * t,
    worldZ: eye[2] + dirZ * t,
    distance: t * rayLength,
  };
}
