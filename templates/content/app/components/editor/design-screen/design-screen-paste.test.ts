// @vitest-environment happy-dom

import type { DesignScreenData } from "@shared/design-screen-block";
import { nfmToDoc } from "@shared/nfm";
import { Editor } from "@tiptap/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AnalyticsChartPasteContext } from "../analytics-chart/analytics-chart-paste";
import { createVisualEditorExtensions } from "../VisualEditor";
import type { DesignScreenPasteContext } from "./design-screen-paste";

const hooks = vi.hoisted(() => ({ callAction: vi.fn() }));

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  callAction: hooks.callAction,
}));

const toasts = vi.hoisted(() => ({
  loading: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: toasts }));

const LINK = "https://design.example.test/design/checkout?screen=pay";
const BOARD_LINK = "https://design.example.test/design/checkout";

const screen: DesignScreenData = {
  design: {
    id: "checkout",
    title: "Checkout",
    url: "https://design.example.test/design/checkout",
    visibility: "org",
  },
  screen: {
    id: "pay",
    name: "Pay",
    width: 390,
    fingerprint: "0123456789ab",
    url: LINK,
  },
  image: {
    src: "/api/private-media/0f8fad5b-d9cb-469f-a165-70867728950e",
    width: 780,
    height: 1688,
    alt: "The Pay screen from the Checkout design in Design, at 390 pixels wide.",
  },
  capturedAt: "2026-11-20T16:40:00.000Z",
  capturedBy: "Ada",
};

let editor: Editor | null = null;
let context: DesignScreenPasteContext;
let analyticsContext: AnalyticsChartPasteContext;

function open(nfm: string) {
  editor = new Editor({
    extensions: createVisualEditorExtensions({
      documentId: "doc_1",
      analyticsChartPaste: () => analyticsContext,
      designScreenPaste: () => context,
    }),
    content: nfmToDoc(nfm),
  });
  return editor;
}

function paste(target: Editor, text: string) {
  const event = {
    clipboardData: {
      getData: (type: string) => (type === "text/plain" ? text : ""),
      files: [],
      types: ["text/plain"],
    },
    preventDefault: () => undefined,
  } as unknown as ClipboardEvent;
  target.view.pasteText(text, event);
}

function blocks(target: Editor) {
  const found: Array<{ type: string; text: string; raw?: string }> = [];
  target.state.doc.forEach((node) => {
    found.push({
      type:
        node.type.name === "registryBlock"
          ? `registryBlock:${node.attrs.blockType}`
          : node.type.name,
      text: node.textContent,
      ...(node.type.name === "registryBlock" ? { raw: node.attrs.__raw } : {}),
    });
  });
  return found;
}

async function settle() {
  for (let i = 0; i < 5; i++) {
    // fixed-sleep-ok: lets the paste's queued action call settle; no event marks it, and a link left alone has none
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function caretAtEnd(target: Editor) {
  target.commands.setTextSelection(target.state.doc.content.size - 1);
}

beforeEach(() => {
  hooks.callAction.mockReset();
  for (const fn of Object.values(toasts)) fn.mockReset();
  context = {
    documentId: "doc_1",
    canEdit: true,
    linkOrigins: ["https://design.example.test"],
    t: (key) => key,
  };
  analyticsContext = {
    documentId: "doc_1",
    canEdit: true,
    linkOrigins: ["https://analytics.example.test"],
    t: (key) => key,
  };
});

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("pasting a Design screen link", () => {
  it("swaps a link on its own line for the pinned screen", async () => {
    hooks.callAction.mockResolvedValue({
      status: "captured",
      blockId: "design-screen-1a2b3c4d",
      screen,
    });
    const target = open("Before.\n\n");
    caretAtEnd(target);
    target.commands.splitBlock();
    paste(target, LINK);
    await settle();

    expect(hooks.callAction).toHaveBeenCalledTimes(1);
    expect(hooks.callAction).toHaveBeenCalledWith("capture-design-screen", {
      documentId: "doc_1",
      designId: "checkout",
      screenId: "pay",
      purpose: "insert",
    });
    const after = blocks(target);
    expect(after.some((block) => block.text.includes(LINK))).toBe(false);
    const pinned = after.find(
      (block) => block.type === "registryBlock:design-screen",
    );
    expect(pinned?.raw).toContain('id="design-screen-1a2b3c4d"');
    expect(pinned?.raw).toContain("/api/private-media/");
    expect(toasts.loading).toHaveBeenCalledWith("designScreen.adding", {
      id: expect.any(String),
    });
    expect(toasts.success).toHaveBeenCalledWith("designScreen.added", {
      id: expect.any(String),
    });
  });

  it("keeps the sentence a link was pasted into and adds the screen after it", async () => {
    hooks.callAction.mockResolvedValue({
      status: "captured",
      blockId: "design-screen-1a2b3c4d",
      screen,
    });
    const target = open("See ");
    caretAtEnd(target);
    paste(target, LINK);
    await settle();

    const after = blocks(target);
    const sentence = after.findIndex((block) => block.text.includes(LINK));
    expect(sentence).toBeGreaterThanOrEqual(0);
    expect(after[sentence + 1]?.type).toBe("registryBlock:design-screen");
  });

  it("leaves a whole board's link, and links from anywhere else, as links", async () => {
    const target = open("See ");
    caretAtEnd(target);
    paste(target, BOARD_LINK);
    paste(target, "https://evil.example/design/checkout?screen=pay");
    await settle();
    expect(hooks.callAction).not.toHaveBeenCalled();
  });

  it("does nothing while suggesting or for a reader", async () => {
    context = { ...context, canEdit: false };
    const target = open("See ");
    caretAtEnd(target);
    paste(target, LINK);
    await settle();
    expect(hooks.callAction).not.toHaveBeenCalled();
    expect(blocks(target)[0]?.text).toContain(LINK);
  });

  it("keeps the link when Design refuses, and says why", async () => {
    hooks.callAction.mockRejectedValue(
      Object.assign(new Error("Something went wrong. Try again."), {
        errorCode: "design_refused",
      }),
    );
    const target = open("See ");
    caretAtEnd(target);
    paste(target, LINK);
    await settle();
    expect(blocks(target)[0]?.text).toContain(LINK);
    expect(toasts.error).toHaveBeenCalledWith("designScreen.addFailed", {
      id: expect.any(String),
      description: "designScreen.errorRefused",
    });
  });

  it("asks before pinning a screen more people would see, then pins on yes", async () => {
    hooks.callAction.mockResolvedValueOnce({
      status: "needs_confirmation",
      blockId: "design-screen-1a2b3c4d",
      design: { title: "Checkout" },
    });
    const target = open("See ");
    caretAtEnd(target);
    paste(target, LINK);
    await settle();
    expect(blocks(target).map((block) => block.type)).not.toContain(
      "registryBlock:design-screen",
    );
    expect(toasts.warning).toHaveBeenCalledTimes(1);
    const [message, options] = toasts.warning.mock.calls[0] as [
      string,
      { id: string; action: { label: string; onClick: () => void } },
    ];
    expect(message).toBe("designScreen.confirmWider");
    expect(options.action.label).toBe("designScreen.addAnyway");

    hooks.callAction.mockResolvedValueOnce({
      status: "captured",
      blockId: "design-screen-1a2b3c4d",
      screen,
    });
    options.action.onClick();
    await settle();
    expect(hooks.callAction).toHaveBeenLastCalledWith(
      "capture-design-screen",
      expect.objectContaining({ acknowledgeWiderAudience: true }),
    );
    expect(blocks(target).map((block) => block.type)).toContain(
      "registryBlock:design-screen",
    );
    const [, pinned] = toasts.success.mock.calls[0] as [string, { id: string }];
    expect(pinned.id).not.toBe(options.id);
  });

  it("asks Design nothing more when the link is gone or the page closed by the time the person says yes", async () => {
    hooks.callAction.mockResolvedValue({
      status: "needs_confirmation",
      blockId: "design-screen-1a2b3c4d",
      design: { title: "Checkout" },
    });
    const first = open("See ");
    caretAtEnd(first);
    paste(first, LINK);
    await settle();
    const [, removed] = toasts.warning.mock.calls[0] as [
      string,
      { action: { onClick: () => void } },
    ];
    first.chain().selectAll().deleteSelection().run();
    removed.action.onClick();
    await settle();
    expect(hooks.callAction).toHaveBeenCalledTimes(1);

    first.destroy();
    const second = open("See ");
    caretAtEnd(second);
    paste(second, LINK);
    await settle();
    const [, closed] = toasts.warning.mock.calls[1] as [
      string,
      { action: { onClick: () => void } },
    ];
    second.destroy();
    editor = null;
    closed.action.onClick();
    await settle();
    expect(hooks.callAction).toHaveBeenCalledTimes(2);
  });

  it("stops quietly when the link goes or the page closes while Design is answering", async () => {
    let answer: (value: unknown) => void = () => undefined;
    let refuse: (error: unknown) => void = () => undefined;
    hooks.callAction
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answer = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            refuse = reject;
          }),
      );
    const first = open("See ");
    caretAtEnd(first);
    paste(first, LINK);
    await settle();
    first.chain().selectAll().deleteSelection().run();
    answer({
      status: "needs_confirmation",
      blockId: "design-screen-1a2b3c4d",
      design: { title: "Checkout" },
    });
    await settle();
    expect(toasts.warning).not.toHaveBeenCalled();
    expect(toasts.dismiss).toHaveBeenCalledTimes(1);

    first.destroy();
    const second = open("See ");
    caretAtEnd(second);
    paste(second, LINK);
    await settle();
    second.destroy();
    editor = null;
    refuse(new Error("Design didn't answer."));
    await settle();
    expect(toasts.error).not.toHaveBeenCalled();
    expect(toasts.dismiss).toHaveBeenCalledTimes(2);
  });

  it("leaves an Analytics panel link to Analytics", async () => {
    hooks.callAction.mockResolvedValue({
      status: "needs_confirmation",
      blockId: "analytics-chart-1a2b3c4d",
      chart: { dashboard: { title: "Growth" } },
    });
    const target = open("See ");
    caretAtEnd(target);
    paste(target, "https://analytics.example.test/dashboards/growth?tile=wau");
    await settle();
    expect(hooks.callAction).toHaveBeenCalledTimes(1);
    expect(hooks.callAction).toHaveBeenCalledWith(
      "capture-analytics-chart",
      expect.anything(),
    );
  });
});
