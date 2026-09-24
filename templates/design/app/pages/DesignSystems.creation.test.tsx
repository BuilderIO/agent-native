// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import messages from "@/i18n/en-US";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  mutate: vi.fn(),
  systems: [] as Array<Record<string, unknown>>,
  header: null as ReactNode,
}));
function translate(key: string) {
  const value = key
    .split(".")
    .reduce<unknown>(
      (object, part) => (object as Record<string, unknown>)?.[part],
      messages,
    );
  if (typeof value !== "string") throw new Error(`Missing translation ${key}`);
  return value;
}
vi.mock("@agent-native/core/client/i18n", () => ({ useT: () => translate }));
vi.mock("@agent-native/core/client/agent-chat", () => ({
  BuilderDsiGate: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: () => ({ data: { designSystems: mocks.systems } }),
  useActionMutation: (name: string) => ({
    mutateAsync:
      name === "start-design-system-authoring" ? mocks.create : mocks.mutate,
  }),
  callAction: vi.fn(),
}));
vi.mock("@agent-native/toolkit/app-shell", () => ({
  useSetPageTitle: () => {},
  useSetHeaderActions: (node: ReactNode) => {
    mocks.header = node;
  },
}));
vi.mock("@agent-native/core/client/sharing", () => ({
  ShareButton: () => null,
}));
vi.mock("@agent-native/toolkit/sharing", () => ({
  VisibilityBadge: () => null,
}));
vi.mock("@/lib/design-system-source-upload", () => ({
  uploadDesignSystemSourceFile: vi.fn(),
}));

import DesignSystems from "./DesignSystems";

let root: Root;
let container: HTMLElement;
function Header() {
  return <header>{mocks.header}</header>;
}
function Location() {
  return <output>{useLocation().pathname}</output>;
}
const button = (name: string, scope: ParentNode = document) =>
  Array.from(scope.querySelectorAll<HTMLButtonElement>("button")).find(
    (item) => (item.getAttribute("aria-label") ?? item.textContent) === name,
  )!;
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const nameInput = () => dialog()!.querySelector<HTMLInputElement>("input")!;
const location = () => container.querySelector("output")!.textContent;
const click = async (element: HTMLElement) =>
  act(async () => {
    element.focus();
    element.click();
  });
const changeName = async (name: string) =>
  act(async () => {
    const input = nameInput();
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, name);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
const render = async () =>
  act(async () =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={["/design-systems"]}>
          <DesignSystems />
          <Header />
          <Location />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  mocks.header = null;
  mocks.systems = [
    {
      id: "existing-system",
      title: "Existing system",
      data: "{}",
      isDefault: false,
      createdAt: "2026-09-24T00:00:00Z",
    },
  ];
  mocks.create.mockResolvedValue({ id: "new-system", title: "Acme" });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("Design systems creation entry points", () => {
  it.each(["toolbar", "grid", "empty state"])(
    "opens the shared modal from the %s without leaving the list",
    async (entry) => {
      if (entry === "empty state") mocks.systems = [];
      await render();
      const scope = container.querySelector(
        entry === "toolbar" ? "header" : "main",
      )!;
      const trigger = button(messages.designSystems.actions.new, scope);
      await click(trigger);
      expect(dialog()?.querySelector("h2")?.textContent).toBe(
        "Create design system",
      );
      expect(dialog()?.querySelectorAll('[role="radio"]')).toHaveLength(2);
      expect(location()).toBe("/design-systems");
      await changeName("Acme draft");
      await act(async () => {
        nameInput().dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
      });
      expect(dialog()).toBeNull();
      await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
      expect(location()).toBe("/design-systems");
      await click(trigger);
      expect(nameInput().value).toBe("Acme draft");
      await click(button("Back", dialog()!));
      expect(dialog()).toBeNull();
      expect(mocks.create).not.toHaveBeenCalled();
    },
  );

  it("opens the workspace only after the native creation action succeeds", async () => {
    let finish!: (value: { id: string; title: string }) => void;
    mocks.create.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await render();
    await click(button(messages.designSystems.actions.new));
    await changeName("Acme");
    await click(button("Continue", dialog()!));
    expect(location()).toBe("/design-systems");
    expect(dialog()).not.toBeNull();
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
      requestId: expect.any(String),
      title: "Acme",
      intent: "fresh",
      sources: [],
      originDraft: undefined,
    });
    await act(async () => finish({ id: "new-system", title: "Acme" }));
    expect(dialog()).toBeNull();
    expect(location()).toBe("/design-systems/new-system");
  });

  it("keeps a failed creation in the modal with its draft intact", async () => {
    mocks.create.mockRejectedValue(new Error("Creation unavailable"));
    await render();
    await click(button(messages.designSystems.actions.new));
    await changeName("Acme");
    await click(button("Continue", dialog()!));
    expect(dialog()?.textContent).toContain("Creation unavailable");
    expect(nameInput().value).toBe("Acme");
    expect(location()).toBe("/design-systems");
  });
});
