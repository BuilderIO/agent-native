import { callAction } from "@agent-native/core/client/hooks";
import {
  parseAnalyticsPanelLink,
  type AnalyticsPanelCaptureRequest,
} from "@agent-native/core/shared";
import {
  ANALYTICS_CHART_BLOCK_TYPE,
  analyticsChartBlockRaw,
  type AnalyticsChartData,
} from "@shared/analytics-chart-block";
import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { toast } from "sonner";

export interface AnalyticsChartPasteContext {
  documentId: string;
  /** False for readers and while suggesting: the paste stays a link. */
  canEdit: boolean;
  /** Analytics origins whose panel links turn into charts. */
  linkOrigins: readonly string[];
  t: (key: string, options?: Record<string, unknown>) => string;
}

export interface AnalyticsChartPasteOptions {
  getContext: () => AnalyticsChartPasteContext | null;
}

type CaptureResult =
  | {
      status: "captured";
      blockId: string;
      chart: AnalyticsChartData;
    }
  | {
      status: "needs_confirmation";
      blockId: string;
      chart: AnalyticsChartData;
    };

type PendingLinks = Map<string, { from: number; to: number; text: string }>;

const pendingKey = new PluginKey<PendingLinks>("analyticsChartPendingLinks");

type PendingMeta =
  | { add: { id: string; from: number; to: number; text: string } }
  | { remove: string };

/** The panel a paste names, when it is exactly one Analytics panel link. */
export function analyticsPanelLinkFromPaste(
  text: string,
  origins: readonly string[],
): AnalyticsPanelCaptureRequest | null {
  if (origins.length === 0) return null;
  return parseAnalyticsPanelLink(text, origins);
}

/**
 * Where a just-pasted link landed between the paste point and the cursor
 * after it, so stray whitespace or a trailing newline in the clipboard
 * doesn't lose it. Looks inside one text block at a time.
 */
export function findPastedLink(
  state: EditorState,
  from: number,
  to: number,
  text: string,
): { from: number; to: number } | null {
  const { doc } = state;
  const start = Math.max(0, Math.min(from, to));
  const end = Math.min(doc.content.size, Math.max(from, to));
  let found: { from: number; to: number } | null = null;
  doc.nodesBetween(start, end, (node, pos) => {
    if (found) return false;
    if (!node.isTextblock) return true;
    const blockStart = pos + 1;
    // One character per inline leaf keeps offsets equal to positions.
    const blockText = doc.textBetween(
      blockStart,
      blockStart + node.content.size,
      undefined,
      "￼",
    );
    // The last copy that ends by the cursor and starts after the paste point.
    const limit = Math.min(blockText.length, end - blockStart) - text.length;
    const index = limit < 0 ? -1 : blockText.lastIndexOf(text, limit);
    if (index >= 0 && blockStart + index >= start) {
      found = {
        from: blockStart + index,
        to: blockStart + index + text.length,
      };
    }
    return false;
  });
  return found;
}

/** Where a pasted link is now, if its text is still there unchanged. */
export function pendingLinkRange(
  state: EditorState,
  id: string,
): { from: number; to: number } | null {
  const pending = pendingKey.getState(state)?.get(id);
  if (!pending || pending.to > state.doc.content.size) return null;
  return state.doc.textBetween(pending.from, pending.to) === pending.text
    ? { from: pending.from, to: pending.to }
    : null;
}

/**
 * Puts the chart where its link was: in place of the paragraph when the link
 * is all it holds, otherwise after that paragraph, leaving the sentence.
 */
export function replaceLinkWithChart(
  editor: Editor,
  range: { from: number; to: number },
  blockId: string,
  chart: AnalyticsChartData,
): boolean {
  const { doc } = editor.state;
  const $from = doc.resolve(range.from);
  const parent = $from.parent;
  const depth = $from.depth;
  const start = $from.before(depth);
  const end = $from.after(depth);
  const block = {
    type: "registryBlock",
    attrs: {
      blockType: ANALYTICS_CHART_BLOCK_TYPE,
      blockId,
      title: null,
      summary: null,
      __raw: analyticsChartBlockRaw(blockId, chart),
    },
  };
  const onlyTheLink =
    parent.type.name === "paragraph" &&
    parent.textContent.trim() === doc.textBetween(range.from, range.to).trim();
  return editor
    .chain()
    .insertContentAt(onlyTheLink ? { from: start, to: end } : end, block)
    .run();
}

function track(editor: Editor, meta: PendingMeta) {
  if (editor.isDestroyed) return;
  editor.view.dispatch(
    editor.state.tr.setMeta(pendingKey, meta).setMeta("addToHistory", false),
  );
}

async function captureIntoPage(
  editor: Editor,
  id: string,
  request: AnalyticsPanelCaptureRequest,
  context: AnalyticsChartPasteContext,
  acknowledgeWiderAudience = false,
): Promise<void> {
  const { t, documentId } = context;
  const toastId = `analytics-chart-${id}`;
  toast.loading(t("analyticsChart.adding"), { id: toastId });
  try {
    const result = (await callAction("capture-analytics-chart", {
      documentId,
      ...request,
      purpose: "insert",
      ...(acknowledgeWiderAudience ? { acknowledgeWiderAudience } : {}),
    })) as CaptureResult;
    if (editor.isDestroyed) return;
    if (result.status === "needs_confirmation") {
      toast.warning(
        t("analyticsChart.confirmWider", {
          dashboard: result.chart.dashboard.title,
        }),
        {
          id: toastId,
          duration: Infinity,
          action: {
            label: t("analyticsChart.addAnyway"),
            onClick: () =>
              void captureIntoPage(editor, id, request, context, true),
          },
          cancel: {
            label: t("analyticsChart.keepLink"),
            onClick: () => track(editor, { remove: id }),
          },
        },
      );
      return;
    }
    const range = pendingLinkRange(editor.state, id);
    track(editor, { remove: id });
    // The link was edited or removed while Analytics answered: leave it.
    if (!range) {
      toast.dismiss(toastId);
      return;
    }
    replaceLinkWithChart(editor, range, result.blockId, result.chart);
    toast.success(t("analyticsChart.added"), { id: toastId });
  } catch (error) {
    track(editor, { remove: id });
    toast.error(t("analyticsChart.addFailed"), {
      id: toastId,
      description: error instanceof Error ? error.message : undefined,
    });
  }
}

/**
 * Pasting an Analytics panel link (Copy link on a dashboard panel) into a
 * page an editor can change pastes the link as usual, then asks Analytics
 * for the panel's numbers as that editor and swaps the link for the chart.
 * Runs before Content's other paste handling, and changes nothing about the
 * paste itself: if Analytics refuses, the link stays.
 */
export const AnalyticsChartPaste = Extension.create<AnalyticsChartPasteOptions>(
  {
    name: "analyticsChartPaste",
    priority: 1000,
    addOptions() {
      return { getContext: () => null };
    },
    addProseMirrorPlugins() {
      const editor = this.editor;
      const options = this.options;
      return [
        new Plugin<PendingLinks>({
          key: pendingKey,
          state: {
            init: () => new Map(),
            apply(tr, value) {
              const meta = tr.getMeta(pendingKey) as PendingMeta | undefined;
              let next = value;
              if (tr.docChanged && value.size > 0) {
                next = new Map(
                  [...value].map(([id, link]) => [
                    id,
                    {
                      ...link,
                      from: tr.mapping.map(link.from, 1),
                      to: tr.mapping.map(link.to, -1),
                    },
                  ]),
                );
              }
              if (meta && "add" in meta) {
                next = new Map(next);
                const { id, ...link } = meta.add;
                next.set(id, link);
              } else if (meta && "remove" in meta) {
                next = new Map(next);
                next.delete(meta.remove);
              }
              return next;
            },
          },
          props: {
            handlePaste(view, event) {
              const context = options.getContext();
              if (
                !context?.canEdit ||
                !view.editable ||
                view.state.selection.$from.parent.type.spec.code
              ) {
                return false;
              }
              const text = event.clipboardData?.getData("text/plain").trim();
              if (!text) return false;
              const request = analyticsPanelLinkFromPaste(
                text,
                context.linkOrigins,
              );
              if (!request) return false;
              const from = view.state.selection.from;
              const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
              // Let the paste land, then remember where the link went.
              setTimeout(() => {
                if (editor.isDestroyed) return;
                const range = findPastedLink(
                  editor.state,
                  from,
                  editor.state.selection.to,
                  text,
                );
                if (!range) return;
                track(editor, { add: { id, ...range, text } });
                void captureIntoPage(editor, id, request, context);
              }, 0);
              return false;
            },
          },
        }),
      ];
    },
  },
);
