// @vitest-environment happy-dom

import {
  WRITE_FAILURE_EVENT,
  type WriteFailureDetail,
} from "@agent-native/core/client/write-failure";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NotificationsBell } from "./NotificationsBell.js";

vi.mock("@agent-native/core/client/use-poll-loop", () => ({
  usePollLoop: () => {},
}));

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

  it("reports a dismiss the server rejected and keeps the notification", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "DELETE"
        ? { ok: false, status: 500, json: async () => ({}) }
        : {
            ok: true,
            json: async () => [
              {
                id: "n-1",
                owner: "user@example.com",
                severity: "critical",
                title: "Chat is failing",
                createdAt: "2026-09-19T00:00:00Z",
                readAt: null,
                deliveredChannels: ["inbox"],
              },
            ],
          },
    );
    vi.stubGlobal("fetch", fetchMock);
    const failures: WriteFailureDetail[] = [];
    const onFailure = (event: Event) =>
      failures.push((event as CustomEvent<WriteFailureDetail>).detail);
    window.addEventListener(WRITE_FAILURE_EVENT, onFailure);

    await act(async () => root.render(<NotificationsBell pollMs={0} />));
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".an-notifications-bell__trigger")
        ?.click();
    });
    await act(async () => {
      document.body
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Dismiss notification"]',
        )
        ?.click();
    });
    window.removeEventListener(WRITE_FAILURE_EVENT, onFailure);

    expect(failures).toHaveLength(1);
    expect((failures[0]?.error as { status?: number }).status).toBe(500);
    expect(document.body.textContent).toContain("Chat is failing");
  });
});
