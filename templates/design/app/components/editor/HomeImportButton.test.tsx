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
  toast: { success: mocks.success, warning: mocks.warning },
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
  const button = Array.from(document.querySelectorAll("button")).find(
    (button) => button.textContent === text,
  );
  expect(button).toBeTruthy();
  await act(async () => button!.click());
}
async function typeUrl() {
  const input = document.querySelector<HTMLInputElement>("#home-figma-url")!;
  await act(async () => {
    input.value = figmaUrl;
    input.dispatchEvent(new Event("input", { bubbles: true }));
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
});

describe("home Figma import", () => {
  it("does not provision, create, or import on mount, open, or cancel", async () => {
    await click("home.importFromFigma");
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
    await click("home.importFromFigma");
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
    await click("home.importFromFigma");
    await typeUrl();
    await submit();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "Figma token cannot read this file",
    );
    expect(
      document.querySelector<HTMLInputElement>("#home-figma-url")?.value,
    ).toBe(figmaUrl);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
    await click("settings.openAgentSettings");
    expect(mocks.settings).toHaveBeenCalledWith("secrets:FIGMA_ACCESS_TOKEN");
    await click("home.importFromFigma");
    expect(
      document.querySelector<HTMLInputElement>("#home-figma-url")?.value,
    ).toBe(figmaUrl);
    await submit();
    expect(mocks.navigate).toHaveBeenCalledWith("/design/imported-design");
  });
  it("keeps partial/malformed success in the dialog instead of navigating", async () => {
    mocks.importFrame.mockResolvedValue({
      designId: "missing-files",
      files: [],
    });
    await click("home.importFromFigma");
    await typeUrl();
    await submit();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')).toBeTruthy();
  });
  it("labels the .fig fallback Open import and hands the exact file to the existing panel", async () => {
    await click("home.importFromFigma");
    const file = new File(["test fixture"], "example.fig");
    const input = document.querySelector<HTMLInputElement>("#home-figma-file")!;
    await act(async () => {
      Object.defineProperty(input, "files", { value: [file] });
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(document.querySelector('button[type="submit"]')?.textContent).toBe(
      "home.openImport",
    );
    await submit();
    expect(mocks.importFrame).not.toHaveBeenCalled();
    expect(readPendingDesignImport("file-design")).toEqual({
      kind: "file",
      file,
    });
    expect(mocks.navigate).toHaveBeenCalledWith(
      "/design/file-design?panel=import",
    );
  });
});
