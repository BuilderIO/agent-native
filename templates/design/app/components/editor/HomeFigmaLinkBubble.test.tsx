// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { extractFigmaLink, type FigmaLink } from "@/lib/figma-url";

import { HomeFigmaLinkBubble } from "./HomeFigmaLinkBubble";

const mocks = vi.hoisted(() => ({
  importFrame: vi.fn(),
  navigate: vi.fn(),
  settings: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  useActionMutation: () => ({ mutateAsync: mocks.importFrame }),
  actionErrorMessage: (error: unknown) =>
    error instanceof Error
      ? error.message.replace(/^Action failed: /, "")
      : undefined,
}));
vi.mock("@agent-native/toolkit/app/shared", () => ({
  openAgentSettings: (...args: unknown[]) => mocks.settings(...args),
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
  useFormatters: () => ({ formatNumber: String }),
}));
vi.mock("react-router", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("sonner", () => ({
  toast: {
    success: mocks.success,
    warning: mocks.warning,
    error: mocks.error,
  },
}));
vi.mock("@/lib/figma-connection", () => ({
  FIGMA_ACCESS_TOKEN_SECRET_KEY: "FIGMA_ACCESS_TOKEN",
}));
vi.mock("./FigmaLinkComposerBubble", () => ({
  getFigmaFileTitle: () => "Example",
}));

const figmaUrl =
  "https://www.figma.com/design/example-file/Example?node-id=1-2";
let root: Root;
let container: HTMLDivElement;

function figmaLink(): FigmaLink {
  const link = extractFigmaLink(`Import ${figmaUrl}`);
  if (!link) throw new Error("Figma link was not detected");
  return link;
}
function button(text: string) {
  const match = Array.from(document.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === text,
  );
  if (!match) throw new Error(`Button ${text} is missing`);
  return match;
}
async function click(text: string) {
  await act(async () => button(text).click());
}

beforeEach(async () => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  mocks.importFrame.mockResolvedValue({
    designId: "imported-design",
    files: [{ id: "screen", filename: "frame.html" }],
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(<HomeFigmaLinkBubble link={figmaLink()} />),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("Figma link in the home composer", () => {
  it("names the file and imports nothing until confirmed", () => {
    expect(container.textContent).toContain("Example");
    expect(mocks.importFrame).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("imports into a new design and navigates only after saved files return", async () => {
    let resolve!: (value: unknown) => void;
    mocks.importFrame.mockReturnValue(
      new Promise((yes) => {
        resolve = yes;
      }),
    );
    await click("home.import");
    expect(mocks.importFrame).toHaveBeenCalledExactlyOnceWith({
      figmaUrl,
      createNew: true,
    });
    expect(button("home.import").disabled).toBe(true);
    expect(mocks.navigate).not.toHaveBeenCalled();
    await act(async () =>
      resolve({
        designId: "imported-design",
        files: [{ id: "screen", filename: "frame.html" }],
      }),
    );
    expect(mocks.success).toHaveBeenCalledOnce();
    expect(mocks.navigate).toHaveBeenCalledWith("/design/imported-design");
  });

  it("warns when the import contains rasterized or approximated layers", async () => {
    mocks.importFrame.mockResolvedValue({
      designId: "imported-design",
      files: [{ id: "screen", filename: "frame.html" }],
      fidelityReport: {
        exactCount: 0,
        imageFallbacks: [
          { nodeId: "1:2", nodeType: "VECTOR", notes: ["Rendered as PNG."] },
        ],
        approximated: [
          { nodeId: "1:3", nodeType: "TEXT", notes: ["Style approximated."] },
        ],
      },
    });
    await click("home.import");
    expect(mocks.warning).toHaveBeenCalledExactlyOnceWith(
      "Imported frame.html.",
      {
        description:
          "designEditor.import.figmaImageFallbackWarning\ndesignEditor.import.figmaApproximationWarning",
      },
    );
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledWith("/design/imported-design");
  });

  it("shows a readable provider failure, offers agent settings, and retries", async () => {
    mocks.importFrame.mockRejectedValueOnce(
      new Error("Action failed: Figma token cannot read this file"),
    );
    await click("home.import");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Figma token cannot read this file",
    );
    expect(mocks.navigate).not.toHaveBeenCalled();
    await click("settings.openAgentSettings");
    expect(mocks.settings).toHaveBeenCalledWith("secrets:FIGMA_ACCESS_TOKEN");
    await click("home.import");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(mocks.navigate).toHaveBeenCalledWith("/design/imported-design");
  });

  it("keeps a partial or malformed result as an error instead of navigating", async () => {
    mocks.importFrame.mockResolvedValue({
      designId: "missing-files",
      files: [],
    });
    await click("home.import");
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "designEditor.import.errors.figmaImportFailed",
    );
  });
});
