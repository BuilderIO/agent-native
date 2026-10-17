let wheelCameraGestureActive = false;

export function isWheelCameraGestureActive(): boolean {
  return wheelCameraGestureActive;
}

export function setWheelCameraGestureActive(active: boolean): void {
  wheelCameraGestureActive = active;
}
