import { describe, expect, it } from "vitest";

import {
  designSharePath,
  normalizeVisualEditTunnelUrl,
  visualEditPreviewForViewer,
} from "./visual-edit-preview";

describe("shared localhost preview routing", () => {
  const mapping = {
    localUrl: "http://localhost:5173/onboarding?step=2",
    tunnelUrl: "https://demo.ngrok-free.app",
  };
  it("keeps the owner's local URL and maps remote routes to the tunnel", () => {
    expect(visualEditPreviewForViewer({ ...mapping, isOwner: true })).toBe(
      mapping.localUrl,
    );
    expect(visualEditPreviewForViewer({ ...mapping, isOwner: false })).toBe(
      "https://demo.ngrok-free.app/onboarding?step=2",
    );
    expect(
      visualEditPreviewForViewer({
        localUrl: mapping.localUrl,
        isOwner: false,
      }),
    ).toBeUndefined();
  });
  it("falls back to the snapshot for a stored private-network mapping", () => {
    expect(
      visualEditPreviewForViewer({
        localUrl: mapping.localUrl,
        tunnelUrl: "https://service.internal",
        isOwner: false,
      }),
    ).toBeUndefined();
  });
  it.each([
    "http://demo.ngrok-free.app",
    "https://localhost",
    "https://127.0.0.1",
    "https://[::1]",
    "https://demo.local",
    "https://service.internal",
    "https://router.lan",
    "https://intranet",
    "https://[2001:db8::1]",
    "https://user:secret@example.test",
  ])("rejects unsafe public preview mapping %s", (url) => {
    expect(() => normalizeVisualEditTunnelUrl(url)).toThrow();
  });
});

it("invited links use shared canvas for mixed localhost designs", () => {
  expect(
    designSharePath(
      "design one",
      JSON.stringify({ screenMetadata: { local: { connectionId: "local" } } }),
    ),
  ).toBe("/visual-edit/design%20one?share=1&editorView=overview");
  expect(designSharePath("plain", {})).toBe("/design/plain");
});
