import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { toast } from "sonner";

export interface SourceLinkPasteContext {
  documentId: string;
  /** False for readers and while suggesting: the paste stays a link. */
  canEdit: boolean;
  /** The source app's origins whose links turn into blocks. */
  linkOrigins: readonly string[];
  t: (key: string, options?: Record<string, unknown>) => string;
}

export interface SourceLinkPasteOptions {
  getContext: () => SourceLinkPasteContext | null;
}

/** What the source app sent back for a pasted link. */
export type SourceLinkCapture =
  | { status: "captured"; blockId: string; raw: string }
  | { status: "needs_confirmation"; message: string };

export interface SourceLinkPasteSpec<Request> {
  /** The extension's name, such as `analyticsChartPaste`. */
  name: string;
  /** The block the link turns into, such as `analytics-chart`. */
  blockType: string;
  /** The request a paste names, when it is exactly one link to the source. */
  parse: (text: string, origins: readonly string[]) => Request | null;
  /** Asks the source app for the block, as the editor pasting. */
  capture: (
    context: SourceLinkPasteContext,
    request: Request,
    acknowledgeWiderAudience: boolean,
  ) => Promise<SourceLinkCapture>;
  /** The message keys for the toasts while it's added. */
  messages: {
    adding: string;
    added: string;
    addFailed: string;
    addAnyway: string;
    keepLink: string;
  };
}

type PendingLinks = Map<string, { from: number; to: number; text: string }>;

type PendingMeta =
  | { add: { id: string; from: number; to: number; text: string } }
  | { remove: string };

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

/**
 * Puts the block where its link was: in place of the paragraph when the link
 * is all it holds, otherwise after that paragraph, leaving the sentence.
 */
export function replaceLinkWithBlock(
  editor: Editor,
  range: { from: number; to: number },
  block: { blockType: string; blockId: string; raw: string },
): boolean {
  const { doc } = editor.state;
  const $from = doc.resolve(range.from);
  const parent = $from.parent;
  const depth = $from.depth;
  const start = $from.before(depth);
  const end = $from.after(depth);
  const node = {
    type: "registryBlock",
    attrs: {
      blockType: block.blockType,
      blockId: block.blockId,
      title: null,
      summary: null,
      __raw: block.raw,
    },
  };
  const onlyTheLink =
    parent.type.name === "paragraph" &&
    parent.textContent.trim() === doc.textBetween(range.from, range.to).trim();
  return editor
    .chain()
    .insertContentAt(onlyTheLink ? { from: start, to: end } : end, node)
    .run();
}

/**
 * Pasting a link to one resource in another app (an Analytics panel, a
 * Design screen) into a page an editor can change pastes the link as usual,
 * then asks that app for the resource as that editor and swaps the link for
 * its block. Runs before Content's other paste handling, and changes nothing
 * about the paste itself: if the app refuses, the link stays.
 */
export function createSourceLinkPaste<Request>(
  spec: SourceLinkPasteSpec<Request>,
) {
  const pendingKey = new PluginKey<PendingLinks>(`${spec.name}PendingLinks`);

  /** Where a pasted link is now, if its text is still there unchanged. */
  function pendingLinkRange(
    state: EditorState,
    id: string,
  ): { from: number; to: number } | null {
    const pending = pendingKey.getState(state)?.get(id);
    if (!pending || pending.to > state.doc.content.size) return null;
    return state.doc.textBetween(pending.from, pending.to) === pending.text
      ? { from: pending.from, to: pending.to }
      : null;
  }

  function remember(editor: Editor, meta: PendingMeta) {
    if (editor.isDestroyed) return;
    editor.view.dispatch(
      editor.state.tr.setMeta(pendingKey, meta).setMeta("addToHistory", false),
    );
  }

  async function captureIntoPage(
    editor: Editor,
    id: string,
    request: Request,
    context: SourceLinkPasteContext,
    acknowledgeWiderAudience = false,
  ): Promise<void> {
    const { t } = context;
    const toastId = `${spec.blockType}-${id}`;
    toast.loading(t(spec.messages.adding), { id: toastId });
    try {
      const result = await spec.capture(
        context,
        request,
        acknowledgeWiderAudience,
      );
      if (editor.isDestroyed) return;
      if (result.status === "needs_confirmation") {
        toast.warning(result.message, {
          id: toastId,
          duration: Infinity,
          action: {
            label: t(spec.messages.addAnyway),
            onClick: () =>
              void captureIntoPage(editor, id, request, context, true),
          },
          cancel: {
            label: t(spec.messages.keepLink),
            onClick: () => remember(editor, { remove: id }),
          },
        });
        return;
      }
      const range = pendingLinkRange(editor.state, id);
      remember(editor, { remove: id });
      // The link was edited or removed while the app answered: leave it.
      if (!range) {
        toast.dismiss(toastId);
        return;
      }
      replaceLinkWithBlock(editor, range, {
        blockType: spec.blockType,
        blockId: result.blockId,
        raw: result.raw,
      });
      toast.success(t(spec.messages.added), { id: toastId });
    } catch (error) {
      remember(editor, { remove: id });
      toast.error(t(spec.messages.addFailed), {
        id: toastId,
        description: error instanceof Error ? error.message : undefined,
      });
    }
  }

  return Extension.create<SourceLinkPasteOptions>({
    name: spec.name,
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
                view.state.selection.$from.parent.type.spec.code ||
                context.linkOrigins.length === 0
              ) {
                return false;
              }
              const text = event.clipboardData?.getData("text/plain").trim();
              if (!text) return false;
              const request = spec.parse(text, context.linkOrigins);
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
                remember(editor, { add: { id, ...range, text } });
                void captureIntoPage(editor, id, request, context);
              }, 0);
              return false;
            },
          },
        }),
      ];
    },
  });
}
