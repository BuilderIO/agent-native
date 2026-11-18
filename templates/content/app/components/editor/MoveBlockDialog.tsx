import {
  actionErrorMessage,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { deleteBlockTransaction } from "@agent-native/toolkit/editor";
import { docToNfm } from "@shared/nfm";
import { IconFileText } from "@tabler/icons-react";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useContentActionMutation } from "@/hooks/use-content-action-mutation";
import { useContentRecent } from "@/hooks/use-content-recent";
import { useContentSpaces } from "@/hooks/use-content-spaces";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { documentQueryFilter } from "@/lib/document-query";

import {
  contentSpaceForStoredSelection,
  SELECTED_CONTENT_SPACE_STORAGE_KEY,
} from "../sidebar/select-content-space";
import { SidebarRowIcon } from "../sidebar/SidebarNavigationRow";
import { LOCAL_FILE_USER_EDIT_META } from "./extensions/LocalMdxComponentNode";

// Long enough to reach Open once the picker closes.
const MOVED_TOAST_MS = 10_000;

interface MovingBlock {
  /** Where the block is now, or null where an edit took its place. */
  find: () => number | null;
  node: ProseMirrorNode;
  stop: () => void;
}

interface MoveTarget {
  id: string;
  title: string;
  icon: string | null;
  context: string | null;
}

/**
 * Follows a block while it moves. Its place maps through each change, and a
 * change that replaces the whole page, as a collaborator's can, still finds
 * the block when it alone is the same node. An edited block is a new node, so
 * it is found nowhere.
 */
function followBlock(
  editor: Editor,
  pos: number,
  node: ProseMirrorNode,
): MovingBlock {
  let at: number | null = pos;
  const map = ({ transaction }: { transaction: Transaction }) => {
    if (at === null) return;
    const mapped = transaction.mapping.mapResult(at, 1);
    at = mapped.deleted ? null : mapped.pos;
  };
  editor.on("transaction", map);
  return {
    node,
    find: () => {
      const { doc } = editor.state;
      if (at !== null && doc.nodeAt(at) === node) return at;
      const found: number[] = [];
      doc.descendants((child, offset) => {
        if (child === node) found.push(offset);
        return found.length < 2;
      });
      return found.length === 1 ? found[0] : null;
    },
    stop: () => editor.off("transaction", map),
  };
}

// A video's id names it on its own page, where its comments stay, so its copy
// on another page goes without one.
function withoutVideoIds(
  json: Record<string, unknown>,
): Record<string, unknown> {
  const attrs = json.attrs as Record<string, unknown> | undefined;
  const content = json.content as Record<string, unknown>[] | undefined;
  return {
    ...json,
    ...(json.type === "video" && attrs
      ? { attrs: { ...attrs, blockId: null } }
      : {}),
    ...(content ? { content: content.map(withoutVideoIds) } : {}),
  };
}

/** The block as the page it moves to stores it. */
export function movedBlockNfm(node: ProseMirrorNode): string {
  return docToNfm({ type: "doc", content: [withoutVideoIds(node.toJSON())] });
}

/**
 * The block menu's Move to: a page picker, then the block added to the end of
 * that page and removed here. A block edited while it moves stays here, so
 * nothing anyone typed is lost.
 */
export function useMoveBlock(editor: Editor, documentId?: string | null) {
  const [moving, setMoving] = useState<MovingBlock | null>(null);
  const movingRef = useRef(moving);
  movingRef.current = moving;

  useEffect(() => () => movingRef.current?.stop(), []);

  const start = useCallback(
    (block: { pos: number; node: ProseMirrorNode }) => {
      movingRef.current?.stop();
      setMoving(followBlock(editor, block.pos, block.node));
    },
    [editor],
  );

  const dialog = moving ? (
    <MoveBlockDialog
      editor={editor}
      block={moving}
      documentId={documentId ?? null}
      onClose={() => {
        setMoving(null);
      }}
    />
  ) : null;

  return { start, dialog };
}

function MoveBlockDialog({
  editor,
  block,
  documentId,
  onClose,
}: {
  editor: Editor;
  block: MovingBlock;
  documentId: string | null;
  onClose: () => void;
}) {
  const t = useT();
  const navigate = useNavigate();
  const searchRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const timeout = window.setTimeout(() => setQuery(search.trim()), 150);
    return () => window.clearTimeout(timeout);
  }, [search]);

  const spaces = useContentSpaces();
  const [storedSpaceId] = useLocalStorage<string | null>(
    SELECTED_CONTENT_SPACE_STORAGE_KEY,
    null,
  );
  const space = contentSpaceForStoredSelection({
    spaces: spaces.data?.spaces ?? [],
    storedSpaceId,
  });
  const recent = useContentRecent(space?.id, {
    enabled: query === "" && Boolean(space),
  });
  const results = useActionQuery(
    "search-documents",
    { query, searchFields: "title", documentType: "page", limit: 20 },
    { enabled: query !== "" },
  );
  const append = useContentActionMutation<
    { documentId: string; title: string },
    { documentId: string; content: string }
  >("append-to-document", {
    invalidates: (_data, variables) => [
      documentQueryFilter(variables.documentId),
    ],
  });

  const targets: MoveTarget[] =
    query === ""
      ? (recent.data?.entries ?? [])
          // A saved view is a collection's, which takes no blocks.
          .filter((entry) => !entry.target.viewId)
          .map((entry) => ({
            id: entry.target.documentId,
            title: entry.title,
            icon: entry.icon,
            context: null,
          }))
      : (
          (
            results.data as
              | {
                  documents?: Array<{
                    id: string;
                    title: string;
                    icon: string | null;
                    parentTitle: string | null;
                  }>;
                }
              | undefined
          )?.documents ?? []
        ).map((document) => ({
          id: document.id,
          title: document.title,
          icon: document.icon,
          context: document.parentTitle,
        }));
  const loading = query === "" ? recent.isLoading : results.isLoading;
  const choices = targets.filter((target) => target.id !== documentId);

  const finish = () => {
    block.stop();
    onClose();
  };

  const moveTo = (target: MoveTarget) => {
    onClose();
    const title = target.title || t("sidebar.untitled");
    if (block.find() === null) {
      block.stop();
      toast.error(t("editor.blockMenu.moveChanged"));
      return;
    }
    const open = {
      label: t("editor.blockMenu.openPage"),
      onClick: () => void navigate(`/page/${target.id}`),
    };
    const toastId = toast.loading(t("editor.blockMenu.movingTo", { title }));
    append
      .mutateAsync({
        documentId: target.id,
        content: movedBlockNfm(block.node),
      })
      .then(
        () => {
          // A page left meanwhile keeps the block, so the move is a copy.
          const at = editor.isDestroyed ? null : block.find();
          if (at !== null) {
            const tr = deleteBlockTransaction(editor.state, at, block.node);
            editor.view.dispatch(tr.setMeta(LOCAL_FILE_USER_EDIT_META, true));
          }
          // The page can refuse the removal, which leaves the block found.
          const moved = at !== null && block.find() === null;
          toast.success(
            t(
              moved ? "editor.blockMenu.movedTo" : "editor.blockMenu.copiedTo",
              {
                title,
              },
            ),
            { id: toastId, action: open, duration: MOVED_TOAST_MS },
          );
        },
        (error: unknown) => {
          toast.error(t("editor.blockMenu.moveFailed", { title }), {
            id: toastId,
            description:
              actionErrorMessage(error) ??
              (error instanceof Error
                ? error.message
                : t("empty.genericError")),
          });
        },
      )
      .finally(block.stop);
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) finish();
      }}
    >
      <DialogContent
        className="gap-0 overflow-hidden p-0 sm:max-w-md"
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          searchRef.current?.focus();
        }}
        // Focus goes back to the page, near the block, not to the grip.
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (!editor.isDestroyed) editor.view.focus();
        }}
      >
        <div className="px-4 pt-4 pb-2 pe-12">
          <DialogTitle className="truncate text-sm font-medium">
            {t("editor.blockMenu.moveToTitle")}
          </DialogTitle>
        </div>
        <Command shouldFilter={false} className="rounded-none">
          <CommandInput
            ref={searchRef}
            value={search}
            onValueChange={setSearch}
            placeholder={t("sidebar.searchPages")}
            aria-label={t("sidebar.searchPages")}
          />
          <CommandList className="max-h-80">
            {!loading ? (
              <CommandEmpty>{t("sidebar.noMatchingPages")}</CommandEmpty>
            ) : null}
            <CommandGroup
              heading={
                query === "" && choices.length > 0
                  ? t("sidebar.recent")
                  : undefined
              }
            >
              {choices.map((target) => (
                <CommandItem
                  key={target.id}
                  value={target.id}
                  onSelect={() => moveTo(target)}
                  className="gap-2"
                >
                  <SidebarRowIcon
                    icon={
                      target.icon || (
                        <IconFileText className="size-4 text-muted-foreground" />
                      )
                    }
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {target.title || t("sidebar.untitled")}
                  </span>
                  {target.context ? (
                    <span className="max-w-[40%] truncate text-xs text-muted-foreground">
                      {target.context}
                    </span>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
