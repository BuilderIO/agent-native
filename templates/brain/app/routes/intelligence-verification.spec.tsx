// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";

import type { IntelligenceItem } from "../../shared/intelligence";

const fixture = vi.hoisted(() => ({
  verification: {
    state: "unverified" as "unverified" | "verified" | "deprecated",
    verifiedBy: null as string | null,
    verifiedAt: null as string | null,
    remindAt: null as string | null,
  },
  verifyMutate: vi.fn(),
  writeMutate: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  actionErrorMessage: () => "Action failed",
  useActionMutation: (name: string) => ({
    mutate:
      name === "verify-knowledge" ? fixture.verifyMutate : fixture.writeMutate,
    isPending: false,
    isError: false,
    error: null,
  }),
  useActionQuery: (name: string) =>
    name === "list-intelligence"
      ? {
          data: {
            records: [
              {
                id: "action-one",
                title: "Send the launch notes",
                body: "Prepare the agreed launch notes.",
                kind: "action",
                status: "open",
                owner: "Alex",
                dueDate: null,
                ownershipConfidence: "explicit",
                confidence: 90,
                entities: [],
                audienceId: "aud-1",
                updatedAt: "2026-11-19T12:00:00.000Z",
                revision: "rev-1",
                verification: fixture.verification,
                evidence: [
                  {
                    captureId: "capture-one",
                    sourceId: "source-one",
                    captureTitle: "Launch meeting transcript",
                    quote: "Send the launch notes.",
                  },
                ],
              } satisfies IntelligenceItem,
            ],
            hasMore: false,
          },
          isLoading: false,
          isError: false,
        }
      : { data: undefined, isLoading: false, isError: false },
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
  useFormatters: () => ({ formatDate: () => "Nov 19, 2026" }),
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  sendToAgentChat: vi.fn(),
}));

import Route from "./intelligence";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const owned: { root: Root; host: HTMLElement }[] = [];

async function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  owned.push({ root, host });
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/intelligence?tab=actions"]}>
        <Route />
      </MemoryRouter>,
    );
  });
  return host;
}

function requireNode<T>(node: T | null | undefined, label: string): T {
  if (!node) throw new Error(label);
  return node;
}

function findButton(container: ParentNode, text: string) {
  return [...container.querySelectorAll("button")].find(
    (button) => button.textContent.trim() === text,
  );
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

afterEach(async () => {
  for (const { root, host } of owned.splice(0)) {
    await act(async () => root.unmount());
    host.remove();
  }
  fixture.verification = {
    state: "unverified",
    verifiedBy: null,
    verifiedAt: null,
    remindAt: null,
  };
  fixture.verifyMutate.mockReset();
  fixture.writeMutate.mockReset();
});

it("requires confirmation before verifying an unverified record and sends default 90-day reminder", async () => {
  const host = await mount();
  const verifyBtn = requireNode(
    findButton(host, "intelligence.verify"),
    "Verify button must render",
  );

  await click(verifyBtn);
  expect(
    fixture.verifyMutate,
    "clicking Verify on an unverified row must open confirmation instead of mutating immediately",
  ).not.toHaveBeenCalled();

  const dialog = requireNode(
    document.querySelector("[role='dialog']"),
    "Verify confirmation dialog must be open",
  );

  const cancelBtn = requireNode(
    findButton(dialog, "intelligence.cancel"),
    "Cancel button must render in Verify dialog",
  );
  await click(cancelBtn);
  expect(fixture.verifyMutate).not.toHaveBeenCalled();

  await click(verifyBtn);
  const reopened = requireNode(
    document.querySelector("[role='dialog']"),
    "Verify confirmation dialog must reopen",
  );
  const confirmBtn = requireNode(
    findButton(reopened, "intelligence.verify"),
    "Confirm Verify button must render",
  );
  await click(confirmBtn);

  expect(fixture.verifyMutate).toHaveBeenCalledTimes(1);
  expect(fixture.verifyMutate).toHaveBeenCalledWith(
    {
      knowledgeId: "action-one",
      state: "verified",
      attested: true,
      expectedRevision: "rev-1",
      remindInDays: 90,
    },
    expect.any(Object),
  );
});

it("requires confirmation before deprecating an unverified record", async () => {
  const host = await mount();
  const deprecateBtn = requireNode(
    findButton(host, "intelligence.deprecate"),
    "Deprecate button must render",
  );

  await click(deprecateBtn);
  expect(
    fixture.verifyMutate,
    "clicking Deprecate on an unverified row must open confirmation instead of mutating immediately",
  ).not.toHaveBeenCalled();

  const dialog = requireNode(
    document.querySelector("[role='dialog']"),
    "Deprecate confirmation dialog must be open",
  );
  const confirmBtn = requireNode(
    findButton(dialog, "intelligence.deprecate"),
    "Confirm Deprecate button must render",
  );
  await click(confirmBtn);

  expect(fixture.verifyMutate).toHaveBeenCalledTimes(1);
  expect(fixture.verifyMutate).toHaveBeenCalledWith(
    {
      knowledgeId: "action-one",
      state: "deprecated",
      attested: true,
      expectedRevision: "rev-1",
    },
    expect.any(Object),
  );
});

it("exposes direct Clear status action in overflow menu for verified and deprecated records", async () => {
  for (const state of ["verified", "deprecated"] as const) {
    fixture.verification = {
      state,
      verifiedBy: "qa-fleet@builder.io",
      verifiedAt: "2026-11-19T12:00:00.000Z",
      remindAt: null,
    };
    const host = await mount();
    const trigger = requireNode(
      host.querySelector(
        "button[aria-label='intelligence.verificationActions']",
      ),
      `overflow verification menu trigger must render for ${state} records`,
    );

    await act(async () => {
      trigger.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          ctrlKey: false,
        }),
      );
      trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const menuItems = [...document.querySelectorAll("[role='menuitem']")];
    expect(menuItems.length).toBe(3);
    const clearItem = requireNode(
      menuItems.find((item) =>
        item.textContent.includes("intelligence.clearStatus"),
      ),
      `Clear status menu item must exist for ${state}`,
    );

    await click(clearItem);
    expect(fixture.verifyMutate).toHaveBeenCalledWith({
      knowledgeId: "action-one",
      state: "unverified",
      attested: true,
      expectedRevision: "rev-1",
    });
    fixture.verifyMutate.mockReset();
    for (const { root, host: mountedHost } of owned.splice(0)) {
      await act(async () => root.unmount());
      mountedHost.remove();
    }
  }
});

it("routes overflow Verify on deprecated records through the reminder dialog and keeps direct re-verify for verified records", async () => {
  fixture.verification = {
    state: "deprecated",
    verifiedBy: "qa-fleet@builder.io",
    verifiedAt: "2026-11-19T12:00:00.000Z",
    remindAt: null,
  };
  const host = await mount();
  const trigger = requireNode(
    host.querySelector("button[aria-label='intelligence.verificationActions']"),
    "overflow verification menu trigger must render for deprecated records",
  );
  await act(async () => {
    trigger.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        ctrlKey: false,
      }),
    );
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  const verifyItem = requireNode(
    [...document.querySelectorAll("[role='menuitem']")].find((item) =>
      item.textContent.includes("intelligence.verifySubtitle"),
    ),
    "Verify menu item must exist for deprecated records",
  );
  await click(verifyItem);
  expect(fixture.verifyMutate).not.toHaveBeenCalled();

  const dialog = requireNode(
    document.querySelector("[role='dialog']"),
    "Verify confirmation dialog must open when verifying a deprecated record",
  );
  const confirmBtn = requireNode(
    findButton(dialog, "intelligence.verify"),
    "Confirm Verify button must render",
  );
  await click(confirmBtn);
  expect(fixture.verifyMutate).toHaveBeenCalledWith(
    {
      knowledgeId: "action-one",
      state: "verified",
      attested: true,
      expectedRevision: "rev-1",
      remindInDays: 90,
    },
    expect.any(Object),
  );
});

it("surfaces scheduled and due verification reminders on verified rows", async () => {
  fixture.verification = {
    state: "verified",
    verifiedBy: "qa-fleet@builder.io",
    verifiedAt: "2026-11-19T12:00:00.000Z",
    remindAt: "2099-02-17T12:00:00.000Z",
  };
  const futureHost = await mount();
  expect(futureHost.textContent).toContain("intelligence.reviewScheduledOn");
  expect(futureHost.textContent).not.toContain("intelligence.reviewDue");
  for (const { root, host: mountedHost } of owned.splice(0)) {
    await act(async () => root.unmount());
    mountedHost.remove();
  }

  fixture.verification = {
    state: "verified",
    verifiedBy: "qa-fleet@builder.io",
    verifiedAt: "2026-08-01T12:00:00.000Z",
    remindAt: "2026-11-01T12:00:00.000Z",
  };
  const dueHost = await mount();
  expect(dueHost.textContent).toContain("intelligence.reviewDue");
  expect(dueHost.textContent).toContain("intelligence.reviewDueOn");
});
