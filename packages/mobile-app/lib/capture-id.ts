export function createCaptureId(): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `capture_${Date.now().toString(36)}_${random}`;
}
