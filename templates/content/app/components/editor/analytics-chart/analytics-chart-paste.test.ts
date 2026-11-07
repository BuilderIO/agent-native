// @vitest-environment happy-dom

import type { AnalyticsChartData } from "@shared/analytics-chart-block";
import { nfmToDoc } from "@shared/nfm";
import { Editor } from "@tiptap/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createVisualEditorExtensions } from "../VisualEditor";
import type { AnalyticsChartPasteContext } from "./analytics-chart-paste";

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

const LINK =
  "https://analytics.example.test/dashboards/growth?f_timeRange=90d&tile=wau";

const chart: AnalyticsChartData = {
  dashboard: {
    id: "growth",
    title: "Growth",
    url: "https://analytics.example.test/dashboards/growth",
    visibility: "org",
  },
  panel: {
    id: "wau",
    title: "Weekly active users",
    type: "line",
    fingerprint: "0123456789ab",
    url: "https://analytics.example.test/dashboards/growth?tile=wau",
  },
  filters: { timeRange: "90d" },
  columns: ["week", "Users"],
  rows: [["2026-10-05", 120]],
  series: [{ label: "Users" }],
  truncated: false,
  capturedAt: "2026-11-07T16:40:00.000Z",
};

let editor: Editor | null = null;
let context: AnalyticsChartPasteContext;

function open(nfm: string) {
  editor = new Editor({
    extensions: createVisualEditorExtensions({
      documentId: "doc_1",
      analyticsChartPaste: () => context,
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
    linkOrigins: ["https://analytics.example.test"],
    t: (key) => key,
  };
});

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("pasting an Analytics panel link", () => {
  it("swaps a link on its own line for the panel's chart", async () => {
    hooks.callAction.mockResolvedValue({
      status: "captured",
      blockId: "analytics-chart-1a2b3c4d",
      chart,
    });
    const target = open("Before.\n\n");
    target.commands.setTextSelection(target.state.doc.content.size - 1);
    target.commands.splitBlock();
    paste(target, LINK);
    await settle();

    expect(hooks.callAction).toHaveBeenCalledWith("capture-analytics-chart", {
      documentId: "doc_1",
      dashboardId: "growth",
      panelId: "wau",
      filters: { timeRange: "90d" },
      purpose: "insert",
    });
    const after = blocks(target);
    expect(after.some((block) => block.text.includes(LINK))).toBe(false);
    const chartBlock = after.find(
      (block) => block.type === "registryBlock:analytics-chart",
    );
    expect(chartBlock?.raw).toContain('id="analytics-chart-1a2b3c4d"');
    expect(chartBlock?.raw).toContain("Weekly active users");
    expect(toasts.success).toHaveBeenCalledWith("analyticsChart.added", {
      id: expect.any(String),
    });
  });

  it("keeps the sentence a link was pasted into and adds the chart after it", async () => {
    hooks.callAction.mockResolvedValue({
      status: "captured",
      blockId: "analytics-chart-1a2b3c4d",
      chart,
    });
    const target = open("See ");
    caretAtEnd(target);
    paste(target, LINK);
    await settle();

    const after = blocks(target);
    const sentence = after.findIndex((block) => block.text.includes(LINK));
    expect(sentence).toBeGreaterThanOrEqual(0);
    expect(after[sentence + 1]?.type).toBe("registryBlock:analytics-chart");
  });

  it("leaves other links alone", async () => {
    const target = open("See ");
    caretAtEnd(target);
    paste(target, "https://evil.example/dashboards/growth?tile=wau");
    paste(target, "https://analytics.example.test/dashboards/growth");
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

  it("keeps the link when Analytics refuses, and says why", async () => {
    hooks.callAction.mockRejectedValue(new Error("Dashboard not found"));
    const target = open("See ");
    caretAtEnd(target);
    paste(target, LINK);
    await settle();
    expect(blocks(target).map((block) => block.type)).not.toContain(
      "registryBlock:analytics-chart",
    );
    expect(blocks(target)[0]?.text).toContain(LINK);
    expect(toasts.error).toHaveBeenCalledWith("analyticsChart.addFailed", {
      id: expect.any(String),
      description: "Dashboard not found",
    });
  });

  it("asks before adding numbers more people would see, then adds on yes", async () => {
    hooks.callAction.mockResolvedValueOnce({
      status: "needs_confirmation",
      blockId: "analytics-chart-1a2b3c4d",
      chart,
    });
    const target = open("See ");
    caretAtEnd(target);
    paste(target, LINK);
    await settle();
    expect(blocks(target).map((block) => block.type)).not.toContain(
      "registryBlock:analytics-chart",
    );
    expect(toasts.warning).toHaveBeenCalledTimes(1);
    const [, options] = toasts.warning.mock.calls[0] as [
      string,
      { action: { onClick: () => void } },
    ];

    hooks.callAction.mockResolvedValueOnce({
      status: "captured",
      blockId: "analytics-chart-1a2b3c4d",
      chart,
    });
    options.action.onClick();
    await settle();
    expect(hooks.callAction).toHaveBeenLastCalledWith(
      "capture-analytics-chart",
      expect.objectContaining({ acknowledgeWiderAudience: true }),
    );
    expect(blocks(target).map((block) => block.type)).toContain(
      "registryBlock:analytics-chart",
    );
  });

  it("leaves the page alone when the link was edited while Analytics answered", async () => {
    let answer: (value: unknown) => void = () => undefined;
    hooks.callAction.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const target = open("See ");
    caretAtEnd(target);
    paste(target, LINK);
    await settle();
    // Delete the link's last character.
    const end = target.state.selection.from;
    target.view.dispatch(target.state.tr.delete(end - 1, end));
    answer({ status: "captured", blockId: "analytics-chart-1a2b3c4d", chart });
    await settle();
    expect(blocks(target).map((block) => block.type)).not.toContain(
      "registryBlock:analytics-chart",
    );
    expect(toasts.dismiss).toHaveBeenCalled();
  });
});
