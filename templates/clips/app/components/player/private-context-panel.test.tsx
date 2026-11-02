// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import messages from "@/i18n/en-US";

import {
  PrivateContextPanel,
  type PrivateDiagnosticContext,
} from "./private-context-panel";

const mocks = vi.hoisted(() => ({
  callAction: vi.fn(),
  setState: vi.fn().mockResolvedValue(undefined),
  invalidate: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn(),
  refetch: vi.fn().mockResolvedValue(undefined),
  page: {
    isError: false,
    data: undefined as Partial<PrivateDiagnosticContext> | undefined,
  },
  grants: [] as Array<{
    id: string;
    label: string;
    expiresAt: string;
    revokedAt: null;
    scopes: string[];
  }>,
}));
function translate(key: string, values: Record<string, unknown> = {}) {
  let found: unknown = messages;
  for (const part of key.split("."))
    found =
      found && typeof found === "object" ? Reflect.get(found, part) : undefined;
  return Object.entries(values).reduce(
    (text, [name, value]) => text.replace(`{{${name}}}`, String(value)),
    typeof found === "string" ? found : key,
  );
}
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => translate,
  useFormatters: () => ({
    formatDate: (value: string | Date) => new Date(value).toISOString(),
  }),
}));
vi.mock("@agent-native/core/client/feature-flags", () => ({
  useFeatureFlag: () => true,
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: mocks.callAction,
  setClientAppState: mocks.setState,
  deleteClientAppState: mocks.setState,
  useActionQuery: (action: string) =>
    action === "get-recording-diagnostic-context"
      ? mocks.page
      : {
          data:
            action === "list-recording-diagnostic-grants"
              ? { grants: mocks.grants }
              : { shares: [{ email: "teammate@example.test" }] },
          refetch: mocks.refetch,
        },
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidate,
    removeQueries: mocks.remove,
  }),
}));
vi.mock("@agent-native/toolkit/sharing", () => ({
  ShareAgentsSection: ({ children }: { children: React.ReactNode }) => (
    <section>{children}</section>
  ),
}));
vi.mock("@agent-native/toolkit/clipboard", () => ({
  writeClipboardText: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

let container: HTMLDivElement;
let root: Root;
const startedAt = "2026-11-01T10:00:00.000Z";
const expiresAt = "2026-11-30T10:00:00.000Z";
const data: PrivateDiagnosticContext = {
  canManage: true,
  context: {
    id: "context-1",
    contextVersion: 1,
    recordingStartedAt: startedAt,
    requestedWindow: {
      from: "2026-11-01T09:55:00.000Z",
      to: "2026-11-01T10:00:30.000Z",
    },
    captured: "partial",
    coverage: [
      {
        documentId: "document-1",
        from: "2026-11-01T09:58:00.000Z",
        to: "2026-11-01T10:00:30.000Z",
      },
    ],
    gaps: [
      {
        from: "2026-11-01T09:55:00.000Z",
        to: "2026-11-01T09:58:00.000Z",
        reason: "source_retention",
      },
    ],
    pauses: [],
    droppedEvents: 0,
    expiresAt,
  },
};
async function render(value = data) {
  await act(async () => {
    root.render(
      <PrivateContextPanel
        data={value}
        recordingId="recording-1"
        durationMs={30_000}
        onSeek={vi.fn()}
      />,
    );
  });
}
async function click(text: string) {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === text,
  );
  if (!button) throw new Error(`Missing button: ${text}`);
  await act(async () => button.click());
}
async function input(label: string, value: string) {
  const element = Array.from(container.querySelectorAll("input")).find(
    (candidate) =>
      candidate.getAttribute("aria-label") === label ||
      candidate.closest("label")?.textContent === label,
  );
  if (!element) throw new Error(`Missing input: ${label}`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.setSystemTime(new Date(startedAt));
  mocks.callAction.mockReset().mockResolvedValue({
    grantId: "grant-1",
    url: "https://example.test/private-context",
    expiresAt: "2026-11-01T12:00:00.000Z",
  });
  mocks.page = {
    isError: false,
    data: {
      events: [
        {
          documentId: "document-1",
          seq: 1,
          type: "action",
          timestampMs: Date.parse(startedAt) + 1000,
          elapsedMs: 1000,
          name: "duplicate-screen",
        },
      ],
    },
  };
  mocks.grants = [
    {
      id: "grant-1",
      label: "Placement review",
      scopes: ["events"],
      expiresAt,
      revokedAt: null,
    },
  ];
  mocks.remove.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("private context inspection and grants", () => {
  it("shows actual coverage and creates/revokes a bounded grant from explicit controls", async () => {
    await render();
    expect(container.textContent).toContain("Partial coverage");
    expect(container.textContent).toContain("source_retention");
    expect(container.textContent).toContain("duplicate-screen");
    await input("Access label", "Placement review");
    await input("From (recording milliseconds)", "0");
    await input("To (recording milliseconds)", "2000");
    await click("Create context link");
    expect(mocks.callAction).toHaveBeenCalledWith(
      "create-recording-diagnostic-grant",
      {
        contextId: "context-1",
        label: "Placement review",
        scopes: ["summary", "events"],
        ttlSeconds: 7200,
        fromMs: 0,
        toMs: 2000,
      },
    );
    expect(container.textContent).toContain("Copy context link");
    await click("Revoke");
    expect(mocks.callAction).toHaveBeenCalledWith(
      "revoke-recording-diagnostic-grant",
      { grantId: "grant-1" },
    );
    expect(container.textContent).not.toContain("Copy context link");
  });

  it("keeps interval validation recoverable and hides an old preview for an invalid interval", async () => {
    await render();
    await input("From (recording milliseconds)", "2000");
    await input("To (recording milliseconds)", "1000");
    expect(container.textContent).toContain(
      "The end must be at or after the start.",
    );
    expect(container.textContent).not.toContain("duplicate-screen");
    await input("To (recording milliseconds)", "3000");
    expect(container.textContent).not.toContain(
      "The end must be at or after the start.",
    );
    expect(container.textContent).toContain("duplicate-screen");
  });

  it("clears the managed bearer link when its own grant expires before the context", async () => {
    await render();
    await input("Access label", "Placement review");
    await click("Create context link");
    expect(container.textContent).toContain("Copy context link");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);
    });
    expect(container.textContent).not.toContain("Copy context link");
    expect(container.textContent).toContain("duplicate-screen");
  });

  it("lets a named reader inspect timestamped pending state without grant administration", async () => {
    mocks.page.data = {
      pending: [{ name: "save-file-content", type: "action", ageMs: 100 }],
      pendingAtMs: Date.parse(startedAt) + 1000,
    };
    await render({ ...data, canManage: false });
    expect(container.textContent).toContain("State samples");
    expect(container.textContent).toContain("save-file-content");
    expect(container.textContent).toContain(
      String(Date.parse(startedAt) + 1000),
    );
    expect(container.textContent).not.toContain("Create context link");
  });

  it("removes named access through diagnostic sharing rather than video sharing", async () => {
    await render();
    const revoke = Array.from(container.querySelectorAll("button")).find(
      (button) =>
        button.textContent === "Revoke" &&
        button.parentElement?.textContent.includes("teammate@example.test"),
    );
    if (!revoke) throw new Error("Missing named share revocation");
    await act(async () => revoke.click());
    expect(mocks.callAction).toHaveBeenCalledWith(
      "unshare-recording-diagnostic-context",
      { contextId: "context-1", email: "teammate@example.test" },
    );
  });

  it("does not render a stale payload after the next read is denied", async () => {
    await render();
    mocks.page.isError = true;
    await render();
    expect(container.textContent).toBe("Private context could not be read");
    expect(container.textContent).not.toContain("duplicate-screen");
    expect(container.querySelector("button")).toBeNull();
  });

  it("supports limited metadata for a named reader and expires on the actual deadline", async () => {
    await render({
      canManage: false,
      context: {
        id: "context-1",
        contextVersion: 1,
        recordingStartedAt: startedAt,
        expiresAt,
      },
    });
    expect(container.textContent).toContain("duplicate-screen");
    expect(container.textContent).not.toContain("Create context link");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(25 * 86_400_000);
    });
    expect(container.textContent).toContain("duplicate-screen");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 86_400_000);
    });
    expect(container.textContent).toBe("Private context could not be read");
    expect(mocks.remove).toHaveBeenCalledWith({
      queryKey: ["action", "get-recording-diagnostic-context"],
    });
  });
});
