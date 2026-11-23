// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NotificationsMenu } from "./NotificationsMenu";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  const activeRoot = root;
  if (activeRoot) {
    act(() => activeRoot.unmount());
    root = null;
  }
  if (container) {
    container.remove();
    container = null;
  }
});

describe("NotificationsMenu", () => {
  it("formats raw ISO-8601 timestamps into readable local dates while preserving preformatted labels", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    const activeRoot = createRoot(container);
    root = activeRoot;
    act(() => {
      activeRoot.render(
        <NotificationsMenu
          notifications={{
            status: "ready",
            unreadCount: 2,
            items: [
              {
                id: "n1",
                title: "Agent run finished",
                createdAtLabel: "2026-11-20T01:58:36.961Z",
                read: false,
              },
              {
                id: "n2",
                title: "Project shared",
                createdAtLabel: "2h ago",
                read: false,
              },
            ],
            onOpenNotification: vi.fn(),
          }}
        />,
      );
    });
    const trigger = container.querySelector<HTMLButtonElement>("button");
    expect(trigger).not.toBeNull();
    act(() => {
      trigger?.click();
    });
    const times = Array.from(
      document.querySelectorAll<HTMLElement>(".ws-notification-time"),
    );
    expect(times).toHaveLength(2);
    expect(times[0]?.textContent).not.toContain("2026-11-20T01:58:36.961Z");
    expect(times[0]?.textContent).toMatch(/2026/);
    expect(times[0]?.getAttribute("title")).toBe("2026-11-20T01:58:36.961Z");
    expect(times[1]?.textContent).toBe("2h ago");
  });

  it("caps the unread badge at 99+ and keeps rows clickable while a write is pending", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    const activeRoot = createRoot(container);
    root = activeRoot;
    const open = vi.fn();
    act(() => {
      activeRoot.render(
        <NotificationsMenu
          notifications={{
            status: "ready",
            unreadCount: 1234,
            pending: true,
            items: [
              { id: "n1", title: "A", createdAtLabel: "now", read: false },
            ],
            onOpenNotification: open,
          }}
        />,
      );
    });
    expect(container.querySelector(".ws-bell-badge")?.textContent).toBe("99+");
    act(() => {
      container?.querySelector<HTMLButtonElement>("button")?.click();
    });
    const row = document.querySelector<HTMLButtonElement>(
      ".ws-notification-row",
    );
    expect(row?.disabled).toBe(false);
    act(() => row?.click());
    expect(open).toHaveBeenCalledTimes(1);
  });
});
