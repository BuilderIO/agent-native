import { OCEAN_TUNING } from "./tuning";

// Per-frame approach fractions at the 30fps draw budget, matching the halftone
// fallback so the two backgrounds share one feel. Deliberately slow: the lag is
// the water's own inertia, and anything fast enough to keep up reads as the
// deformation being pinned to the mouse rather than trailing it.
export const POINTER_POSITION_EASING = 0.12;
export const POINTER_STRENGTH_EASING = 0.08;

/**
 * Where a cursor at these normalized device coordinates meets the water, in
 * world x/z. Undefined when that ray never does: the rig is pitched up, so the
 * upper part of the hero looks at empty sky, and past the particle fade
 * distance the intersection runs off toward the horizon where a world-space
 * radius covers most of the frame.
 *
 * Solved on the CPU rather than in the shader because the camera is a pitch
 * rotation about X plus a translation, so its inverse is closed-form here and
 * would otherwise cost an extra inverse matrix in the uniform.
 */
export function projectPointerToOcean(
  ndcX: number,
  ndcY: number,
  size: readonly [number, number],
): readonly [number, number] | undefined {
  const { eye, target, pitchDegrees, fovDegrees } = OCEAN_TUNING.camera;
  const aspect = size[0] / Math.max(1, size[1]);
  const f = 1 / Math.tan((fovDegrees * Math.PI) / 360);

  // Same angle oceanCamera() builds its view matrix from; they have to agree or
  // the pull lands somewhere other than under the cursor.
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

  if (dirY >= 0) return undefined;
  const t = -eye[1] / dirY;
  if (!Number.isFinite(t) || t <= 0) return undefined;

  const rayLength = Math.hypot(viewX, dirY, dirZ);
  if (t * rayLength > OCEAN_TUNING.particles.fadeFar) return undefined;

  return [eye[0] + viewX * t, eye[2] + dirZ * t];
}
