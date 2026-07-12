// The editor renders one overview canvas at a time. Keeping the in-flight
// gesture flag outside React lets hover handlers read it without causing a
// render in the first wheel frame.
let wheelCameraGestureActive = false;

export function isWheelCameraGestureActive(): boolean {
  return wheelCameraGestureActive;
}

export function setWheelCameraGestureActive(active: boolean): void {
  wheelCameraGestureActive = active;
}
