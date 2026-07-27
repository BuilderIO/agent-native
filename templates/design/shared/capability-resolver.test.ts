import { describe, expect, it } from "vitest";

import {
  resolveSourceCapabilities,
  resolveFusionCapabilities,
} from "./capability-resolver";
import { hasCapability } from "./design-source-capabilities";

describe("resolveSourceCapabilities", () => {
  it("returns the disconnected fusion map for fusion sources (conservative default)", () => {
    const caps = resolveSourceCapabilities("fusion");
    // branch/deployPreview/deploy must be unavailable when connection is unknown
    expect(hasCapability(caps, "branch")).toBe(false);
    expect(hasCapability(caps, "deployPreview")).toBe(false);
    expect(hasCapability(caps, "deploy")).toBe(false);
  });

  it("returns unavailable branch/deploy for inline sources", () => {
    const caps = resolveSourceCapabilities("inline");
    expect(hasCapability(caps, "branch")).toBe(false);
    expect(hasCapability(caps, "deployPreview")).toBe(false);
    expect(hasCapability(caps, "deploy")).toBe(false);
  });

  it("returns unavailable branch/deploy for localhost sources", () => {
    const caps = resolveSourceCapabilities("localhost");
    expect(hasCapability(caps, "branch")).toBe(false);
    expect(hasCapability(caps, "deployPreview")).toBe(false);
    expect(hasCapability(caps, "deploy")).toBe(false);
  });
});

describe("resolveFusionCapabilities", () => {
  it("returns branch and deployPreview as available when fusion is connected", () => {
    const caps = resolveFusionCapabilities(true);
    expect(hasCapability(caps, "branch")).toBe(true);
    expect(hasCapability(caps, "deployPreview")).toBe(true);
    expect(hasCapability(caps, "deploy")).toBe(true);
  });

  it("returns branch and deployPreview as unavailable when fusion is disconnected", () => {
    const caps = resolveFusionCapabilities(false);
    expect(hasCapability(caps, "branch")).toBe(false);
    expect(hasCapability(caps, "deployPreview")).toBe(false);
    expect(hasCapability(caps, "deploy")).toBe(false);
  });

  it("connected fusion also has indexComponents available", () => {
    const caps = resolveFusionCapabilities(true);
    expect(hasCapability(caps, "indexComponents")).toBe(true);
  });

  it("disconnected fusion does NOT have indexComponents available", () => {
    const caps = resolveFusionCapabilities(false);
    expect(hasCapability(caps, "indexComponents")).toBe(false);
  });

  it("preview capabilities are available regardless of connection state", () => {
    const connected = resolveFusionCapabilities(true);
    const disconnected = resolveFusionCapabilities(false);
    for (const caps of [connected, disconnected]) {
      expect(hasCapability(caps, "previewPatch")).toBe(true);
      expect(hasCapability(caps, "diffPatch")).toBe(true);
      expect(hasCapability(caps, "captureSnapshot")).toBe(true);
      expect(hasCapability(caps, "resolveNodeToFile")).toBe(true);
    }
  });
});
