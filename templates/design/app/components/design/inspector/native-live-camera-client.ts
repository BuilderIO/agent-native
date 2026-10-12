import { findNativeDraftFrame } from "./native-shader-draft-client";

export type NativeCameraClientState =
  | "idle"
  | "starting"
  | "active"
  | "permission-denied"
  | "unavailable"
  | "stopped";

type CameraRuntime = {
  cameraState: () => NativeCameraClientState;
  startCamera: (instanceId: string, port: string) => Promise<void>;
  stopCamera: () => void;
  snapshotCamera: (
    expectedInstanceIds: readonly string[],
  ) => Promise<ImageBitmap>;
  recordCameraClip: (
    expectedInstanceIds: readonly string[],
    durationSeconds: number,
    signal: AbortSignal,
    onProgress?: (elapsedSeconds: number, durationSeconds: number) => void,
  ) => Promise<Blob>;
};

export class NativeCameraClientError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "NativeCameraClientError";
  }
}

function cameraRuntime(fileId: string, boardFile: boolean): CameraRuntime {
  let frame: HTMLIFrameElement;
  try {
    frame = findNativeDraftFrame(fileId, boardFile);
    const target = frame.contentWindow;
    if (
      !target ||
      target.parent !== frame.ownerDocument.defaultView ||
      target.document !== frame.contentDocument
    )
      throw new NativeCameraClientError("camera-frame-unavailable");
    const runtime = (
      target as Window & { __anNativeShaders?: Partial<CameraRuntime> }
    ).__anNativeShaders;
    if (
      !runtime?.cameraState ||
      !runtime.startCamera ||
      !runtime.stopCamera ||
      !runtime.snapshotCamera
    )
      throw new NativeCameraClientError("camera-runtime-unavailable");
    return runtime as CameraRuntime;
  } catch (error) {
    if (error instanceof NativeCameraClientError) throw error;
    throw new NativeCameraClientError("camera-frame-unavailable");
  }
}

export async function recordNativeCameraClip(
  fileId: string,
  boardFile: boolean,
  expectedInstanceIds: readonly string[],
  durationSeconds: number,
  signal: AbortSignal,
  onProgress?: (elapsedSeconds: number, durationSeconds: number) => void,
): Promise<Blob> {
  const runtime = cameraRuntime(fileId, boardFile);
  if (!runtime.recordCameraClip)
    throw new NativeCameraClientError("camera-recording-unavailable");
  return runtime.recordCameraClip(
    expectedInstanceIds,
    durationSeconds,
    signal,
    onProgress,
  );
}

export function readNativeCameraState(
  fileId: string,
  boardFile: boolean,
): NativeCameraClientState {
  return cameraRuntime(fileId, boardFile).cameraState();
}

export async function startNativeCamera(
  fileId: string,
  boardFile: boolean,
  instanceId: string,
  port: string,
): Promise<void> {
  await cameraRuntime(fileId, boardFile).startCamera(instanceId, port);
}

export function stopNativeCamera(fileId: string, boardFile: boolean): void {
  cameraRuntime(fileId, boardFile).stopCamera();
}

export async function snapshotNativeCamera(
  fileId: string,
  boardFile: boolean,
  expectedInstanceIds: readonly string[],
): Promise<ImageBitmap> {
  return cameraRuntime(fileId, boardFile).snapshotCamera(expectedInstanceIds);
}
