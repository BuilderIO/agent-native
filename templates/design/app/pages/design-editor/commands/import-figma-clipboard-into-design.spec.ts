import { describe, expect, it, vi } from "vitest";

const warnings = vi.hoisted(() => ({
  value: [
    "33 images could not be loaded without a Figma access token. Connect Figma to fill them in.",
  ] as string[],
}));
const toastCalls = vi.hoisted(() => ({ warning: [] as string[] }));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    dismiss: vi.fn(),
    loading: vi.fn(() => "toast-id"),
    warning: (title: string) => {
      toastCalls.warning.push(title);
    },
  }),
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: vi.fn(async () => ({
    designId: "d1",
    strategy: "localKiwi",
    unresolvedImages: 33,
    files: [{ id: "f1" }],
    warnings: warnings.value,
  })),
}));
vi.mock("@/lib/figma-clipboard", () => ({
  resolveFigmaPasteImportCall: () => ({ action: "import-figma-clipboard" }),
}));
vi.mock("@/lib/design-import", () => ({
  importResultSummary: () => "Imported",
}));

const { runImportFigmaClipboardIntoDesign } =
  await import("./import-figma-clipboard-into-design.js");

function args(showPastedImagesNotice: (a: unknown) => void) {
  return {
    canEditDesign: true,
    figmaPasteImportingRef: { current: false },
    id: "d1",
    navigate: vi.fn(),
    queryClient: { invalidateQueries: vi.fn() },
    showPastedImagesNotice,
    t: (key: string) => key,
  } as never;
}

describe("a paste whose images could not come through", () => {
  it("hands the count and files to the notice", async () => {
    const notice = vi.fn();
    await runImportFigmaClipboardIntoDesign(args(notice), "<figmeta>");
    expect(notice).toHaveBeenCalledWith({ count: 33, fileIds: ["f1"] });
  });

  it("does not also raise the server's wording as a warning toast", async () => {
    toastCalls.warning.length = 0;
    await runImportFigmaClipboardIntoDesign(args(vi.fn()), "<figmeta>");
    expect(toastCalls.warning).toEqual([]);
  });

  it("still raises a warning that is about something else", async () => {
    toastCalls.warning.length = 0;
    warnings.value = ["The selection was truncated."];
    await runImportFigmaClipboardIntoDesign(args(vi.fn()), "<figmeta>");
    expect(toastCalls.warning).toEqual(["designEditor.import.warningsToast"]);
  });
});
