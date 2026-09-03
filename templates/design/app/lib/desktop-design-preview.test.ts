import { describe, expect, it } from "vitest";

import {
  resolveDesktopDesignPreviewConnectionId,
  resolveDesktopDesignSnapshotLayer,
} from "./desktop-design-preview";

describe("desktop Design preview connection scoping", () => {
  it("keeps same-origin projects isolated by their persisted connection id", () => {
    expect(
      resolveDesktopDesignPreviewConnectionId(
        "connection-project-a",
        "http://localhost:5173/account",
      ),
    ).toBe("connection-project-a");
    expect(
      resolveDesktopDesignPreviewConnectionId(
        "connection-project-b",
        "http://localhost:5173/settings",
      ),
    ).toBe("connection-project-b");
  });

  it("falls back to origin only for legacy URL screens without metadata", () => {
    expect(
      resolveDesktopDesignPreviewConnectionId(
        undefined,
        "https://app.example.test/account?tab=profile",
      ),
    ).toBe("https://app.example.test");
    expect(resolveDesktopDesignPreviewConnectionId("", "not a url")).toBeNull();
  });
});

describe("desktop Design snapshot layering", () => {
  it("replaces page pixels only for parent-owned Draw/Comment chrome", () => {
    expect(
      resolveDesktopDesignSnapshotLayer({
        hasSnapshot: true,
        interactMode: false,
        editMode: false,
        hasLiveEditorBridge: false,
      }),
    ).toBe("page");
  });

  it("keeps Edit snapshots below iframe-internal chrome and fails closed without a live bridge", () => {
    expect(
      resolveDesktopDesignSnapshotLayer({
        hasSnapshot: true,
        interactMode: false,
        editMode: true,
        hasLiveEditorBridge: true,
      }),
    ).toBe("handoff");
    expect(
      resolveDesktopDesignSnapshotLayer({
        hasSnapshot: true,
        interactMode: false,
        editMode: true,
        hasLiveEditorBridge: false,
      }),
    ).toBe("none");
  });

  it("never leaves snapshot pixels over live Interact mode", () => {
    expect(
      resolveDesktopDesignSnapshotLayer({
        hasSnapshot: true,
        interactMode: true,
        editMode: false,
        hasLiveEditorBridge: true,
      }),
    ).toBe("none");
  });
});
