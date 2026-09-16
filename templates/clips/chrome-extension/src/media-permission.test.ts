import { beforeEach, describe, expect, it } from "vitest";

import {
  MEDIA_PERMISSION_REQUIRED_CODE,
  MediaPermissionRequiredError,
  hasGrantedDeviceLabels,
  isMediaPermissionDeniedError,
  mediaPermissionErrorFromResponse,
  mediaPermissionRequirements,
  permissionPageUrl,
  readCachedMediaPermission,
  requireMediaPermission,
  writeCachedMediaPermission,
} from "./media-permission";

type StorageArea = Record<string, unknown>;

let storage: StorageArea = {};
let enumerated: (() => Promise<MediaDeviceInfo[]>) | null = null;

function mediaError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

beforeEach(() => {
  storage = {};
  enumerated = null;
  (globalThis as { chrome?: unknown }).chrome = {
    runtime: {
      getURL: (path: string) => `chrome-extension://clips-test/${path}`,
    },
    storage: {
      local: {
        get: (key: string, done: (value: StorageArea) => void) =>
          done(key in storage ? { [key]: storage[key] } : {}),
        set: (value: StorageArea, done: () => void) => {
          Object.assign(storage, value);
          done();
        },
      },
    },
  };
  // `navigator` is a getter-only global under Node, so stub the one member the
  // module reads instead of replacing the object.
  Object.defineProperty(globalThis.navigator, "mediaDevices", {
    configurable: true,
    value: {
      enumerateDevices: () =>
        enumerated ? enumerated() : Promise.resolve([] as MediaDeviceInfo[]),
    },
  });
});

describe("isMediaPermissionDeniedError", () => {
  it("matches the dismissal Chrome reports where it cannot prompt", () => {
    expect(
      isMediaPermissionDeniedError(
        mediaError("NotAllowedError", "Permission dismissed"),
      ),
    ).toBe(true);
    expect(
      isMediaPermissionDeniedError(
        mediaError("NotAllowedError", "Permission denied"),
      ),
    ).toBe(true);
  });

  it("ignores a system-level denial the permission page cannot fix", () => {
    expect(
      isMediaPermissionDeniedError(
        mediaError("NotAllowedError", "Permission denied by system"),
      ),
    ).toBe(false);
  });

  it("ignores missing or busy devices", () => {
    expect(
      isMediaPermissionDeniedError(
        mediaError("NotFoundError", "Requested device not found"),
      ),
    ).toBe(false);
    expect(
      isMediaPermissionDeniedError(
        mediaError("NotReadableError", "Could not start audio source"),
      ),
    ).toBe(false);
  });
});

describe("requireMediaPermission", () => {
  it("types a dismissal as a missing grant for the failing device", async () => {
    const error = await requireMediaPermission("microphone", () =>
      Promise.reject(mediaError("NotAllowedError", "Permission dismissed")),
    ).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(MediaPermissionRequiredError);
    expect((error as MediaPermissionRequiredError).device).toBe("microphone");
  });

  it("passes other capture failures through untouched", async () => {
    const original = mediaError("NotFoundError", "Requested device not found");
    const error = await requireMediaPermission("camera", () =>
      Promise.reject(original),
    ).catch((err: unknown) => err);

    expect(error).toBe(original);
  });
});

describe("mediaPermissionRequirements", () => {
  it("needs the camera for camera capture or a camera bubble", () => {
    expect(
      mediaPermissionRequirements({
        captureSurface: "camera",
        includeCamera: false,
        includeMicrophone: false,
      }),
    ).toEqual({ camera: true, microphone: false });
    expect(
      mediaPermissionRequirements({
        captureSurface: "browser",
        includeCamera: true,
        includeMicrophone: true,
      }),
    ).toEqual({ camera: true, microphone: true });
    expect(
      mediaPermissionRequirements({
        captureSurface: "monitor",
        includeCamera: false,
        includeMicrophone: false,
      }),
    ).toEqual({ camera: false, microphone: false });
  });
});

describe("permissionPageUrl", () => {
  it("asks only for the devices this recording needs", () => {
    const url = new URL(
      permissionPageUrl(
        { camera: false, microphone: true },
        { startAfterGrant: true },
      ),
    );

    expect(url.pathname.endsWith("src/permission.html")).toBe(true);
    expect(url.searchParams.get("needsCamera")).toBe("false");
    expect(url.searchParams.get("needsMicrophone")).toBe("true");
    expect(url.searchParams.get("startAfterGrant")).toBe("1");
  });

  it("omits the auto-start flag when there is no queued recording", () => {
    const url = new URL(permissionPageUrl({ camera: true, microphone: true }));

    expect(url.searchParams.has("startAfterGrant")).toBe(false);
  });
});

describe("mediaPermissionErrorFromResponse", () => {
  it("rebuilds the typed error the offscreen recorder replied with", () => {
    const error = mediaPermissionErrorFromResponse({
      errorCode: MEDIA_PERMISSION_REQUIRED_CODE,
      errorDevice: "camera",
    });

    expect(error).toBeInstanceOf(MediaPermissionRequiredError);
    expect(error?.device).toBe("camera");
  });

  it("leaves an ordinary failure for the caller to report as-is", () => {
    expect(mediaPermissionErrorFromResponse({ errorCode: undefined })).toBe(
      null,
    );
    expect(
      mediaPermissionErrorFromResponse({
        errorCode: MEDIA_PERMISSION_REQUIRED_CODE,
        errorDevice: "speaker",
      }),
    ).toBe(null);
  });
});

describe("cached grants", () => {
  it("revokes one device without dropping the other", async () => {
    await writeCachedMediaPermission({ camera: true, microphone: true });
    await writeCachedMediaPermission({ microphone: false });

    expect(await readCachedMediaPermission()).toEqual({
      camera: true,
      microphone: false,
    });
  });

  it("reads an unset cache as no grants rather than as granted", async () => {
    expect(await readCachedMediaPermission()).toEqual({});
  });
});

describe("hasGrantedDeviceLabels", () => {
  it("treats labelled devices of that kind as a live grant", async () => {
    enumerated = async () =>
      [
        { kind: "audioinput", deviceId: "mic", label: "Built-in Microphone" },
        { kind: "videoinput", deviceId: "cam", label: "" },
      ] as MediaDeviceInfo[];

    expect(await hasGrantedDeviceLabels("microphone")).toBe(true);
    expect(await hasGrantedDeviceLabels("camera")).toBe(false);
  });

  it("treats an unreadable device list as unproven", async () => {
    enumerated = async () => {
      throw new Error("enumerateDevices blocked");
    };

    expect(await hasGrantedDeviceLabels("microphone")).toBe(false);
  });
});
