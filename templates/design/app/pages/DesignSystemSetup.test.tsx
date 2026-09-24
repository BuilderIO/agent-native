// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import messages from "@/i18n/en-US";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  read: vi.fn(),
  upload: vi.fn(),
  header: vi.fn(),
}));
function translate(key: string, values: Record<string, string> = {}) {
  const value = key
    .split(".")
    .reduce<unknown>(
      (object, part) => (object as Record<string, unknown>)?.[part],
      messages,
    );
  if (typeof value !== "string") throw new Error(`Missing translation ${key}`);
  return value.replace(
    /\{\{(\w+)\}\}/g,
    (_, name: string) => values[name] ?? name,
  );
}
vi.mock("@agent-native/core/client/i18n", () => ({ useT: () => translate }));
vi.mock("@agent-native/core/client/agent-chat", () => ({
  BuilderDsiGate: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  useActionMutation: (name: string) => ({
    mutateAsync:
      name === "start-design-system-authoring" ? mocks.create : mocks.update,
  }),
  callAction: mocks.read,
}));
vi.mock("@agent-native/toolkit/app-shell", () => ({
  useSetPageTitle: () => {},
  useSetHeaderActions: (value: unknown) => mocks.header(value),
}));
vi.mock("@/lib/design-system-source-upload", () => ({
  uploadDesignSystemSourceFile: mocks.upload,
}));

import DesignSystemSetup from "./DesignSystemSetup";

let root: Root;
let container: HTMLElement;
const button = (name: string) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
    (item) => (item.getAttribute("aria-label") ?? item.textContent) === name,
  )!;
const field = (name: string) => {
  const label = Array.from(
    document.querySelectorAll<HTMLLabelElement>("label"),
  ).find((item) => item.textContent === name)!;
  return document.getElementById(label.htmlFor) as HTMLInputElement;
};
const change = async (name: string, value: string) =>
  act(async () => {
    const input = field(name);
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
const click = async (element: HTMLElement) => act(async () => element.click());
const render = async (
  props: React.ComponentProps<typeof DesignSystemSetup> = {},
) =>
  act(async () =>
    root.render(
      <MemoryRouter>
        <DesignSystemSetup {...props} />
      </MemoryRouter>,
    ),
  );
async function refs() {
  await change("Name", "Acme");
  const radio =
    document.querySelector<HTMLElement>('[role="radio"][value="references"]') ??
    document.querySelectorAll<HTMLElement>('[role="radio"]')[1]!;
  await click(radio);
  await click(button("Continue"));
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  mocks.create.mockResolvedValue({
    id: "system-one",
    title: "Acme",
    canEdit: true,
    workspace: { revision: 0 },
  });
  mocks.upload.mockImplementation(async (file: File) => ({
    name: file.name,
    size: file.size,
    mimeType: file.type,
    handle: { kind: "stored-file", path: "private-source:fixture" },
  }));
  mocks.read.mockResolvedValue({
    id: "system-one",
    canEdit: true,
    workspace: { revision: 4 },
  });
  mocks.update.mockResolvedValue({});
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("Design creation adapter", () => {
  it("shows the current standalone stage heading below the shell header breakpoint", async () => {
    await render();
    const heading = () => container.querySelector("h1")!;
    expect(heading().textContent).toBe("Create design system");
    expect(heading().className).toContain("md:hidden");
    await refs();
    expect(heading().textContent).toBe("Add references");
    expect(document.activeElement).toBe(button("Website"));
  });

  it("keeps a modal draft through dismissal and reflects its current stage in the title", async () => {
    const onReturnToPrompt = vi.fn();
    await render({ open: true, onReturnToPrompt });
    expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe(
      "Create design system",
    );
    await refs();
    expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe(
      "Add references",
    );
    await click(button("Website"));
    await change("Website URL", "https://draft.example.com");
    await render({ open: false, onReturnToPrompt });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    expect(onReturnToPrompt).not.toHaveBeenCalled();
    await render({ open: true, onReturnToPrompt });
    expect(field("Website URL").value).toBe("https://draft.example.com");
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.className).toContain("100vh");
    expect(
      dialog
        .querySelector("[data-creation-body]")
        ?.contains(dialog.querySelector("[data-creation-footer]")),
    ).toBe(false);
    await click(button("Back"));
    expect(field("Name").value).toBe("Acme");
    expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe(
      "Create design system",
    );
  });

  it("persists once through the native action and returns its system ID without chat dispatch", async () => {
    const onCreated = vi.fn();
    const originDraft = {
      app: "design" as const,
      draftId: "draft-one",
      returnPath: "/chat/one",
    };
    await render({ onCreated, originDraft });
    await change("Name", " Acme ");
    await click(button("Continue"));
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
      requestId: expect.any(String),
      title: "Acme",
      intent: "fresh",
      sources: [],
      originDraft,
    });
    expect(onCreated).toHaveBeenCalledExactlyOnceWith(
      "system-one",
      expect.objectContaining({
        title: "Acme",
        snapshot: expect.objectContaining({ id: "system-one" }),
      }),
    );
    expect(mocks.header).toHaveBeenCalledWith(null);
  });

  it("uploads to the native helper, batches all three kinds and keeps them through Back", async () => {
    let back: (() => void) | null = null;
    await render({
      onBackChange: (value) => {
        back = value;
      },
    });
    await refs();
    await click(button("Website"));
    await change("Website URL", "https://example.com/brand");
    await click(
      document.querySelector<HTMLElement>(
        'section[aria-label="Website"] button',
      )!,
    );
    await click(button("Figma"));
    await change("Figma file URL", "https://figma.com/design/ABC123/Brand");
    await click(
      document.querySelector<HTMLElement>(
        'section[aria-label="Figma"] button',
      )!,
    );
    await click(button("Brand files"));
    const file = new File(["# Brand"], "design.md", { type: "text/markdown" });
    await act(async () => {
      Object.defineProperty(field("Choose files"), "files", {
        value: [file],
        configurable: true,
      });
      field("Choose files").dispatchEvent(
        new Event("change", { bubbles: true }),
      );
    });
    await click(
      Array.from(
        document.querySelectorAll<HTMLButtonElement>(
          'section[aria-label="Brand files"] button',
        ),
      ).find((item) => item.textContent === "Add")!,
    );
    expect(mocks.upload).toHaveBeenCalledWith(
      file,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    await act(async () => back?.());
    expect(field("Name").value).toBe("Acme");
    await click(button("Continue"));
    await click(button("Create design system"));
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.create.mock.calls[0][0].sources).toEqual([
      expect.objectContaining({ kind: "website" }),
      expect.objectContaining({ kind: "figma" }),
      expect.objectContaining({
        kind: "file",
        name: "design.md",
        handle: { kind: "stored-file", path: "private-source:fixture" },
      }),
    ]);
  });

  it("keeps a failed creation draft and calls the injected adapter on retry", async () => {
    const onCreate = vi
      .fn()
      .mockRejectedValueOnce(new Error("Connection required"))
      .mockResolvedValue({ systemId: "system-two" });
    const onCreated = vi.fn();
    await render({ onCreate, onCreated });
    await change("Name", "Acme");
    await click(button("Continue"));
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "Connection required",
    );
    expect(field("Name").value).toBe("Acme");
    expect(onCreated).not.toHaveBeenCalled();
    await click(button("Continue"));
    expect(onCreated).toHaveBeenCalledOnce();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("adds references to an existing system using its latest revision", async () => {
    await render({ addingToSystemId: "system-one" });
    await click(button("Website"));
    await change("Website URL", "https://example.com/brand");
    await click(
      document.querySelector<HTMLElement>(
        'section[aria-label="Website"] button',
      )!,
    );
    await click(button("Add to system"));
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.read).toHaveBeenCalledWith("get-design-system-workspace", {
      id: "system-one",
    });
    expect(mocks.update).toHaveBeenCalledWith({
      id: "system-one",
      expectedRevision: 4,
      operationId: expect.any(String),
      sources: [expect.objectContaining({ kind: "website" })],
    });
  });
});
