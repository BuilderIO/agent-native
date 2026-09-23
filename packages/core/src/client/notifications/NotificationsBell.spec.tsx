// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NotificationsBell } from "./NotificationsBell.js";

vi.mock("../use-poll-loop.js", () => ({ usePollLoop: () => {} }));

describe("NotificationsBell", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => [
          {
            id: "n-1",
            owner: "user@example.com",
            severity: "critical",
            title: "Chat is failing",
            body: "First line\nFull command and stack trace",
            createdAt: "2026-09-19T00:00:00Z",
            readAt: null,
            deliveredChannels: ["inbox"],
          },
        ],
      })),
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("reveals the full stored body when a notification has no link", async () => {
    await act(async () => root.render(<NotificationsBell pollMs={0} />));
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".an-notifications-bell__trigger")
        ?.click();
    });
    const row = [...document.body.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Chat is failing"),
    );
    expect(row?.getAttribute("aria-expanded")).toBe("false");
    expect(row?.querySelector(".line-clamp-2")).not.toBeNull();

    await act(async () => row?.click());
    expect(row?.getAttribute("aria-expanded")).toBe("true");
    expect(row?.querySelector(".line-clamp-2")).toBeNull();
    expect(row?.querySelector(".whitespace-pre-wrap")?.textContent).toBe(
      "First line\nFull command and stack trace",
    );
  });
});
