// @vitest-environment happy-dom

import { callAction } from "@agent-native/core/client/hooks";
import { hashEffectDefinition } from "@shared/native-effect-trust";
import { parseEffectsFromHtml } from "@shared/native-effects";
import { afterEach, describe, expect, it, vi } from "vitest";

import { captureNativeCurrentFramePng } from "./native-current-frame-png";
import { encodeStraightRgbaPng } from "./native-png-encoding";

vi.mock("@agent-native/core/client/hooks", () => ({ callAction: vi.fn() }));
vi.mock("@shared/native-effect-trust", () => ({
  hashEffectDefinition: vi.fn(async () => "known-hash"),
}));
vi.mock("@shared/native-effects", () => ({
  parseEffectsFromHtml: vi.fn(),
}));
vi.mock("./native-png-encoding", () => ({
  encodeStraightRgbaPng: vi.fn(
    async () => new Blob(["captured"], { type: "image/png" }),
  ),
}));

const definition = { id: "effect", version: 1 };
const instance = {
  id: "instance",
  nodeId: "node",
  definitionId: "effect",
  definitionVersion: 1,
  placement: "fill" as const,
  enabled: true,
};

function fixture(versionHash = "current") {
  const capture = vi.fn(async () => ({
    width: 16,
    height: 16,
    rgba: new Uint8Array(16 * 16 * 4),
    alpha: "straight" as const,
    colorSpace: "srgb" as const,
  }));
  const view = {
    __agentNativeSourceProvenance: { versionHash },
    __anNativeShaders: { captureCommittedCompositionPixels: capture },
  };
  const iframe = {
    isConnected: true,
    clientWidth: 16,
    clientHeight: 16,
    contentWindow: view,
  } as unknown as HTMLIFrameElement;
  return { capture, iframe, view };
}

afterEach(() => vi.clearAllMocks());

describe("current mounted native PNG", () => {
  it("captures only a source-pinned committed frame", async () => {
    const { capture, iframe } = fixture();
    vi.mocked(callAction).mockResolvedValue({
      designId: "design",
      fileId: "file",
      html: "saved source",
      versionHash: "current",
      viewport: { width: 16, height: 16 },
      initialPixelRatio: 1,
      sourceVersions: [{ fileId: "file", versionHash: "current" }],
      approvedDefinitionHashes: ["known-hash"],
      instanceTargets: [{ instanceId: "instance", nodeId: "node" }],
    });
    vi.mocked(parseEffectsFromHtml).mockReturnValue({
      errors: [],
      document: { definitions: [definition], instances: [instance] },
    } as unknown as ReturnType<typeof parseEffectsFromHtml>);

    const blob = await captureNativeCurrentFramePng({
      designId: "design",
      fileId: "file",
      iframe,
      pixelRatio: 1,
    });

    expect(await blob.text()).toBe("captured");
    expect(hashEffectDefinition).toHaveBeenCalledWith(definition);
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedInstances: [expect.objectContaining({ id: "instance" })],
      }),
    );
    expect(encodeStraightRgbaPng).toHaveBeenCalledOnce();
  });

  it("rejects a stale saved version before GPU readback", async () => {
    const { capture, iframe } = fixture();
    vi.mocked(callAction).mockResolvedValue({
      designId: "design",
      fileId: "file",
      html: "saved source",
      versionHash: "newer",
      viewport: { width: 16, height: 16 },
      initialPixelRatio: 1,
      sourceVersions: [{ fileId: "file", versionHash: "newer" }],
      approvedDefinitionHashes: ["known-hash"],
      instanceTargets: [{ instanceId: "instance", nodeId: "node" }],
    });

    await expect(
      captureNativeCurrentFramePng({
        designId: "design",
        fileId: "file",
        iframe,
        pixelRatio: 1,
      }),
    ).rejects.toMatchObject({ code: "source-stale" });
    expect(capture).not.toHaveBeenCalled();
  });
});

it.each(["prepared", "pixels"] as const)(
  "rejects a mismatched %s crop without encoding a plausible PNG",
  async (mismatch) => {
    const { capture, iframe } = fixture();
    Object.assign(iframe, { clientWidth: 8192, clientHeight: 8192 });
    const cropRect = { x: 4064, y: 3283, width: 1510, height: 270 };
    const changedCrop = { ...cropRect, x: cropRect.x + 1 };
    vi.mocked(callAction).mockResolvedValue({
      designId: "design",
      fileId: "file",
      html: "saved source",
      versionHash: "current",
      viewport: { width: 8192, height: 8192 },
      initialPixelRatio: 1,
      cropRect: mismatch === "prepared" ? changedCrop : cropRect,
      sourceVersions: [{ fileId: "file", versionHash: "current" }],
      approvedDefinitionHashes: ["known-hash"],
      instanceTargets: [{ instanceId: "instance", nodeId: "node" }],
    });
    vi.mocked(parseEffectsFromHtml).mockReturnValue({
      errors: [],
      document: { definitions: [definition], instances: [instance] },
    } as unknown as ReturnType<typeof parseEffectsFromHtml>);
    const pixels = {
      width: 1510,
      height: 270,
      rgba: new Uint8Array(4),
      alpha: "straight" as const,
      colorSpace: "srgb" as const,
      viewport: { width: 8192, height: 8192 },
      cropRect: changedCrop,
      pixelRatio: 1,
      timeSeconds: 12.5,
    };
    capture.mockResolvedValue(pixels);
    await expect(
      captureNativeCurrentFramePng({
        designId: "design",
        fileId: "file",
        iframe,
        pixelRatio: 1,
        cropRect,
      }),
    ).rejects.toMatchObject({ code: "source-stale" });
    expect(encodeStraightRgbaPng).not.toHaveBeenCalled();
    if (mismatch === "prepared") expect(capture).not.toHaveBeenCalled();
  },
);
