import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { toast } from "sonner";

export interface SourceLinkPasteContext {
  documentId: string;
  canEdit: boolean;
  linkOrigins: readonly string[];
  t: (key: string, options?: Record<string, unknown>) => string;
}

export interface SourceLinkPasteOptions {
  getContext: () => SourceLinkPasteContext | null;
}

export type SourceLinkCapture =
  | { status: "captured"; blockId: string; raw: string }
  | { status: "needs_confirmation"; message: string };

export interface SourceLinkPasteSpec<Request> {
  name: string;
  blockType: string;
  parse: (text: string, origins: readonly string[]) => Request | null;
  capture: (
    context: SourceLinkPasteContext,
    request: Request,
    acknowledgeWiderAudience: boolean,
  ) => Promise<SourceLinkCapture>;
  describeError?: (
    error: unknown,
    t: SourceLinkPasteContext["t"],
  ) => string | undefined;
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
    const blockText = doc.textBetween(
      blockStart,
      blockStart + node.content.size,
      undefined,
      "￼",
    );
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

export function createSourceLinkPaste<Request>(
  spec: SourceLinkPasteSpec<Request>,
) {
  const pendingKey = new PluginKey<PendingLinks>(`${spec.name}PendingLinks`);

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

  function openLinkRange(editor: Editor, id: string) {
    return editor.isDestroyed ? null : pendingLinkRange(editor.state, id);
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
    if (!openLinkRange(editor, id)) {
      remember(editor, { remove: id });
      return;
    }
    const { t } = context;
    const toastId = `${spec.blockType}-${id}${acknowledgeWiderAudience ? "-acknowledged" : ""}`;
    toast.loading(t(spec.messages.adding), { id: toastId });
    try {
      const result = await spec.capture(
        context,
        request,
        acknowledgeWiderAudience,
      );
      const range = openLinkRange(editor, id);
      if (!range) {
        remember(editor, { remove: id });
        toast.dismiss(toastId);
        return;
      }
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
      remember(editor, { remove: id });
      const replaced = replaceLinkWithBlock(editor, range, {
        blockType: spec.blockType,
        blockId: result.blockId,
        raw: result.raw,
      });
      if (replaced) toast.success(t(spec.messages.added), { id: toastId });
      else toast.error(t(spec.messages.addFailed), { id: toastId });
    } catch (error) {
      const linkGone = !openLinkRange(editor, id);
      remember(editor, { remove: id });
      if (linkGone) {
        toast.dismiss(toastId);
        return;
      }
      toast.error(t(spec.messages.addFailed), {
        id: toastId,
        description: spec.describeError
          ? spec.describeError(error, t)
          : error instanceof Error
            ? error.message
            : undefined,
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
