import { randomBytes } from "node:crypto";

import type { ComputerPermissionStatus } from "./types";

interface Thumbnail {
  isEmpty(): boolean;
  getSize(): { width: number; height: number };
  toPNG(): Buffer;
}

interface CaptureSource {
  id: string;
  name: string;
  thumbnail: Thumbnail;
}

interface DesktopCapturerLike {
  getSources(options: {
    types: Array<"screen" | "window">;
    thumbnailSize: { width: number; height: number };
    fetchWindowIcons: boolean;
  }): Promise<CaptureSource[]>;
}

export interface EphemeralFrameDescriptor {
  handle: string;
  taskId: string;
  width: number;
  height: number;
  byteLength: number;
  expiresAt: number;
}

interface StoredFrame extends EphemeralFrameDescriptor {
  bytes: Buffer;
}

export interface ScreenObserverOptions {
  desktopCapturer: DesktopCapturerLike;
  permissionStatus: () => ComputerPermissionStatus;
  now?: () => number;
  handle?: () => string;
  ttlMs?: number;
  maxBytes?: number;
  maxDimension?: number;
}

/**
 * Captures bounded PNG frames into process memory. Handles are task-scoped and
 * short-lived; frame bytes are never returned in audit metadata or persisted.
 */
export class EphemeralScreenObserver {
  private readonly frames = new Map<string, StoredFrame>();
  private readonly now: () => number;
  private readonly makeHandle: () => string;
  private readonly ttlMs: number;
  private readonly maxBytes: number;
  private readonly maxDimension: number;

  constructor(private readonly options: ScreenObserverOptions) {
    this.now = options.now ?? Date.now;
    this.makeHandle =
      options.handle ?? (() => randomBytes(24).toString("base64url"));
    this.ttlMs = options.ttlMs ?? 30_000;
    this.maxBytes = options.maxBytes ?? 8 * 1024 * 1024;
    this.maxDimension = options.maxDimension ?? 1_920;
  }

  async capture(
    taskId: string,
    requestedSourceId?: string,
  ): Promise<EphemeralFrameDescriptor> {
    this.purgeExpired();
    if (this.options.permissionStatus().screenRecording !== "granted") {
      throw new Error(
        "Screen Recording permission is required to view the desktop. Enable Agent Native in System Settings > Privacy & Security > Screen Recording.",
      );
    }
    const sources = await this.options.desktopCapturer.getSources({
      types: ["screen", "window"],
      thumbnailSize: { width: this.maxDimension, height: this.maxDimension },
      fetchWindowIcons: false,
    });
    const source = requestedSourceId
      ? sources.find((candidate) => candidate.id === requestedSourceId)
      : (sources.find((candidate) => candidate.id.startsWith("screen:")) ??
        sources[0]);
    if (!source || source.thumbnail.isEmpty()) {
      throw new Error("No capturable desktop source is available.");
    }
    const { width, height } = source.thumbnail.getSize();
    if (
      width <= 0 ||
      height <= 0 ||
      width > this.maxDimension ||
      height > this.maxDimension
    ) {
      throw new Error(
        "Captured desktop frame dimensions exceed the safety limit.",
      );
    }
    const bytes = source.thumbnail.toPNG();
    if (bytes.byteLength <= 0 || bytes.byteLength > this.maxBytes) {
      bytes.fill(0);
      throw new Error(
        "Captured desktop frame exceeds the in-memory safety limit.",
      );
    }
    const handle = this.makeHandle();
    const frame: StoredFrame = {
      handle,
      taskId,
      width,
      height,
      byteLength: bytes.byteLength,
      expiresAt: this.now() + this.ttlMs,
      bytes,
    };
    this.frames.set(handle, frame);
    return descriptor(frame);
  }

  take(handle: string, taskId: string): Buffer | undefined {
    this.purgeExpired();
    const frame = this.frames.get(handle);
    if (!frame || frame.taskId !== taskId) return undefined;
    this.frames.delete(handle);
    return frame.bytes;
  }

  clear(taskId?: string): void {
    for (const [handle, frame] of this.frames) {
      if (!taskId || frame.taskId === taskId) {
        frame.bytes.fill(0);
        this.frames.delete(handle);
      }
    }
  }

  private purgeExpired(): void {
    const now = this.now();
    for (const [handle, frame] of this.frames) {
      if (frame.expiresAt <= now) {
        frame.bytes.fill(0);
        this.frames.delete(handle);
      }
    }
  }
}

function descriptor(frame: StoredFrame): EphemeralFrameDescriptor {
  return {
    handle: frame.handle,
    taskId: frame.taskId,
    width: frame.width,
    height: frame.height,
    byteLength: frame.byteLength,
    expiresAt: frame.expiresAt,
  };
}
