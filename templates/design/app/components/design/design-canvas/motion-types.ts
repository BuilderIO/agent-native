export interface MotionTrackWire {
  targetNodeId: string;
  property: string;
  keyframes: Array<{ t: number; value: string; ease?: string }>;
  delayMs?: number;
  durationMs?: number;
}
