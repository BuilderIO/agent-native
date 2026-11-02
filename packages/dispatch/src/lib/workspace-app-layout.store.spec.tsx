// @vitest-environment happy-dom
import { CHAT_FIRST_APP_LAYOUT_STORAGE_KEY } from "@agent-native/core/client/agent-chat";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const appState = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(),
}));

vi.mock("@agent-native/core/client/application-state", () => ({
  readClientAppState: appState.read,
  writeClientAppState: appState.write,
}));

import {
  resetWorkspaceAppLayoutStoreForTests,
  useWorkspaceAppLayout,
  WORKSPACE_APP_LAYOUT_STATE_KEY,
} from "./workspace-app-layout";

function Surface({ name, appId }: { name: string; appId: string }) {
  const { layout, persistenceError, togglePinned } = useWorkspaceAppLayout();
  return (
    <button
      type="button"
      data-surface={name}
      data-pinned={layout.pinnedIds.join(",")}
      data-error={persistenceError?.scope ?? ""}
      onClick={() => togglePinned(appId)}
    />
  );
}

describe("useWorkspaceAppLayout", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    resetWorkspaceAppLayoutStoreForTests();
    localStorage.clear();
    appState.read.mockReset().mockResolvedValue(null);
    appState.write.mockReset().mockResolvedValue(null);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const surface = (name: string) =>
    container.querySelector<HTMLButtonElement>(`[data-surface="${name}"]`)!;

  it("shares one layout so a pin on one surface never drops another's", async () => {
    await act(async () => {
      root.render(
        <>
          <Surface name="home" appId="mail" />
          <Surface name="rail" appId="plan" />
        </>,
      );
    });

    await act(async () => surface("home").click());
    await act(async () => surface("rail").click());

    expect(surface("home").dataset.pinned).toBe("plan,mail");
    expect(surface("rail").dataset.pinned).toBe("plan,mail");
    expect(appState.write).toHaveBeenLastCalledWith(
      WORKSPACE_APP_LAYOUT_STATE_KEY,
      { pinnedIds: ["plan", "mail"], orderedIds: [] },
    );
    expect(
      JSON.parse(localStorage.getItem(CHAT_FIRST_APP_LAYOUT_STORAGE_KEY)!),
    ).toEqual({ pinnedIds: ["plan", "mail"], orderedIds: [] });
  });

  it("replays a pin made before workspace state loads onto the saved pins", async () => {
    let resolveRead: (value: unknown) => void = () => {};
    appState.read.mockReturnValue(
      new Promise((resolve) => {
        resolveRead = resolve;
      }),
    );
    await act(async () => {
      root.render(
        <>
          <Surface name="home" appId="mail" />
          <Surface name="rail" appId="plan" />
        </>,
      );
    });
    expect(appState.read).toHaveBeenCalledOnce();

    await act(async () => surface("home").click());
    expect(appState.write).not.toHaveBeenCalled();
    await act(async () => {
      resolveRead({ pinnedIds: ["calendar", "notes"], orderedIds: [] });
    });

    const replayed = {
      pinnedIds: ["mail", "calendar", "notes"],
      orderedIds: [],
    };
    expect(surface("rail").dataset.pinned).toBe("mail,calendar,notes");
    expect(appState.write).toHaveBeenCalledOnce();
    expect(appState.write).toHaveBeenCalledWith(
      WORKSPACE_APP_LAYOUT_STATE_KEY,
      replayed,
    );
    expect(
      JSON.parse(localStorage.getItem(CHAT_FIRST_APP_LAYOUT_STORAGE_KEY)!),
    ).toEqual(replayed);
  });

  it("keeps a pin's intent when the workspace already had it pinned", async () => {
    // A new device shows no pins; the workspace pinned mail elsewhere.
    let resolveRead: (value: unknown) => void = () => {};
    appState.read.mockReturnValue(
      new Promise((resolve) => {
        resolveRead = resolve;
      }),
    );
    await act(async () => {
      root.render(<Surface name="home" appId="mail" />);
    });

    await act(async () => surface("home").click());
    await act(async () => {
      resolveRead({ pinnedIds: ["mail", "notes"], orderedIds: [] });
    });

    expect(surface("home").dataset.pinned).toBe("mail,notes");
    expect(appState.write).toHaveBeenCalledWith(
      WORKSPACE_APP_LAYOUT_STATE_KEY,
      { pinnedIds: ["mail", "notes"], orderedIds: [] },
    );
  });

  it("renders an empty layout on the server even with device pins", () => {
    localStorage.setItem(
      CHAT_FIRST_APP_LAYOUT_STORAGE_KEY,
      JSON.stringify({ pinnedIds: ["mail"], orderedIds: [] }),
    );

    expect(renderToString(<Surface name="home" appId="mail" />)).toContain(
      'data-pinned=""',
    );
  });

  it("adopts workspace pins when nothing changed locally", async () => {
    appState.read.mockResolvedValue({
      pinnedIds: ["Calendar"],
      orderedIds: [],
    });
    await act(async () => {
      root.render(<Surface name="home" appId="mail" />);
    });

    expect(surface("home").dataset.pinned).toBe("calendar");
    expect(appState.write).not.toHaveBeenCalled();
    expect(
      JSON.parse(localStorage.getItem(CHAT_FIRST_APP_LAYOUT_STORAGE_KEY)!),
    ).toEqual({ pinnedIds: ["calendar"], orderedIds: [] });
    await act(async () => surface("home").click());
    expect(surface("home").dataset.pinned).toBe("mail,calendar");
  });

  it("never writes workspace state it could not read, and replays once it can", async () => {
    appState.read
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ pinnedIds: ["calendar"], orderedIds: [] });
    await act(async () => {
      root.render(
        <>
          <Surface name="home" appId="mail" />
          <Surface name="rail" appId="plan" />
        </>,
      );
    });
    // A failed read with nothing unsaved is not reported.
    expect(surface("home").dataset.error).toBe("");

    await act(async () => surface("home").click());
    expect(surface("home").dataset.pinned).toBe("mail");
    expect(surface("home").dataset.error).toBe("workspace");
    expect(appState.write).not.toHaveBeenCalled();
    expect(
      JSON.parse(localStorage.getItem(CHAT_FIRST_APP_LAYOUT_STORAGE_KEY)!),
    ).toEqual({ pinnedIds: ["mail"], orderedIds: [] });

    // The next change retries the read and replays both onto the saved pins.
    await act(async () => surface("rail").click());
    const replayed = {
      pinnedIds: ["plan", "mail", "calendar"],
      orderedIds: [],
    };
    expect(appState.read).toHaveBeenCalledTimes(3);
    expect(surface("rail").dataset.pinned).toBe("plan,mail,calendar");
    expect(appState.write).toHaveBeenCalledOnce();
    expect(appState.write).toHaveBeenCalledWith(
      WORKSPACE_APP_LAYOUT_STATE_KEY,
      replayed,
    );
    expect(surface("rail").dataset.error).toBe("");
  });

  it("retries an unreadable workspace layout when a surface mounts again", async () => {
    appState.read
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ pinnedIds: ["calendar"], orderedIds: [] });
    await act(async () => {
      root.render(<Surface name="home" appId="mail" />);
    });
    expect(surface("home").dataset.error).toBe("");

    act(() => root.unmount());
    root = createRoot(container);
    await act(async () => {
      root.render(<Surface name="home" appId="mail" />);
    });

    expect(surface("home").dataset.pinned).toBe("calendar");
    expect(surface("home").dataset.error).toBe("");
    expect(appState.write).not.toHaveBeenCalled();
  });
});
