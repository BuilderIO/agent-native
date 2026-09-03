import {
  IconChevronRight,
  IconFile,
  IconFolder,
  IconFolderOpen,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../components/ui/tooltip.js";
import { cn } from "../../utils.js";
import { ltrCodeBlockProps } from "../code-block-direction.js";
import type { BlockEditProps, BlockReadProps } from "../types.js";
import { DevInput, DevTextarea, DevSelect } from "./dev-doc-ui.js";
import type {
  FileTreeChange,
  FileTreeData,
  FileTreeEntry,
} from "./file-tree.config.js";
import { FILE_TREE_CHANGES } from "./file-tree.config.js";

/**
 * Read + Edit renderers for a `file-tree` block — a VS Code / GitHub-explorer
 * file and change tree. Lives in core so any app can register the dev-doc block
 * (no shadcn import; the editor's enum picker is the core `DevSelect`).
 */

/* ── Theme-aware change tokens ─────────────────────────────────────────────── */

/**
 * Change-badge palette. Tinted background + saturated text in BOTH the `.dark`
 * plan theme and light mode (never a dark-only palette). Each entry keeps legible
 * contrast against the plan surface via Tailwind `dark:` variants.
 */
const CHANGE_BADGE: Record<FileTreeChange, string> = {
  added:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  modified: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  removed: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  renamed:
    "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
};

/** Single-letter glyph shown in the change badge (VS Code gutter convention). */
const CHANGE_GLYPH: Record<FileTreeChange, string> = {
  added: "A",
  modified: "M",
  removed: "D",
  renamed: "R",
};

/** Accent ink for the file name itself, echoing its change color. */
const CHANGE_NAME_INK: Record<FileTreeChange, string> = {
  added: "text-emerald-700 dark:text-emerald-300",
  modified: "text-blue-700 dark:text-blue-300",
  removed: "text-red-600 line-through dark:text-red-300",
  renamed: "text-violet-700 dark:text-violet-300",
};

const CHANGE_LABEL: Record<FileTreeChange, string> = {
  added: "Added",
  modified: "Modified",
  removed: "Removed",
  renamed: "Renamed",
};

/** Infer a fence language for a file's snippet from its `language` or extension. */
function fenceLanguage(entry: FileTreeEntry): string {
  if (entry.language?.trim()) return entry.language.trim();
  const ext = entry.path.split(".").pop()?.toLowerCase() ?? "";
  const byExt: Record<string, string> = {
    ts: "ts",
    tsx: "tsx",
    js: "js",
    jsx: "jsx",
    mjs: "js",
    cjs: "js",
    json: "json",
    css: "css",
    scss: "scss",
    html: "html",
    md: "md",
    mdx: "md",
    py: "python",
    rb: "ruby",
    go: "go",
    rs: "rust",
    sql: "sql",
    sh: "bash",
    yml: "yaml",
    yaml: "yaml",
    toml: "toml",
  };
  return byExt[ext] ?? "text";
}

/** Wrap a raw snippet in a fenced code block for `ctx.renderMarkdown`. */
function fence(snippet: string, language: string): string {
  // Never let the snippet's own content break out of the fence.
  const safe = snippet.replace(/```/g, "ʼʼʼ");
  return `\`\`\`${language}\n${safe.replace(/\s+$/, "")}\n\`\`\``;
}

/* ── Tree construction (flat paths → nested folders) ───────────────────────── */

interface FileLeaf {
  kind: "file";
  /** Last path segment. */
  name: string;
  /** Full slash path, used as a stable key + anchor. */
  path: string;
  entry: FileTreeEntry;
  /** Index in the original flat `entries` (stable per-file disclosure key). */
  index: number;
}

interface FolderNode {
  kind: "folder";
  name: string;
  /** Full slash path of the folder, used as a stable key. */
  path: string;
  children: TreeNode[];
  /** Present when the folder was authored as an explicit directory entry (a
   * `path` ending in `/`), carrying its note/metadata + flat `entries` index. */
  entry?: FileTreeEntry;
  index?: number;
}

type TreeNode = FolderNode | FileLeaf;

interface VisibleTreeRow {
  node: TreeNode;
  depth: number;
}

/** A folder being assembled while we walk the paths (children keyed by name). */
interface FolderBuild {
  name: string;
  path: string;
  folders: Map<string, FolderBuild>;
  files: FileLeaf[];
  /** Insertion order of child names (folders + files) for stable rendering. */
  order: string[];
  /** Set when an explicit directory entry (trailing slash) targets this folder,
   * carrying its note/metadata + flat `entries` index. */
  entry?: FileTreeEntry;
  index?: number;
}

function makeFolder(name: string, path: string): FolderBuild {
  return { name, path, folders: new Map(), files: [], order: [] };
}

/**
 * Build a nested folder tree from the flat `entries`. Folders are derived purely
 * from the slash segments of each `path`; a single-segment path is a root file.
 * Insertion order is preserved within each folder, with folders sorted before
 * files at each level (the conventional explorer ordering).
 */
function buildTree(entries: FileTreeEntry[]): TreeNode[] {
  const root = makeFolder("", "");

  entries.forEach((entry, index) => {
    const segments = entry.path.split("/").filter(Boolean);
    if (segments.length === 0) return;

    // A trailing slash marks a DIRECTORY entry: every segment is a folder and
    // the entry's note/metadata attaches to the deepest folder (the last segment
    // does NOT become a file leaf). Because folders are keyed by name, this also
    // merges with any folder the sibling file paths already implied — so
    // `packages/shared/` and `packages/shared/src/…` collapse onto one `shared`
    // folder instead of a duplicate folder + file pair.
    const isDir = /\/\s*$/.test(entry.path);
    const folderSegments = isDir ? segments : segments.slice(0, -1);

    let cursor = root;
    let prefix = "";
    for (const segment of folderSegments) {
      prefix = prefix ? `${prefix}/${segment}` : segment;
      let next = cursor.folders.get(segment);
      if (!next) {
        next = makeFolder(segment, prefix);
        cursor.folders.set(segment, next);
        cursor.order.push(`d:${segment}`);
      }
      cursor = next;
    }

    if (isDir) {
      // Attach metadata to the deepest folder (first declaration wins, so an
      // explicit note isn't clobbered by a later bare prefix re-declaration).
      if (!cursor.entry) {
        cursor.entry = entry;
        cursor.index = index;
      }
      return;
    }

    const fileName = segments[segments.length - 1] as string;
    cursor.files.push({
      kind: "file",
      name: fileName,
      path: entry.path,
      entry,
      index,
    });
    cursor.order.push(`f:${cursor.files.length - 1}`);
  });

  const materialize = (folder: FolderBuild): TreeNode[] => {
    const nodes: TreeNode[] = [];
    for (const key of folder.order) {
      if (key.startsWith("d:")) {
        const child = folder.folders.get(key.slice(2));
        if (!child) continue;
        nodes.push({
          kind: "folder",
          name: child.name,
          path: child.path,
          children: materialize(child),
          entry: child.entry,
          index: child.index,
        });
      } else {
        const file = folder.files[Number(key.slice(2))];
        if (file) nodes.push(file);
      }
    }
    // Folders before files at this level (standard explorer ordering).
    return [
      ...nodes.filter((node) => node.kind === "folder"),
      ...nodes.filter((node) => node.kind === "file"),
    ];
  };

  return materialize(root);
}

function compactFolderNode(folder: FolderNode): FolderNode {
  const names = [folder.name];
  let path = folder.path;
  let children = folder.children;

  // Collapse single-child folder chains (a/b/c) into one row — but never across
  // a folder that carries its own directory note, so an explicitly authored
  // directory (e.g. `packages/shared/` with a note) keeps its own row instead of
  // being folded into its parent or child and losing the note.
  while (
    !folder.entry &&
    children.length === 1 &&
    children[0]?.kind === "folder" &&
    !children[0].entry
  ) {
    const child = children[0];
    names.push(child.name);
    path = child.path;
    children = child.children;
  }

  return {
    kind: "folder",
    name: names.join("/"),
    path,
    entry: folder.entry,
    index: folder.index,
    children: compactTree(children),
  };
}

function compactTree(nodes: TreeNode[]): TreeNode[] {
  return nodes.map((node) =>
    node.kind === "folder" ? compactFolderNode(node) : node,
  );
}

function flattenVisibleRows(
  nodes: TreeNode[],
  collapsedFolders: Record<string, boolean>,
  depth = 0,
): VisibleTreeRow[] {
  const rows: VisibleTreeRow[] = [];

  for (const node of nodes) {
    rows.push({ node, depth });
    if (node.kind === "folder" && !(collapsedFolders[node.path] ?? false)) {
      rows.push(
        ...flattenVisibleRows(node.children, collapsedFolders, depth + 1),
      );
    }
  }

  return rows;
}

/* ── Read (IDE explorer) ───────────────────────────────────────────────────── */

const INDENT_STEP = 14; // px per nesting level — the explorer guide spacing.
const DEFAULT_VISIBLE_TREE_ROWS = 10;
const NOTE_TOOLTIP_DELAY_MS = 320;

function OverflowNoteTooltip({
  className,
  note,
}: {
  className: string;
  note: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);

  const measureOverflow = useCallback(() => {
    const element = ref.current;
    if (!element) return false;

    const width = element.getBoundingClientRect().width || element.clientWidth;
    const nextIsOverflowing =
      width > 0 && element.scrollWidth > Math.ceil(width) + 1;

    setIsOverflowing(nextIsOverflowing);
    if (!nextIsOverflowing) setOpen(false);

    return nextIsOverflowing;
  }, []);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    measureOverflow();
    const frame = window.requestAnimationFrame(measureOverflow);
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measureOverflow);
    resizeObserver?.observe(element);
    window.addEventListener("resize", measureOverflow);

    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", measureOverflow);
    };
  }, [measureOverflow, note]);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen ? measureOverflow() : false);
  };

  return (
    <Tooltip open={open} onOpenChange={handleOpenChange}>
      <TooltipTrigger asChild>
        <span
          ref={ref}
          className={className}
          data-file-note-overflowing={isOverflowing ? "" : undefined}
          onFocus={measureOverflow}
          onPointerEnter={measureOverflow}
        >
          {note}
        </span>
      </TooltipTrigger>
      {isOverflowing && (
        <TooltipContent
          align="start"
          side="top"
          className="max-w-[min(28rem,calc(100vw-2rem))] whitespace-normal break-words text-xs leading-5"
        >
          {note}
        </TooltipContent>
      )}
    </Tooltip>
  );
}

/**
 * Read-only renderer for a `file-tree` block — a VS Code / GitHub-explorer file
 * and change tree. The flat `entries` are folded into a nested tree of
 * collapsible folders (IconFolder + chevron) and files (IconFile) carrying a
 * single-letter change badge (A/M/D/R). A file with a `note` or `snippet` is
 * itself clickable and expands to show the note plus the snippet rendered as a
 * fenced code block via `ctx.renderMarkdown`. A summary header tallies the change
 * counts ("+N · ~M · −K"). Every color is theme-aware via Tailwind `dark:`
 * variants / plan CSS vars, so the tree reads correctly in both modes.
 */
export function FileTreeRead({
  data,
  blockId,
  title,
  summary,
  ctx,
}: BlockReadProps<FileTreeData>) {
  const entries = data.entries ?? [];
  const tree = useMemo(() => compactTree(buildTree(entries)), [entries]);

  // Folders default to fully expanded so the tree is useful at a glance.
  const [collapsedFolders, setCollapsedFolders] = useState<
    Record<string, boolean>
  >({});
  const [showAllRows, setShowAllRows] = useState(false);
  // Files with snippets collapse their detail by default (progressive
  // disclosure) — keyed by the flat entry index so duplicate names never clash.
  // A note on its own stays inline; expanding it would only move the same text.
  const [openFiles, setOpenFiles] = useState<Record<number, boolean>>({});

  const toggleFolder = (path: string) =>
    setCollapsedFolders((current) => ({
      ...current,
      [path]: !current[path],
    }));
  const toggleFile = (index: number) =>
    setOpenFiles((current) => ({ ...current, [index]: !current[index] }));

  // The recap "Files touched" left rail (only) widens into the document as a
  // flyout while the tree is the reader's active focus AND a file's detail is
  // open, then collapses back to a slim rail when they click elsewhere or close
  // the last open file. `data-files-expanded` on the root drives the rail width
  // via CSS (`:has()`); it is inert anywhere the tree renders inline.
  const rootRef = useRef<HTMLElement>(null);
  const [active, setActive] = useState(false);
  const anyFileOpen = useMemo(
    () => Object.values(openFiles).some(Boolean),
    [openFiles],
  );
  const railExpanded = active && anyFileOpen;

  useEffect(() => {
    if (!railExpanded) return;
    const onPointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      if (
        root &&
        event.target instanceof Node &&
        !root.contains(event.target)
      ) {
        // Clicking away collapses the rail and closes any open file detail, so
        // it returns to the clean slim state rather than leaving notes open in
        // the cramped width.
        setActive(false);
        setOpenFiles({});
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, true);
  }, [railExpanded]);

  // Change tally for the summary header.
  const counts = useMemo(() => {
    const tally = { added: 0, modified: 0, removed: 0, renamed: 0 };
    for (const entry of entries) {
      if (entry.change) tally[entry.change] += 1;
    }
    return tally;
  }, [entries]);
  const changeTotal =
    counts.added + counts.modified + counts.removed + counts.renamed;

  const visibleRows = useMemo(
    () => flattenVisibleRows(tree, collapsedFolders),
    [collapsedFolders, tree],
  );
  const shouldLimitRows = visibleRows.length > DEFAULT_VISIBLE_TREE_ROWS;
  const displayedRows =
    showAllRows || !shouldLimitRows
      ? visibleRows
      : visibleRows.slice(0, DEFAULT_VISIBLE_TREE_ROWS);

  const renderRow = ({ node, depth }: VisibleTreeRow): React.ReactNode => {
    const indent = depth * INDENT_STEP;
    if (node.kind === "folder") {
      const collapsed = collapsedFolders[node.path] ?? false;
      // An explicit directory entry (trailing-slash path) can be a leaf folder
      // with no children — e.g. `apps/mail/`. It still renders as a folder, just
      // without a toggle chevron. Its authored note shows inline like a file's.
      const expandable = node.children.length > 0;
      const note = node.entry?.note?.trim();
      const open = expandable && !collapsed;
      return (
        <div key={`d:${node.path}`}>
          <button
            type="button"
            data-plan-interactive
            disabled={!expandable}
            aria-expanded={expandable ? !collapsed : undefined}
            onClick={expandable ? () => toggleFolder(node.path) : undefined}
            style={{ paddingLeft: indent + 8 }}
            className={cn(
              "flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-[13px] transition-colors",
              expandable ? "hover:bg-accent/40" : "cursor-default",
            )}
          >
            {expandable ? (
              <IconChevronRight
                className={cn(
                  "size-3.5 shrink-0 text-plan-muted transition-transform",
                  !collapsed && "rotate-90",
                )}
              />
            ) : (
              <span className="size-3.5 shrink-0" aria-hidden />
            )}
            {open ? (
              <IconFolderOpen className="size-4 shrink-0 text-plan-muted" />
            ) : (
              <IconFolder className="size-4 shrink-0 text-plan-muted" />
            )}
            <span className="min-w-0 truncate font-medium text-plan-text">
              {node.name}
            </span>
            {note && (
              <OverflowNoteTooltip
                className="ml-1 min-w-0 flex-1 truncate text-xs text-plan-muted"
                note={note}
              />
            )}
          </button>
        </div>
      );
    }

    const { entry } = node;
    const change = entry.change;
    const note = entry.note?.trim();
    const snippet = entry.snippet?.trim();
    const hasDetail = Boolean(snippet);
    const isOpen = openFiles[node.index] ?? false;
    const fileRowContents = (
      <>
        {/* Chevron slot — present only for files with expandable snippets so
            note-only files read as plain files instead of pseudo-folders. */}
        {hasDetail ? (
          <IconChevronRight
            className={cn(
              "mt-0.5 size-3.5 shrink-0 text-plan-muted transition-transform",
              isOpen && "rotate-90",
            )}
          />
        ) : (
          <span className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        )}
        <IconFile
          className={cn(
            "mt-0.5 size-4 shrink-0",
            change === "removed" ? "text-plan-muted" : "text-plan-muted/80",
          )}
        />
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="inline-flex min-w-0 shrink-0 items-center gap-1.5">
            <span
              className={cn(
                "min-w-0 truncate font-medium",
                change ? CHANGE_NAME_INK[change] : "text-plan-text",
              )}
            >
              {node.name}
            </span>
            {change && (
              <span
                title={CHANGE_LABEL[change]}
                aria-label={CHANGE_LABEL[change]}
                className={cn(
                  "flex size-4 shrink-0 items-center justify-center rounded text-[10px] font-bold leading-none",
                  CHANGE_BADGE[change],
                )}
              >
                {CHANGE_GLYPH[change]}
              </span>
            )}
          </span>
          {note && !isOpen && (
            <OverflowNoteTooltip
              className="min-w-0 flex-1 truncate text-xs text-plan-muted"
              note={note}
            />
          )}
        </span>
      </>
    );
    const rowClassName = cn(
      "group flex w-full items-start gap-1.5 rounded-md py-1 pr-2 text-left text-[13px] transition-colors",
      hasDetail ? "hover:bg-accent/40" : "cursor-default",
    );

    return (
      <div key={`f:${node.index}`}>
        {hasDetail ? (
          <button
            type="button"
            data-plan-interactive
            data-file-path={node.path}
            aria-expanded={isOpen}
            onClick={() => toggleFile(node.index)}
            style={{ paddingLeft: indent + 8 }}
            className={rowClassName}
          >
            {fileRowContents}
          </button>
        ) : (
          <div
            data-plan-interactive
            data-file-path={node.path}
            style={{ paddingLeft: indent + 8 }}
            className={rowClassName}
          >
            {fileRowContents}
          </div>
        )}

        {/* Expanded file detail: the note + a fenced snippet. */}
        {hasDetail && isOpen && (
          <div
            style={{ paddingLeft: indent + 8 + 20 }}
            className="pb-2 pr-2 pt-0.5"
          >
            {note && (
              <p className="text-xs leading-relaxed text-plan-muted">{note}</p>
            )}
            {snippet && (
              <div className="mt-2 an-file-tree-snippet">
                {ctx.renderMarkdown?.(fence(snippet, fenceLanguage(entry)))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <section
      {...ltrCodeBlockProps}
      ref={rootRef}
      className="plan-block"
      data-block-id={blockId}
      data-files-expanded={railExpanded ? "" : undefined}
      onPointerDown={() => setActive(true)}
    >
      {title && <div className="plan-block-label">{title}</div>}

      <div className="overflow-hidden rounded-xl border border-plan-line bg-plan-block">
        {/* Summary header: file count + change tally. */}
        <div className="flex flex-wrap items-center gap-2 border-b border-plan-line bg-accent/20 px-3 py-2">
          {data.title && (
            <span className="text-[13px] font-semibold text-plan-text">
              {data.title}
            </span>
          )}
          <span className="text-xs text-plan-muted">
            {entries.length} {entries.length === 1 ? "file" : "files"}
          </span>
          {changeTotal > 0 && (
            <span className="ml-auto flex items-center gap-2 font-mono text-xs">
              {counts.added > 0 && (
                <span className="text-emerald-600 dark:text-emerald-300">
                  +{counts.added}
                </span>
              )}
              {counts.modified > 0 && (
                <span className="text-blue-600 dark:text-blue-300">
                  ~{counts.modified}
                </span>
              )}
              {counts.removed > 0 && (
                <span className="text-red-600 dark:text-red-300">
                  −{counts.removed}
                </span>
              )}
              {counts.renamed > 0 && (
                <span className="text-violet-600 dark:text-violet-300">
                  »{counts.renamed}
                </span>
              )}
            </span>
          )}
        </div>

        {/* The tree itself. */}
        <TooltipProvider delayDuration={NOTE_TOOLTIP_DELAY_MS}>
          <div className="py-1.5">
            {tree.length > 0 ? (
              <>
                {displayedRows.map(renderRow)}
                {shouldLimitRows && (
                  <div className="px-2 pt-1">
                    <button
                      type="button"
                      data-plan-interactive
                      aria-expanded={showAllRows}
                      onClick={() => setShowAllRows((current) => !current)}
                      className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md text-xs font-medium text-plan-muted transition-colors hover:bg-accent/40 hover:text-plan-text"
                    >
                      <IconChevronRight
                        className={cn(
                          "size-3.5 shrink-0 transition-transform",
                          showAllRows ? "-rotate-90" : "rotate-90",
                        )}
                      />
                      {showAllRows
                        ? "Show fewer"
                        : `Show all ${visibleRows.length} rows`}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <p className="px-3 py-2 text-xs text-plan-muted">No files yet.</p>
            )}
          </div>
        </TooltipProvider>
      </div>

      {summary && <p className="mt-5 text-plan-muted">{summary}</p>}
    </section>
  );
}

/* ── Edit (panel form) ─────────────────────────────────────────────────────── */

const fieldLabelClass = "text-xs font-medium text-muted-foreground";

/**
 * Panel editor for a `file-tree` block. A structured form: an optional title
 * Input plus a list of file rows (add/remove), each carrying a path Input, a
 * change Select, a note Input, an optional language Input, and a snippet
 * Textarea. The folder tree is derived from the paths in the Read render, so the
 * form stays flat and quick to edit. Renders BARE content (no `<section>`); the
 * registry's panel surface supplies the popover chrome.
 */
export function FileTreeEdit({
  data,
  onChange,
  editable,
}: BlockEditProps<FileTreeData>) {
  const entries = data.entries ?? [];

  const patchEntries = (next: FileTreeEntry[]) =>
    onChange({ ...data, entries: next });

  const updateEntry = (index: number, next: Partial<FileTreeEntry>) =>
    patchEntries(
      entries.map((entry, i) => (i === index ? { ...entry, ...next } : entry)),
    );

  const removeEntry = (index: number) =>
    patchEntries(entries.filter((_, i) => i !== index));

  const addEntry = () =>
    patchEntries([...entries, { path: "src/new-file.ts", change: "added" }]);

  return (
    <div className="flex flex-col gap-4" data-plan-interactive>
      <label className="flex flex-col gap-1.5">
        <span className={fieldLabelClass}>Title (optional)</span>
        <DevInput
          className="h-9"
          value={data.title ?? ""}
          disabled={!editable}
          placeholder="e.g. Files touched"
          onChange={(event) =>
            onChange({ ...data, title: event.target.value || undefined })
          }
        />
      </label>

      <div className="flex flex-col gap-3">
        {entries.map((entry, index) => (
          <div
            key={index}
            className="flex flex-col gap-2 rounded-lg border border-input p-3"
          >
            <div className="grid grid-cols-[minmax(0,1fr)_120px_auto] gap-2">
              <DevInput
                className="h-8 font-mono text-xs"
                value={entry.path}
                disabled={!editable}
                placeholder="src/routes/git.ts"
                onChange={(event) =>
                  updateEntry(index, { path: event.target.value })
                }
              />
              <DevSelect
                className="h-8"
                value={entry.change ?? "none"}
                disabled={!editable}
                onValueChange={(value) =>
                  updateEntry(index, {
                    change:
                      value === "none" ? undefined : (value as FileTreeChange),
                  })
                }
                options={[
                  { value: "none", label: "No change" },
                  ...FILE_TREE_CHANGES.map((change) => ({
                    value: change,
                    label: CHANGE_LABEL[change],
                  })),
                ]}
              />
              {editable && (
                <button
                  type="button"
                  data-plan-interactive
                  aria-label="Remove file"
                  className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                  onClick={() => removeEntry(index)}
                >
                  <IconTrash className="size-4" />
                </button>
              )}
            </div>
            <DevInput
              className="h-8 text-xs"
              value={entry.note ?? ""}
              disabled={!editable}
              placeholder="Why this file changes"
              onChange={(event) =>
                updateEntry(index, { note: event.target.value || undefined })
              }
            />
            <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-2">
              <DevTextarea
                className="min-h-[64px] font-mono text-xs"
                value={entry.snippet ?? ""}
                disabled={!editable}
                placeholder="Optional code snippet"
                onChange={(event) =>
                  updateEntry(index, {
                    snippet: event.target.value || undefined,
                  })
                }
              />
              <DevInput
                className="h-8 self-start font-mono text-xs"
                value={entry.language ?? ""}
                disabled={!editable}
                placeholder="language"
                onChange={(event) =>
                  updateEntry(index, {
                    language: event.target.value || undefined,
                  })
                }
              />
            </div>
          </div>
        ))}
      </div>

      {editable && (
        <button
          type="button"
          data-plan-interactive
          className="flex items-center justify-center gap-1.5 rounded-md border border-dashed border-input py-2 text-sm text-muted-foreground hover:bg-accent/40 hover:text-foreground"
          onClick={addEntry}
        >
          <IconPlus className="size-4" />
          Add file
        </button>
      )}
    </div>
  );
}
