import { OCEAN_TUNING } from "./tuning";

/** Exact fixed cinematic camera from the original ocean. */
export function oceanCamera(size: readonly [number, number]) {
  const { eye, target, pitchDegrees, fovDegrees, near, far } =
    OCEAN_TUNING.camera;
  const angle =
    Math.atan2(eye[1] - target[1], eye[2] - target[2]) -
    (pitchDegrees * Math.PI) / 180;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const f = 1 / Math.tan((fovDegrees * Math.PI) / 360);

  const view = new Float32Array(16);
  view[0] = view[15] = 1;
  view[5] = view[10] = c;
  view[6] = s;
  view[9] = -s;
  view[13] = -(c * eye[1] - s * eye[2]);
  view[14] = -(s * eye[1] + c * eye[2]);

  const projection = new Float32Array(16);
  projection[0] = f / (size[0] / Math.max(1, size[1]));
  projection[5] = f;
  projection[10] = far / (near - far);
  projection[11] = -1;
  projection[14] = (far * near) / (near - far);
  return { view, projection };
}
