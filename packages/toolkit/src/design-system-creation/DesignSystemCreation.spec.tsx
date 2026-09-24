// @vitest-environment happy-dom
import { act, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ComposerContextMenu,
  ComposerContextSearchInput,
} from "../composer/ComposerContextMenu.js";
import { Command, CommandItem, CommandList } from "../ui/command.js";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog.js";
import { TooltipProvider } from "../ui/tooltip.js";
import {
  DesignSystemCreation,
  type DesignSystemCreationProps,
} from "./DesignSystemCreation.js";
import type { DesignSystemFileUploadResult } from "./types.js";

const roots: Array<{ root: Root; container: HTMLElement }> = [];
function render(node: ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push({ root, container });
  act(() => root.render(node));
  return { container };
}
function cleanup() {
  for (const { root, container } of roots.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
}
const fireEvent = {
  click: (element: HTMLElement) => act(() => element.click()),
  submit: (element: HTMLElement) =>
    act(() => {
      element.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    }),
  keyDown: (element: HTMLElement, options: KeyboardEventInit) =>
    act(() => {
      element.dispatchEvent(
        new KeyboardEvent("keydown", { ...options, bubbles: true }),
      );
    }),
  change: (
    element: HTMLElement,
    { target }: { target: { value?: string; files?: File[] } },
  ) =>
    act(() => {
      if (target.files)
        Object.defineProperty(element, "files", {
          value: target.files,
          configurable: true,
        });
      else
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )!.set!.call(element, target.value);
      element.dispatchEvent(
        new Event(target.files ? "change" : "input", { bubbles: true }),
      );
    }),
};
async function waitFor(check: () => unknown) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 100; attempt++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    try {
      return check();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
function within(scope: ParentNode) {
  const selectors: Record<string, string> = {
    button: "button",
    radio: '[role="radio"]',
    textbox:
      'input:not([type="file"]):not([type="hidden"]):not([type="radio"]),textarea',
    region: "section[aria-label]",
    alert: '[role="alert"]',
  };
  const accessibleName = (element: HTMLElement) => {
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy)
      return labelledBy
        .split(" ")
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" ");
    return (
      element.getAttribute("aria-label") ??
      (element.id
        ? document.querySelector<HTMLLabelElement>(`label[for="${element.id}"]`)
            ?.textContent
        : undefined) ??
      element.textContent ??
      ""
    );
  };
  const getAllByRole = (
    role: string,
    options: { name?: string | RegExp; exact?: boolean } = {},
  ) =>
    Array.from(
      scope.querySelectorAll<HTMLElement>(
        selectors[role] ?? `[role="${role}"]`,
      ),
    ).filter(
      (element) =>
        options.name === undefined ||
        (typeof options.name === "string"
          ? accessibleName(element) === options.name
          : options.name.test(accessibleName(element))),
    );
  const getByRole = (
    role: string,
    options?: { name?: string | RegExp; exact?: boolean },
  ) => {
    const matches = getAllByRole(role, options);
    if (matches.length !== 1)
      throw new Error(
        `Expected one ${role} ${String(options?.name)}, found ${matches.length}`,
      );
    return matches[0];
  };
  const queryByText = (text: string) =>
    Array.from(scope.querySelectorAll<HTMLElement>("*")).find(
      (element) =>
        element.textContent === text &&
        !Array.from(element.children).some(
          (child) => child.textContent === text,
        ),
    ) ?? null;
  const getByText = (text: string) => {
    const found = queryByText(text);
    if (!found) throw new Error(`Missing text: ${text}`);
    return found;
  };
  return {
    getByRole,
    getAllByRole,
    queryByRole: (role: string, options?: { name?: string | RegExp }) =>
      getAllByRole(role, options)[0] ?? null,
    getByText,
    queryByText,
    findByText: (text: string) => waitFor(() => getByText(text)),
    getByLabelText: (text: string) => {
      const label = Array.from(
        scope.querySelectorAll<HTMLLabelElement>("label"),
      ).find((element) => element.textContent === text);
      if (!label) throw new Error(`Missing label ${text}`);
      return document.getElementById(label.htmlFor)!;
    },
  };
}
const screen = within(document);

const labels = {
  ...{
    title: "Create design system",
    name: "Name",
    startFrom: "Start from",
    fresh: "Start fresh",
    freshDescription: "Shape a new design direction with the agent.",
    references: "References",
    referencesDescription: "Build from your files, Figma, or website.",
    continue: "Continue",
    back: "Back",
    cancel: "Cancel",
    create: "Create design system",
    addToSystem: "Add to system",
    add: "Add",
    added: "Added",
    website: "Website",
    files: "Brand files",
    figma: "Figma",
    websiteUrl: "Website URL",
    figmaUrl: "Figma file URL",
    chooseFiles: "Choose files",
    uploading: "Uploading…",
    pending: "Ready to add",
    retry: "Retry",
    submitting: "Saving…",
    remove: "Remove {{name}}",
    nameRequired: "Enter a name for your design system.",
    sourceRequired: "Add a reference and finish or remove pending files.",
    invalidWebsite: "Enter an http:// or https:// website URL.",
    invalidFigma: "Enter a valid Figma file or design URL.",
    unsupportedFile: "Choose Markdown, text, PDF, DOCX, PPTX, or an image.",
    emptyFile: "Empty files cannot be added.",
    uploadFailed: "Could not upload this file. Try again.",
    submitFailed: "Could not save. Your references are retained; try again.",
    editUnavailable: "This system cannot be edited.",
    fileTooLarge: "Choose files smaller than 20 MiB.",
  },
  remove: (name: string) => `Remove ${name}`,
};
const file = (name = "design.md") =>
  new File(["# Acme\nUse spacious layouts."], name, { type: "text/markdown" });
const uploaded = (
  name: string,
  path: string,
): DesignSystemFileUploadResult => ({
  name,
  mimeType: "text/markdown",
  size: file(name).size,
  handle: { kind: "stored-file", path },
});
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
function setup(props: Partial<DesignSystemCreationProps> = {}) {
  const callbacks = {
    onCreate: vi
      .fn()
      .mockResolvedValue({ systemId: "system-one", title: "Acme" }),
    onCreated: vi.fn(),
    onCancel: vi.fn(),
    onAddSources: vi.fn().mockResolvedValue(undefined),
    uploadFile: vi.fn(async (file: File) =>
      uploaded(file.name, `private-source:${file.name}`),
    ),
    ...props,
  };
  return {
    ...render(<DesignSystemCreation labels={labels} {...callbacks} />),
    callbacks,
  };
}
const click = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name, exact: true }));
const change = (name: string, value: string) =>
  fireEvent.change(screen.getByRole("textbox", { name, exact: true }), {
    target: { value },
  });
function references() {
  change("Name", "Acme");
  fireEvent.click(
    screen.getByRole("radio", { name: "References", exact: true }),
  );
  click("Continue");
}
function addUrl(kind: "Website" | "Figma", value: string) {
  const card = screen.getByRole("button", {
    name: new RegExp(`^${kind}(?:Added)?$`),
  });
  if (card.getAttribute("aria-expanded") !== "true") fireEvent.click(card);
  const region = screen.getByRole("region", { name: kind, exact: true });
  fireEvent.change(within(region).getByRole("textbox"), { target: { value } });
  fireEvent.click(
    within(region).getByRole("button", { name: "Add", exact: true }),
  );
}
function selectFiles(files: File[]) {
  const card = screen.getByRole("button", { name: /^Brand files/ });
  if (card.getAttribute("aria-expanded") !== "true") fireEvent.click(card);
  fireEvent.change(screen.getByLabelText("Choose files"), {
    target: { files },
  });
}
async function addFiles(files: File[]) {
  selectFiles(files);
  fireEvent.click(
    within(screen.getByRole("region", { name: "Brand files" })).getByRole(
      "button",
      { name: "Add", exact: true },
    ),
  );
  await waitFor(() => expect(screen.queryByText("Uploading…")).toBeNull());
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("shared design-system creation", () => {
  it("hands real popover focus to Name, traps dialog focus and focuses each newly mounted step", async () => {
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <TooltipProvider>
          <input aria-label="Original prompt" defaultValue="Keep this draft" />
          <ComposerContextMenu
            items={[
              {
                id: "systems",
                label: "Use a system",
                onSelect() {},
                render: (controls) => (
                  <Command>
                    <ComposerContextSearchInput onBack={controls.onBack} />
                    <CommandList>
                      <CommandItem
                        value="create-system"
                        onSelect={() => {
                          controls.onClose({ restoreFocus: false });
                          setOpen(true);
                        }}
                      >
                        Create
                      </CommandItem>
                    </CommandList>
                  </Command>
                ),
              },
            ]}
          />
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent aria-describedby={undefined}>
              <button type="button" onClick={() => setOpen(false)}>
                Return to prompt
              </button>
              <DialogTitle>{labels.title}</DialogTitle>
              <DesignSystemCreation
                labels={labels}
                onCreate={vi.fn()}
                onCancel={() => setOpen(false)}
                uploadFile={vi.fn()}
              />
            </DialogContent>
          </Dialog>
        </TooltipProvider>
      );
    }
    render(<Host />);
    click("Add context");
    fireEvent.click(document.querySelector('[data-value="systems"]')!);
    fireEvent.click(document.querySelector('[data-value="create-system"]')!);
    // Radix dispatches the outgoing scope's close autofocus after unmount.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const name = screen.getByRole("textbox", { name: "Name" });
    expect(document.activeElement).toBe(name);
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    const prompt = screen.getByRole("textbox", { name: "Original prompt" });
    const first = screen.getByRole("button", { name: "Return to prompt" });
    const last = within(dialog).getByRole("button", { name: "Close" });
    act(() => first.focus());
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(first);
    act(() => prompt.focus());
    expect(document.activeElement).toBe(first);
    references();
    const website = screen.getByRole("button", { name: "Website" });
    expect(document.activeElement).toBe(website);
    click("Website");
    const url = screen.getByRole("textbox", { name: "Website URL" });
    act(() => url.focus());
    change("Website URL", "https://draft.example.com");
    expect(document.activeElement).toBe(url);
    click("Back");
    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: "Name" }),
    );
    click("Continue");
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Website" }),
    );
    expect(
      (screen.getByRole("textbox", { name: "Website URL" }) as HTMLInputElement)
        .value,
    ).toBe("https://draft.example.com");
    click("Return to prompt");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    click("Add context");
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Add context" }),
    );
    expect((prompt as HTMLInputElement).value).toBe("Keep this draft");
  });

  it("keeps source category text wrappable and separates the added check from its label", async () => {
    setup();
    references();
    await addFiles([file()]);
    const card = screen.getByRole("button", { name: "Brand files" });
    const label = within(card).getByText("Brand files");
    expect(label.className).toContain("break-words");
    expect(label.className).not.toContain("truncate");
    expect(label.parentElement?.querySelector("svg")?.parentElement).not.toBe(
      label,
    );
    expect(card.querySelector("svg")?.parentElement?.contains(label)).toBe(
      false,
    );
  });

  it("keeps illustration, selected radio and fixed footer separate from scrollable fields", () => {
    setup();
    const fresh = screen.getByRole("radio", { name: "Start fresh" });
    const reference = screen.getByRole("radio", { name: "References" });
    expect(fresh.getAttribute("aria-checked")).toBe("true");
    expect(
      fresh.closest("label")?.querySelector('[aria-hidden="true"]'),
    ).toBeTruthy();
    fireEvent.click(reference);
    expect(reference.getAttribute("aria-checked")).toBe("true");
    expect(fresh.getAttribute("aria-checked")).toBe("false");
    const body = document.querySelector("[data-creation-body]")!;
    const footer = document.querySelector("[data-creation-footer]")!;
    expect(body.contains(footer)).toBe(false);
    expect(
      footer.contains(screen.getByRole("button", { name: "Continue" })),
    ).toBe(true);
  });

  it("distinguishes an open source editor from an added reference", () => {
    setup();
    references();
    const card = screen.getByRole("button", { name: "Website" });
    fireEvent.click(card);
    expect(card.getAttribute("aria-expanded")).toBe("true");
    expect(card.getAttribute("data-expanded")).toBe("true");
    expect(card.getAttribute("data-state")).toBe("empty");
    expect(card.querySelector("svg")).toBeNull();
    addUrl("Website", "https://example.com/brand");
    expect(card.getAttribute("data-state")).toBe("added");
    expect(card.querySelector("svg")).toBeTruthy();
    fireEvent.click(card);
    expect(card.getAttribute("aria-expanded")).toBe("false");
    expect(card.getAttribute("data-state")).toBe("added");
    click("Remove https://example.com/brand");
    expect(card.getAttribute("data-state")).toBe("empty");
  });

  it("browses through the real hidden file input and leaves unadded URL drafts out of submission", async () => {
    const { callbacks } = setup();
    references();
    click("Brand files");
    const input = screen.getByLabelText("Choose files") as HTMLInputElement;
    expect(input.hidden).toBe(true);
    const browse = vi.spyOn(input, "click");
    click("Choose files");
    expect(browse).toHaveBeenCalledOnce();
    addUrl("Website", "https://example.com/brand");
    change("Website URL", "unfinished URL draft");
    expect(input.closest("form")?.noValidate).toBe(true);
    click("Create design system");
    await waitFor(() => expect(callbacks.onCreated).toHaveBeenCalledOnce());
    expect(vi.mocked(callbacks.onCreate).mock.calls[0][0].sources).toHaveLength(
      1,
    );
  });

  it("starts with two real radio cards and persists a named fresh system once", async () => {
    const created = deferred<{ systemId: string }>();
    const { callbacks } = setup({ onCreate: vi.fn(() => created.promise) });
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Website" })).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    change("Name", " Acme ");
    click("Continue");
    fireEvent.submit(
      screen.getByRole("textbox", { name: "Name" }).closest("form")!,
    );
    expect(callbacks.onCreate).toHaveBeenCalledExactlyOnceWith({
      requestId: expect.any(String),
      name: "Acme",
      intent: "fresh",
      sources: [],
    });
    expect(callbacks.onCreated).not.toHaveBeenCalled();
    await act(async () => created.resolve({ systemId: "persisted-system" }));
    expect(callbacks.onCreated).toHaveBeenCalledWith("persisted-system", {
      systemId: "persisted-system",
    });
  });

  it("stages three kinds in inline editors, keeps drafts on Back and removes only one item", async () => {
    const { callbacks } = setup();
    references();
    expect(document.querySelectorAll("[data-source]")).toHaveLength(3);
    addUrl("Website", "https://example.com/brand");
    addUrl("Figma", "https://www.figma.com/design/ABC123/Brand");
    await addFiles([file(), file("logo.png")]);
    expect(screen.getAllByRole("region")).toHaveLength(3);
    expect(
      document.querySelector("[data-source=files]")?.getAttribute("data-state"),
    ).toBe("added");
    change("Website URL", "https://draft.example.com");
    click("Back");
    expect(
      (screen.getByRole("textbox", { name: "Name" }) as HTMLInputElement).value,
    ).toBe("Acme");
    click("Continue");
    expect(
      (screen.getByRole("textbox", { name: "Website URL" }) as HTMLInputElement)
        .value,
    ).toBe("https://draft.example.com");
    click("Remove logo.png");
    click("Create design system");
    await waitFor(() => expect(callbacks.onCreate).toHaveBeenCalledOnce());
    expect(callbacks.onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        sources: [
          expect.objectContaining({
            kind: "website",
            url: "https://example.com/brand",
          }),
          expect.objectContaining({
            kind: "figma",
            url: "https://www.figma.com/design/ABC123/Brand",
          }),
          expect.objectContaining({
            kind: "file",
            name: "design.md",
            handle: { kind: "stored-file", path: "private-source:design.md" },
          }),
        ],
      }),
    );
    expect(vi.mocked(callbacks.onCreate).mock.calls[0][0].sources).toHaveLength(
      3,
    );
  });

  it("does not check a file card before Add finishes a real upload", async () => {
    const pending = deferred<DesignSystemFileUploadResult>();
    setup({ uploadFile: vi.fn(() => pending.promise) });
    references();
    selectFiles([file()]);
    expect(
      document.querySelector("[data-source=files]")?.getAttribute("data-state"),
    ).toBe("empty");
    fireEvent.click(
      within(screen.getByRole("region", { name: "Brand files" })).getByRole(
        "button",
        { name: "Add" },
      ),
    );
    expect(screen.getByText("Uploading…")).toBeTruthy();
    expect(
      document.querySelector("[data-source=files]")?.getAttribute("data-state"),
    ).toBe("empty");
    await act(async () =>
      pending.resolve(uploaded("design.md", "private-source:one")),
    );
    expect(
      document.querySelector("[data-source=files]")?.getAttribute("data-state"),
    ).toBe("added");
    click("Remove design.md");
    expect(
      document.querySelector("[data-source=files]")?.getAttribute("data-state"),
    ).toBe("empty");
  });

  it("removing an uploading file aborts it and ignores late completion", async () => {
    const pending = deferred<DesignSystemFileUploadResult>();
    const upload = vi.fn(
      (_file: File, _options: { signal: AbortSignal }) => pending.promise,
    );
    setup({ uploadFile: upload });
    references();
    selectFiles([file()]);
    fireEvent.click(
      within(screen.getByRole("region", { name: "Brand files" })).getByRole(
        "button",
        { name: "Add" },
      ),
    );
    click("Remove design.md");
    expect(upload.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () =>
      pending.resolve(uploaded("design.md", "private-source:removed")),
    );
    expect(screen.queryByText("design.md")).toBeNull();
    expect(
      document.querySelector("[data-source=files]")?.getAttribute("data-state"),
    ).toBe("empty");
  });

  it("retains successful files and shows an individual failure that can be retried", async () => {
    const upload = vi
      .fn()
      .mockResolvedValueOnce(uploaded("design.md", "private-source:good"))
      .mockRejectedValueOnce(new Error("File connection interrupted"))
      .mockResolvedValueOnce(uploaded("guide.pdf", "private-source:retry"));
    const { callbacks } = setup({ uploadFile: upload });
    references();
    await addFiles([file(), file("guide.pdf")]);
    expect(screen.getByText("File connection interrupted")).toBeTruthy();
    expect(
      document.querySelector("[data-source=files]")?.getAttribute("data-state"),
    ).toBe("added");
    expect(
      (
        screen.getByRole("button", {
          name: "Create design system",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    click("Retry");
    await waitFor(() =>
      expect(screen.queryByText("File connection interrupted")).toBeNull(),
    );
    click("Create design system");
    await waitFor(() => expect(callbacks.onCreated).toHaveBeenCalledOnce());
    expect(upload).toHaveBeenCalledTimes(3);
  });

  it("validates unsupported, empty and oversized files individually without dropping accepted ones", async () => {
    const { callbacks } = setup();
    references();
    const huge = file("huge.pdf");
    Object.defineProperty(huge, "size", { value: 21 * 1024 * 1024 });
    selectFiles([file(), file("source.fig"), new File([], "empty.md"), huge]);
    fireEvent.click(
      within(screen.getByRole("region", { name: "Brand files" })).getByRole(
        "button",
        { name: "Add" },
      ),
    );
    await waitFor(() => expect(callbacks.uploadFile).toHaveBeenCalledOnce());
    expect(screen.getAllByRole("alert")).toHaveLength(3);
    expect(
      (screen.getByLabelText("Choose files") as HTMLInputElement).accept,
    ).not.toContain(".fig");
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    click("Remove source.fig");
    click("Remove empty.md");
    click("Remove huge.pdf");
    expect(
      document.querySelector("[data-source=files]")?.getAttribute("data-state"),
    ).toBe("added");
  });

  it("rejects non-website and non-Figma URLs without committing them", () => {
    setup();
    references();
    addUrl("Website", "javascript:alert(1)");
    addUrl("Figma", "https://example.com/design/ABC123/Fake");
    expect(screen.getAllByRole("alert")).toHaveLength(2);
    expect(
      document
        .querySelector("[data-source=website]")
        ?.getAttribute("data-state"),
    ).toBe("empty");
    expect(
      document.querySelector("[data-source=figma]")?.getAttribute("data-state"),
    ).toBe("empty");
  });

  it("keeps the same id for identical uncertain retries, rotates it after name/source changes", async () => {
    const create = vi.fn().mockRejectedValue(new Error("Timed out"));
    setup({ onCreate: create });
    references();
    addUrl("Website", "https://example.com/one");
    click("Create design system");
    await screen.findByText("Timed out");
    click("Create design system");
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create.mock.calls[0][0].requestId).toBe(
      create.mock.calls[1][0].requestId,
    );
    click("Back");
    change("Name", "Acme updated");
    click("Continue");
    addUrl("Figma", "https://figma.com/design/XYZ123/Brand");
    click("Create design system");
    await waitFor(() => expect(create).toHaveBeenCalledTimes(3));
    expect(create.mock.calls[2][0].requestId).not.toBe(
      create.mock.calls[1][0].requestId,
    );
    expect(create.mock.calls[2][0].name).toBe("Acme updated");
    expect(create.mock.calls[2][0].sources).toHaveLength(2);
  });

  it("uses Add to system and retains the batch when that callback fails", async () => {
    const add = vi
      .fn()
      .mockRejectedValueOnce(new Error("Revision changed"))
      .mockResolvedValue(undefined);
    const { callbacks } = setup({
      addingToSystemId: "existing-system",
      onAddSources: add,
    });
    expect(screen.queryByRole("textbox", { name: "Name" })).toBeNull();
    addUrl("Website", "https://example.com/brand");
    click("Add to system");
    await screen.findByText("Revision changed");
    expect(
      document
        .querySelector("[data-source=website]")
        ?.getAttribute("data-state"),
    ).toBe("added");
    click("Add to system");
    await waitFor(() => expect(add).toHaveBeenCalledTimes(2));
    expect(add.mock.calls[0][0]).toBe("existing-system");
    expect(add.mock.calls[1][1]).toEqual(add.mock.calls[0][1]);
    expect(callbacks.onCreate).not.toHaveBeenCalled();
  });

  it("isolates submit from the original portaled composer and preserves its draft", async () => {
    const parentSubmit = vi.fn();
    const parentKey = vi.fn();
    const portal = document.createElement("div");
    document.body.append(portal);
    const create = vi.fn().mockResolvedValue({ systemId: "one" });
    try {
      render(
        <form onSubmit={parentSubmit} onKeyDown={parentKey}>
          <input aria-label="Original prompt" defaultValue="Keep this prompt" />
          {createPortal(
            <DesignSystemCreation
              labels={labels}
              onCancel={vi.fn()}
              onCreate={create}
              uploadFile={vi.fn()}
            />,
            portal,
          )}
        </form>,
      );
      change("Name", "Acme");
      fireEvent.keyDown(screen.getByRole("textbox", { name: "Name" }), {
        key: "Enter",
      });
      fireEvent.submit(portal.querySelector("form")!);
      await waitFor(() => expect(create).toHaveBeenCalledOnce());
      expect(parentSubmit).not.toHaveBeenCalled();
      expect(parentKey).not.toHaveBeenCalled();
      expect(
        (
          screen.getByRole("textbox", {
            name: "Original prompt",
          }) as HTMLInputElement
        ).value,
      ).toBe("Keep this prompt");
    } finally {
      portal.remove();
    }
  });
});
