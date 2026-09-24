// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

const warnings = vi.hoisted(() => ({
  value: [
    "33 images could not be loaded without a Figma access token. Connect Figma to fill them in.",
  ] as string[],
}));
const toastCalls = vi.hoisted(() => ({
  warning: [] as string[],
  error: [] as Array<{ title: string; options?: Record<string, unknown> }>,
}));
const callAction = vi.hoisted(() => vi.fn());

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    info: vi.fn(),
    success: vi.fn(),
    error: (title: string, options?: Record<string, unknown>) =>
      toastCalls.error.push({ title, options }),
    dismiss: vi.fn(),
    loading: vi.fn(() => "toast-id"),
    warning: (title: string) => {
      toastCalls.warning.push(title);
    },
  }),
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  callAction,
}));

const saved = vi.hoisted(() => ({
  value: null as Record<string, unknown> | null,
}));
callAction.mockImplementation(
  async () =>
    saved.value ?? {
      designId: "d1",
      strategy: "localKiwi",
      unresolvedImages: 33,
      files: [{ id: "f1" }],
      warnings: warnings.value,
    },
);
vi.mock("@/lib/figma-clipboard", () => ({
  resolveFigmaPasteImportCall: () => ({ action: "import-figma-clipboard" }),
}));
vi.mock("@/lib/design-import", () => ({
  importResultSummary: () => "Imported",
}));

const { runImportFigmaClipboardIntoDesign } =
  await import("./import-figma-clipboard-into-design.js");

function args(
  showPastedImagesNotice: (a: unknown) => void,
  navigate = vi.fn(),
  overrides: Record<string, unknown> = {},
) {
  return {
    canEditDesign: true,
    figmaPasteImportingRef: { current: false },
    id: "d1",
    boardFileId: "board",
    insertPasteLayers: vi.fn(() => true),
    navigate,
    queryClient: { invalidateQueries: vi.fn() },
    resolvePasteScene: () => ({ container: null, viewport: null, screens: [] }),
    showPastedImagesNotice,
    t: (key: string) => key,
    ...overrides,
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

  it("focuses the first imported screen in the overview", async () => {
    const navigate = vi.fn();
    await runImportFigmaClipboardIntoDesign(
      args(vi.fn(), navigate),
      "<figmeta>",
    );

    expect(navigate).toHaveBeenCalledWith(
      "/design/d1?editorView=overview&screen=f1",
    );
  });

  it("keeps the overview route when the first imported file has no id", async () => {
    saved.value = {
      designId: "d1",
      files: [{ id: "", filename: "pasted.html" }],
      warnings: [],
    };
    const navigate = vi.fn();

    await runImportFigmaClipboardIntoDesign(
      args(vi.fn(), navigate),
      "<figmeta>",
    );
    saved.value = null;

    expect(navigate).toHaveBeenCalledWith("/design/d1?editorView=overview");
  });
});

describe("a Figma paste placed inside the canvas", () => {
  const layer = {
    title: "Vector",
    width: 10,
    height: 10,
    content:
      '<html><body><div style="width:10px"><svg data-agent-native-layer-name="Vector"></svg></div></body></html>',
    wrapsLooseNode: true,
    origin: { x: 0, y: 0 },
    sourceOffset: { x: 5, y: 6 },
  };
  const scene = { container: null, viewport: null, screens: [] };

  it("sends the scene once and inserts where the plan says, without adding a screen", async () => {
    callAction.mockClear();
    callAction.mockResolvedValueOnce({
      layers: [layer],
      plan: {
        kind: "layers",
        fileId: "s1",
        selector: '[data-agent-native-node-id="card"]',
        positions: [{ x: 5, y: 6 }],
      },
      warnings: [],
    });
    const insertPasteLayers = vi.fn(() => true);
    const navigate = vi.fn();

    await runImportFigmaClipboardIntoDesign(
      args(vi.fn(), navigate, {
        insertPasteLayers,
        resolvePasteScene: () => scene,
      }),
      "<figmeta>",
    );

    expect(callAction).toHaveBeenCalledTimes(1);
    expect(callAction.mock.calls[0]![1]).toMatchObject({ pasteScene: scene });
    expect(insertPasteLayers).toHaveBeenCalledWith(
      "s1",
      '[data-agent-native-node-id="card"]',
      [expect.objectContaining({ position: { x: 5, y: 6 } })],
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  it("inserts a board plan into the board file", async () => {
    callAction.mockClear();
    callAction.mockResolvedValueOnce({
      layers: [layer],
      plan: { kind: "board", positions: [{ x: 45, y: 45 }] },
      warnings: [],
    });
    const insertPasteLayers = vi.fn(() => true);

    await runImportFigmaClipboardIntoDesign(
      args(vi.fn(), vi.fn(), { insertPasteLayers }),
      "<figmeta>",
    );

    expect(callAction).toHaveBeenCalledTimes(1);
    expect(insertPasteLayers).toHaveBeenCalledWith("board", null, [
      expect.objectContaining({ position: { x: 45, y: 45 } }),
    ]);
  });
});

describe("Figma paste access failures", () => {
  it("localizes a missing Figma token instead of showing the action error", async () => {
    toastCalls.error.length = 0;
    callAction.mockRejectedValueOnce(
      Object.assign(new Error("No Figma token is available"), {
        errorCode: "figma_auth_required",
        statusCode: 401,
      }),
    );

    await runImportFigmaClipboardIntoDesign(args(vi.fn()), "<figmeta>");

    expect(
      toastCalls.error[toastCalls.error.length - 1]?.options?.description,
    ).toBe("designEditor.import.figmaPasteApiKeyHint");
  });

  it("localizes a Figma file permission denial", async () => {
    toastCalls.error.length = 0;
    callAction.mockRejectedValueOnce(
      Object.assign(new Error("Figma nodes request failed: Forbidden"), {
        errorCode: "figma_request_failed",
        statusCode: 403,
        details: { figmaStatus: 403 },
      }),
    );

    await runImportFigmaClipboardIntoDesign(args(vi.fn()), "<figmeta>");

    expect(
      toastCalls.error[toastCalls.error.length - 1]?.options?.description,
    ).toBe("designEditor.import.figmaPasteAccessDenied");
  });

  it("keeps typed access details when the action resolves with an error result", async () => {
    toastCalls.error.length = 0;
    callAction.mockResolvedValueOnce({
      error: "No Figma token is available",
      errorCode: "figma_auth_required",
      statusCode: 401,
    });

    await runImportFigmaClipboardIntoDesign(args(vi.fn()), "<figmeta>");

    expect(
      toastCalls.error[toastCalls.error.length - 1]?.options?.description,
    ).toBe("designEditor.import.figmaPasteApiKeyHint");
  });
});
