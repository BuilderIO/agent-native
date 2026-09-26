// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  readPendingDesignImport,
  clearPendingDesignImport,
} from "@/lib/pending-import";

import { HomeImportButton } from "./HomeImportButton";

const mocks = vi.hoisted(() => ({
  importFrame: vi.fn(),
  create: vi.fn(),
  navigate: vi.fn(),
  settings: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  useActionMutation: (name: string) => ({
    mutateAsync:
      name === "import-figma-frame" ? mocks.importFrame : mocks.create,
  }),
  actionErrorMessage: (error: unknown) =>
    error instanceof Error
      ? error.message.replace(/^Action failed: /, "")
      : undefined,
}));
vi.mock("@agent-native/core/client/command-navigation", () => ({
  openAgentSettings: (...args: unknown[]) => mocks.settings(...args),
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("react-router", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("sonner", () => ({
  toast: { success: mocks.success, warning: mocks.warning, error: mocks.error },
}));
vi.mock("@/lib/figma-connection", () => ({
  FIGMA_ACCESS_TOKEN_SECRET_KEY: "FIGMA_ACCESS_TOKEN",
}));
vi.mock("@/components/ui/input", () => ({
  Input: ({
    onChange,
    ...props
  }: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input
      {...props}
      onInput={onChange as React.FormEventHandler<HTMLInputElement>}
    />
  ),
}));

let root: Root;
let container: HTMLDivElement;
const figmaUrl =
  "https://www.figma.com/design/example-file/Example?node-id=1-2";
async function click(text: string) {
  const button = Array.from(
    document.querySelectorAll<HTMLElement>('button, [role="menuitem"]'),
  ).find((button) => button.textContent === text);
  expect(button).toBeTruthy();
  await act(async () => button!.click());
}
async function typeUrl() {
  const input = document.querySelector<HTMLInputElement>('input[type="url"]')!;
  await act(async () => {
    input.value = figmaUrl;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function openMenu() {
  const trigger = document.querySelector<HTMLButtonElement>(
    '[aria-label="home.importOptions"]',
  )!;
  await act(async () =>
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    ),
  );
}
async function openLink() {
  await openMenu();
  await click("home.figmaLink");
  await vi.waitFor(() =>
    expect(document.querySelector('input[type="url"]')).toBeTruthy(),
  );
}
async function chooseFile(file?: File) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  await act(async () => {
    Object.defineProperty(input, "files", {
      configurable: true,
      value: file ? [file] : [],
    });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function submit() {
  await act(async () =>
    document
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}
beforeEach(async () => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  mocks.create.mockResolvedValue({ id: "file-design" });
  mocks.importFrame.mockResolvedValue({
    designId: "imported-design",
    files: [{ id: "screen", filename: "frame.html" }],
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<HomeImportButton />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.replaceChildren();
  clearPendingDesignImport("file-design");
  vi.restoreAllMocks();
});

describe("home Figma import", () => {
  it("opens the OS picker directly with only .fig accepted and no intermediary dialog", async () => {
    const input =
      document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const picker = vi.spyOn(input, "click");
    await click("home.import");
    expect(picker).toHaveBeenCalledOnce();
    expect(input.accept).toBe(".fig");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelector('[role="menu"]')).toBeNull();
    await chooseFile();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.importFrame).not.toHaveBeenCalled();
  });
  it("uses the same picker from the typed dropdown action", async () => {
    const picker = vi.spyOn(
      document.querySelector<HTMLInputElement>('input[type="file"]')!,
      "click",
    );
    await openMenu();
    expect(
      Array.from(
        document.querySelectorAll('[role="menuitem"]'),
        (item) => item.textContent,
      ),
    ).toEqual(["home.figmaFile", "home.figmaLink"]);
    expect(
      Array.from(
        document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
      ).every((item) => !item.querySelector("svg")),
    ).toBe(true);
    await click("home.figmaFile");
    expect(picker).toHaveBeenCalledOnce();
    expect(document.querySelector('input[type="url"]')).toBeNull();
  });
  it("does not provision, create, or import on mount, open, or cancel", async () => {
    await openLink();
    await typeUrl();
    await click("home.cancel");
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.importFrame).not.toHaveBeenCalled();
    expect(mocks.settings).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
  it("imports into an explicit new target and navigates only after saved files return", async () => {
    let resolve!: (value: unknown) => void;
    mocks.importFrame.mockReturnValue(
      new Promise((yes) => {
        resolve = yes;
      }),
    );
    await openLink();
    await typeUrl();
    await submit();
    expect(mocks.importFrame).toHaveBeenCalledExactlyOnceWith({
      figmaUrl,
      createNew: true,
    });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
    await act(async () =>
      resolve({
        designId: "imported-design",
        files: [{ id: "screen", filename: "frame.html" }],
      }),
    );
    expect(mocks.navigate).toHaveBeenCalledWith("/design/imported-design");
  });
  it("retains the URL and readable provider failure for retry and offers existing settings", async () => {
    mocks.importFrame.mockRejectedValueOnce(
      new Error("Action failed: Figma token cannot read this file"),
    );
    await openLink();
    await typeUrl();
    await submit();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "Figma token cannot read this file",
    );
    expect(
      document.querySelector<HTMLInputElement>('input[type="url"]')?.value,
    ).toBe(figmaUrl);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
    await click("settings.openAgentSettings");
    expect(mocks.settings).toHaveBeenCalledWith("secrets:FIGMA_ACCESS_TOKEN");
    await openLink();
    expect(
      document.querySelector<HTMLInputElement>('input[type="url"]')?.value,
    ).toBe(figmaUrl);
    await submit();
    expect(mocks.navigate).toHaveBeenCalledWith("/design/imported-design");
  });
  it("keeps partial/malformed success in the popover instead of navigating", async () => {
    mocks.importFrame.mockResolvedValue({
      designId: "missing-files",
      files: [],
    });
    await openLink();
    await typeUrl();
    await submit();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')).toBeTruthy();
  });
  it("hands the exact selected file directly to a new design's existing import panel", async () => {
    const file = new File(["test fixture"], "example.fig");
    await chooseFile(file);
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
      title: "example",
      projectType: "prototype",
      designSystemId: null,
    });
    expect(mocks.importFrame).not.toHaveBeenCalled();
    expect(readPendingDesignImport("file-design")).toEqual({
      kind: "file",
      file,
    });
    expect(mocks.navigate).toHaveBeenCalledWith(
      "/design/file-design?panel=import",
    );
  });
  it("rejects non-.fig files before creation and offers an explicit retry after an authenticated create failure", async () => {
    await chooseFile(new File(["invalid"], "example.pdf"));
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledWith(
      "designEditor.import.errors.invalidFigFile",
    );
    mocks.create.mockRejectedValueOnce(new Error("Sign in required"));
    const file = new File(["fixture"], "example.fig");
    await chooseFile(file);
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(readPendingDesignImport("file-design")).toBeUndefined();
    const retry = mocks.error.mock.lastCall?.[1]?.action.onClick;
    expect(retry).toBeTypeOf("function");
    await act(async () => retry());
    expect(readPendingDesignImport("file-design")?.file).toBe(file);
    expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith(
      "/design/file-design?panel=import",
    );
  });
});
