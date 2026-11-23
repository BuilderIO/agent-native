// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import messages from "@/i18n/en-US";

const mutation = vi.hoisted(() => vi.fn(async () => ({ effect: "added" })));
const refetch = vi.hoisted(() => vi.fn(async () => ({})));
const supportedRoles = vi.hoisted(() => ({
  current: ["app_viewer"] as string[],
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  actionErrorCode: vi.fn(),
  useActionMutation: () => ({ mutateAsync: mutation, isPending: false }),
  useActionQuery: (name: string) => ({
    data:
      name === "list-published-app-access"
        ? {
            projectId: "project-a",
            revision: "5",
            generalAccess: "private",
            owner: { id: "owner", displayName: "Project owner" },
            supportedRoles: supportedRoles.current,
            grants: [],
            nextCursor: null,
            appHref: "/analytics-2/app/project-a/latest",
          }
        : {
            people: [{ id: "member-7", displayName: "Workspace colleague" }],
            nextCursor: null,
          },
    isPending: false,
    refetch,
  }),
}));

import { PublishedAppSharePopover } from "./PublishedAppSharePopover";

function button(name: string) {
  const found = Array.from(document.querySelectorAll("button")).find(
    (element) => element.textContent === name,
  );
  if (!found) throw new Error(`Button "${name}" is absent`);
  return found;
}

it("opens Invite only access, stages Can view app, gates unsupported roles and copies the mounted app link", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const writeText = vi.fn(async () => {});
  const clipboard = vi.spyOn(navigator, "clipboard", "get").mockReturnValue(
    Object.assign(new EventTarget(), {
      writeText,
      readText: async () => "",
      read: async () => [],
      write: async () => {},
    }),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <AgentNativeI18nProvider
          catalog={{ messages }}
          persistPreference={false}
        >
          <PublishedAppSharePopover projectId="project-a" title="Share proof" />
        </AgentNativeI18nProvider>,
      ),
    );
    await act(async () => button("Share").click());
    expect(document.body.textContent).toContain("Invite only");
    const picker = document.querySelector<HTMLInputElement>(
      'input[role="combobox"]',
    );
    expect(picker?.placeholder).toBe("+ Users");
    await act(async () => picker?.focus());
    const option = Array.from(
      document.querySelectorAll<HTMLElement>('[role="option"]'),
    ).find((element) => element.textContent === "Workspace colleague");
    expect(option).toBeDefined();
    await act(async () => option?.click());
    expect(document.body.textContent).toContain(
      "Can view and comment only on the published App.",
    );
    await act(async () =>
      button("Can view app").dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      ),
    );
    const roles = Array.from(document.querySelectorAll('[role="menuitem"]'));
    expect(
      roles
        .find(({ textContent }) => textContent?.startsWith("Can explore"))
        ?.getAttribute("aria-disabled"),
    ).toBe("true");
    expect(
      roles
        .find(({ textContent }) => textContent?.startsWith("Can edit"))
        ?.getAttribute("aria-disabled"),
    ).toBe("true");
    expect(
      roles
        .find(({ textContent }) => textContent?.startsWith("Can view app"))
        ?.getAttribute("aria-disabled"),
    ).toBeNull();
    await act(async () =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    await act(async () => button("Add").click());
    expect(mutation).toHaveBeenCalledWith({
      projectId: "project-a",
      expectedRevision: "5",
      opId: expect.any(String),
      change: { kind: "grant", memberId: "member-7", role: "app_viewer" },
    });
    expect(refetch).toHaveBeenCalled();
    await act(async () => button("Copy link").click());
    expect(writeText).toHaveBeenCalledWith(
      new URL("/analytics-2/app/project-a/latest", location.origin).href,
    );
  } finally {
    await act(async () => root.unmount());
    container.remove();
    clipboard.mockRestore();
    vi.unstubAllGlobals();
  }
});

it("submits only once when Add is activated twice before the pending state renders", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mutation.mockClear();
  let finish!: (value: { effect: string }) => void;
  mutation.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <AgentNativeI18nProvider
          catalog={{ messages }}
          persistPreference={false}
        >
          <PublishedAppSharePopover projectId="project-a" title="Share proof" />
        </AgentNativeI18nProvider>,
      ),
    );
    await act(async () => button("Share").click());
    await act(async () =>
      document
        .querySelector<HTMLInputElement>('input[role="combobox"]')
        ?.focus(),
    );
    const option = Array.from(
      document.querySelectorAll<HTMLElement>('[role="option"]'),
    ).find((element) => element.textContent === "Workspace colleague");
    await act(async () => option?.click());
    await act(async () => {
      button("Add").click();
      button("Add").click();
    });
    expect(mutation).toHaveBeenCalledTimes(1);
    await act(async () => finish({ effect: "added" }));
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("closes the share popover on Escape when invite suggestions are hidden", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  supportedRoles.current = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <AgentNativeI18nProvider
          catalog={{ messages }}
          persistPreference={false}
        >
          <PublishedAppSharePopover projectId="project-a" title="Share proof" />
        </AgentNativeI18nProvider>,
      ),
    );
    await act(async () => button("Share").click());
    expect(document.body.textContent).toContain("Invite only");
    const picker = document.querySelector<HTMLInputElement>(
      'input[role="combobox"]',
    );
    await act(async () => picker?.focus());
    await act(async () =>
      picker?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    expect(document.body.textContent).not.toContain("Invite only");
  } finally {
    supportedRoles.current = ["app_viewer"];
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("row 440 exposes Embedding options inside the published app share popover", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <AgentNativeI18nProvider
          catalog={{ messages }}
          persistPreference={false}
        >
          <PublishedAppSharePopover projectId="project-a" title="Share proof" />
        </AgentNativeI18nProvider>,
      ),
    );
    await act(async () => button("Share").click());
    const embedToggle = document.querySelector<HTMLButtonElement>(
      '[data-testid="share-embedding-options"]',
    );
    expect(embedToggle).not.toBeNull();
    expect(embedToggle?.textContent).toContain("Embedding options");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
