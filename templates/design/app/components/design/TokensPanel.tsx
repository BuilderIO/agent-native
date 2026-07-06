// i18n-raw-literal-disable-file — new Design Studio panel; UI strings are localized when this feature is finalized in the follow-up PR.
/**
 * Tokens inspector panel — §6.2 of DESIGN-STUDIO-PLAN.md.
 *
 * Friendly token names + colour swatches, CSS-var name on the right, type-scale
 * section, radius input, a source chip, and a New token action. Grouped by
 * type: color → typography → spacing → radius → shadow → other.
 *
 * Alpine (Tier-A): edits go through `apply-design-token-edit` which routes
 * through the Tweaks loop (live tweak-values preview + persist in
 * designs.data.tweakSelections). No source file write-back yet.
 *
 * Real app (Tier-B): the write-back advisory from the action surfaces inline
 * as a migration CTA; no additional UI logic is needed here.
 */

import {
  useActionMutation,
  useActionQuery,
  useT,
} from "@agent-native/core/client";
import { Badge } from "@agent-native/toolkit/ui/badge";
import { Button } from "@agent-native/toolkit/ui/button";
import { Input } from "@agent-native/toolkit/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@agent-native/toolkit/ui/popover";
import { Textarea } from "@agent-native/toolkit/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@agent-native/toolkit/ui/tooltip";
import {
  IconBrush,
  IconChevronDown,
  IconChevronRight,
  IconCircle,
  IconFileText,
  IconFolder,
  IconLetterCase,
  IconPalette,
  IconPlus,
  IconRefresh,
  IconRuler,
  IconSpacingVertical,
  IconShadow,
  IconUpload,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types (mirroring the action shape)
// ---------------------------------------------------------------------------

interface DesignToken {
  name: string;
  cssVar: string;
  value: string;
  type: "color" | "typography" | "spacing" | "radius" | "shadow" | "other";
  source: string;
  isTweakOverride?: boolean;
}

interface TokenGroup {
  type: DesignToken["type"];
  tokens: DesignToken[];
}

interface IndexDesignTokensResult {
  designId: string;
  tokenCount: number;
  groups: TokenGroup[];
  tokens: DesignToken[];
}

interface ImportDesignTokensResult {
  designId: string;
  importedCount: number;
  filesAnalyzed: string[];
  resolvedCssVars?: Record<string, string>;
}

interface TokenImportFile {
  filename: string;
  content: string;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface TokensPanelProps {
  designId: string;
  /**
   * Called after a token edit is persisted so the parent can push the
   * resolved CSS var map into the iframe via the tweak-values postMessage.
   */
  onTokensApplied?: (resolvedCssVars: Record<string, string>) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** True when the value looks like an opaque colour we can render as a swatch. */
function isColorValue(value: string): boolean {
  const v = value.trim();
  return (
    /^#[0-9a-fA-F]{3,8}$/.test(v) ||
    /^rgba?\(/.test(v) ||
    /^hsla?\(/.test(v) ||
    /^oklch\(/.test(v) ||
    /^color\(/.test(v)
  );
}

/** Type label + icon for a section header. */
function typeLabel(type: DesignToken["type"]): {
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
} {
  switch (type) {
    case "color":
      return { label: "Colors", Icon: IconPalette };
    case "typography":
      return { label: "Typography", Icon: IconLetterCase };
    case "spacing":
      return { label: "Spacing", Icon: IconSpacingVertical };
    case "radius":
      return { label: "Radius", Icon: IconRuler };
    case "shadow":
      return { label: "Shadows & Effects", Icon: IconShadow };
    default:
      return { label: "Other", Icon: IconBrush };
  }
}

// ---------------------------------------------------------------------------
// Individual token row
// ---------------------------------------------------------------------------

interface TokenRowProps {
  token: DesignToken;
  onEdit: (cssVar: string, value: string) => void;
  editing: boolean;
  editDraft: string;
  onDraftChange: (v: string) => void;
  onCommit: () => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
}

function TokenRow({
  token,
  editing,
  editDraft,
  onDraftChange,
  onCommit,
  onStartEdit,
  onCancelEdit,
}: TokenRowProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const showSwatch = token.type === "color" && isColorValue(token.value);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  return (
    <div
      className={cn(
        "group flex min-h-[28px] items-center gap-2 rounded px-2 py-0.5",
        "hover:bg-accent/40 transition-colors",
        editing && "bg-accent/60",
      )}
    >
      {/* Swatch or type icon */}
      {showSwatch ? (
        <span
          className="size-3.5 flex-none rounded-sm ring-1 ring-border/50"
          style={{ backgroundColor: token.value }}
          aria-hidden
        />
      ) : (
        <IconCircle
          className="size-3.5 flex-none text-muted-foreground/30"
          aria-hidden
        />
      )}

      {/* Friendly name */}
      <button
        type="button"
        className="min-w-0 flex-1 cursor-pointer truncate bg-transparent p-0 text-left !text-[11px] text-foreground"
        onClick={onStartEdit}
        aria-label={`Edit ${token.name}`}
        title={token.name}
      >
        {token.name}
      </button>

      {/* Value / edit input */}
      {editing ? (
        <Input
          ref={inputRef}
          aria-label={`Token value for ${token.name}`}
          value={editDraft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onCommit();
            if (e.key === "Escape") onCancelEdit();
          }}
          onBlur={onCommit}
          className="h-5 w-24 px-1 py-0 !text-[11px] font-mono md:!text-[11px]"
        />
      ) : (
        <button
          type="button"
          className="max-w-[6rem] cursor-pointer truncate bg-transparent p-0 text-right font-mono text-[10px] text-muted-foreground hover:text-foreground"
          title={token.value}
          aria-label={`Edit value for ${token.name}`}
          onClick={onStartEdit}
        >
          {token.value}
        </button>
      )}

      {/* CSS var chip (hidden when editing, visible on hover) */}
      {!editing && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="pointer-events-none hidden max-w-[5.5rem] shrink-0 cursor-default select-all truncate rounded bg-muted px-1 py-0 font-mono text-[9px] text-muted-foreground/70 group-hover:inline-block">
              {token.cssVar}
            </span>
          </TooltipTrigger>
          <TooltipContent className="font-mono text-xs">
            {token.cssVar}
          </TooltipContent>
        </Tooltip>
      )}

      {/* Source chip */}
      {!editing && (
        <Badge
          variant="outline"
          className="pointer-events-none hidden h-4 shrink-0 cursor-default px-1 py-0 text-[9px] text-muted-foreground/60 group-hover:flex"
        >
          {token.source}
        </Badge>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Token group section
// ---------------------------------------------------------------------------

interface TokenGroupSectionProps {
  group: TokenGroup;
  editingKey: string | null;
  editDraft: string;
  onStartEdit: (cssVar: string, currentValue: string) => void;
  onDraftChange: (v: string) => void;
  onCommit: () => void;
  onCancelEdit: () => void;
  onEdit: (cssVar: string, value: string) => void;
}

function TokenGroupSection({
  group,
  editingKey,
  editDraft,
  onStartEdit,
  onDraftChange,
  onCommit,
  onCancelEdit,
  onEdit,
}: TokenGroupSectionProps) {
  const [collapsed, setCollapsed] = useState(false);
  const { label, Icon } = typeLabel(group.type);

  return (
    <div>
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left hover:bg-accent/30"
      >
        {collapsed ? (
          <IconChevronRight className="size-3 text-muted-foreground/50" />
        ) : (
          <IconChevronDown className="size-3 text-muted-foreground/50" />
        )}
        <Icon className="size-3 text-muted-foreground/60" />
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <span className="ml-auto text-[10px] tabular-nums text-muted-foreground/40">
          {group.tokens.length}
        </span>
      </button>

      {!collapsed && (
        <div className="pb-1">
          {group.tokens.map((token) => (
            <TokenRow
              key={token.cssVar}
              token={token}
              editing={editingKey === token.cssVar}
              editDraft={editDraft}
              onDraftChange={onDraftChange}
              onCommit={onCommit}
              onStartEdit={() => onStartEdit(token.cssVar, token.value)}
              onCancelEdit={onCancelEdit}
              onEdit={onEdit}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// New Token popover
// ---------------------------------------------------------------------------

type TokenCreateMode = "menu" | "add" | "text";

interface NewTokenPopoverProps {
  onAdd: (cssVar: string, value: string) => void;
  onImportFiles: (
    files: TokenImportFile[],
  ) => Promise<ImportDesignTokensResult>;
  onImportText: (text: string) => Promise<ImportDesignTokensResult>;
  onImportCurrentDesign: () => Promise<ImportDesignTokensResult>;
  isPending: boolean;
}

function NewTokenPopover({
  onAdd,
  onImportFiles,
  onImportText,
  onImportCurrentDesign,
  isPending,
}: NewTokenPopoverProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<TokenCreateMode>("menu");
  const [cssVar, setCssVar] = useState("--my-token");
  const [value, setValue] = useState("#000000");
  const [text, setText] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const t = useT();

  const handleAdd = () => {
    const cleanVar = cssVar.startsWith("--") ? cssVar : `--${cssVar}`;
    onAdd(cleanVar, value);
    setOpen(false);
    setMode("menu");
    setCssVar("--my-token");
    setValue("#000000");
  };

  const runImport = async (
    importer: () => Promise<ImportDesignTokensResult>,
  ) => {
    setStatus(null);
    try {
      const result = await importer();
      setStatus(
        t("designEditor.tokens.importedCount", {
          count: result.importedCount,
        }),
      );
      if (result.importedCount > 0) {
        setText("");
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const closeOrReset = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setMode("menu");
      setStatus(null);
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.currentTarget.files;
    event.currentTarget.value = "";
    if (!files?.length) return;
    void runImport(async () => onImportFiles(await readImportFiles(files)));
  };

  return (
    <Popover open={open} onOpenChange={closeOrReset}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 cursor-pointer gap-1 px-2 !text-[11px] text-muted-foreground hover:text-foreground"
        >
          <IconPlus className="size-3" />
          {t("designEditor.tokens.newToken")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2 text-[12px]">
        {mode === "menu" ? (
          <div className="space-y-0.5">
            <TokenCreateOption
              icon={<IconPlus className="size-3.5" />}
              title="Add one token"
              description="Create a single CSS variable by hand."
              onClick={() => setMode("add")}
              disabled={isPending}
            />
            <TokenCreateOption
              icon={<IconUpload className="size-3.5" />}
              title="Import a set from text"
              description="Paste CSS variables, theme notes, or token JSON."
              onClick={() => setMode("text")}
              disabled={isPending}
            />
            <TokenCreateOption
              icon={<IconFileText className="size-3.5" />}
              title="Import from a file"
              description="Read colors, spacing, and type from selected files."
              onClick={() => fileInputRef.current?.click()}
              disabled={isPending}
            />
            <TokenCreateOption
              icon={<IconFolder className="size-3.5" />}
              title="Import from a folder"
              description="Scan a small source folder for token definitions."
              onClick={() => folderInputRef.current?.click()}
              disabled={isPending}
            />
            <TokenCreateOption
              icon={<IconPalette className="size-3.5" />}
              title="Import from current design"
              description="Extract reusable tokens already used on the canvas."
              onClick={() => void runImport(onImportCurrentDesign)}
              disabled={isPending}
            />
          </div>
        ) : mode === "add" ? (
          <div className="space-y-2 p-1">
            <TokenCreateBackButton onClick={() => setMode("menu")} />
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-muted-foreground">
                {t("designEditor.tokens.cssVar")}
              </label>
              <Input
                value={cssVar}
                onChange={(e) => setCssVar(e.target.value)}
                className="h-6 font-mono !text-[11px] md:!text-[11px]"
                placeholder="--my-token"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-muted-foreground">
                {t("designEditor.tokens.value")}
              </label>
              <Input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="h-6 font-mono !text-[11px] md:!text-[11px]"
                placeholder="#3B82F6"
              />
            </div>
            <Button
              type="button"
              className="h-7 w-full cursor-pointer !text-[11px]"
              onClick={handleAdd}
              disabled={!cssVar || !value}
            >
              {t("designEditor.tokens.add")}
            </Button>
          </div>
        ) : (
          <div className="space-y-2 p-1">
            <TokenCreateBackButton onClick={() => setMode("menu")} />
            <p className="text-[10px] leading-snug text-muted-foreground">
              Paste a token set from CSS, JSON, Tailwind config, or design
              notes.
            </p>
            <Textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={t("designEditor.tokens.pastePlaceholder")}
              className="min-h-24 resize-none font-mono !text-[11px]"
            />
            <Button
              type="button"
              className="h-7 w-full cursor-pointer !text-[11px]"
              disabled={isPending || !text.trim()}
              onClick={() => void runImport(() => onImportText(text))}
            >
              {t("designEditor.tokens.importPasted")}
            </Button>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={TOKEN_IMPORT_ACCEPT}
          className="hidden"
          onChange={handleFileChange}
        />
        <input
          ref={folderInputRef}
          type="file"
          multiple
          accept={TOKEN_IMPORT_ACCEPT}
          className="hidden"
          onChange={handleFileChange}
          {...({ directory: "", webkitdirectory: "" } as Record<
            string,
            string
          >)}
        />

        {status && (
          <p className="mt-2 px-1 text-[10px] leading-snug text-muted-foreground">
            {status}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}

function TokenCreateBackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-1 text-[10px] font-medium text-muted-foreground hover:text-foreground"
    >
      Back
    </button>
  );
}

function TokenCreateOption({
  icon,
  title,
  description,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="group flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent/60 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border/70 bg-muted/70 text-muted-foreground transition-colors group-hover:border-border group-hover:bg-muted">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium leading-tight text-foreground">
          {title}
        </span>
        <span className="mt-0.5 line-clamp-1 text-[11px] leading-snug text-muted-foreground">
          {description}
        </span>
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Import helpers
// ---------------------------------------------------------------------------

const TOKEN_IMPORT_ACCEPT = [
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".json",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".md",
  ".mdx",
  ".txt",
].join(",");

async function readImportFiles(fileList: FileList): Promise<TokenImportFile[]> {
  const selected = [...fileList].slice(0, 20);
  const files = await Promise.all(
    selected.map(async (file) => ({
      filename:
        (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
        file.name,
      content: await file.text(),
    })),
  );

  return files.filter((file) => file.content.trim().length > 0);
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

/**
 * Tokens inspector panel — displays design tokens grouped by type, supports
 * inline editing that persists through the Tweaks loop, and provides a "New
 * token" action. Matches the tokens artboard in §6.2 of DESIGN-STUDIO-PLAN.md.
 */
export function TokensPanel({ designId, onTokensApplied }: TokensPanelProps) {
  const t = useT();

  // ------------------------------------------------------------------
  // Data
  // ------------------------------------------------------------------
  const { data, isLoading, refetch } = useActionQuery<IndexDesignTokensResult>(
    "index-design-tokens",
    { designId },
  );

  const applyMutation = useActionMutation("apply-design-token-edit");
  const importMutation = useActionMutation("import-design-tokens");

  // ------------------------------------------------------------------
  // Local edit state
  // ------------------------------------------------------------------
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");

  const startEdit = (cssVar: string, currentValue: string) => {
    setEditingKey(cssVar);
    setEditDraft(currentValue);
  };

  const cancelEdit = () => {
    setEditingKey(null);
    setEditDraft("");
  };

  const commitEdit = () => {
    if (!editingKey || !editDraft.trim()) {
      cancelEdit();
      return;
    }
    const cssVar = editingKey;
    const value = editDraft.trim();
    cancelEdit();
    applyMutation.mutate(
      { designId, edits: [{ cssVar, value }] },
      {
        onSuccess: (result) => {
          void refetch();
          const r = result as { resolvedCssVars?: Record<string, string> };
          if (r?.resolvedCssVars && onTokensApplied) {
            onTokensApplied(r.resolvedCssVars);
          }
        },
      },
    );
  };

  const handleNewToken = (cssVar: string, value: string) => {
    applyMutation.mutate(
      { designId, edits: [{ cssVar, value }] },
      {
        onSuccess: (result) => {
          void refetch();
          const r = result as { resolvedCssVars?: Record<string, string> };
          if (r?.resolvedCssVars && onTokensApplied) {
            onTokensApplied(r.resolvedCssVars);
          }
        },
      },
    );
  };

  const handleImportSuccess = (result: ImportDesignTokensResult) => {
    void refetch();
    if (result.resolvedCssVars && onTokensApplied) {
      onTokensApplied(result.resolvedCssVars);
    }
    return result;
  };

  const importFiles = async (files: TokenImportFile[]) => {
    const result = (await importMutation.mutateAsync({
      designId,
      source: "files",
      files,
    })) as ImportDesignTokensResult;
    return handleImportSuccess(result);
  };

  const importText = async (text: string) => {
    const result = (await importMutation.mutateAsync({
      designId,
      source: "paste",
      text,
    })) as ImportDesignTokensResult;
    return handleImportSuccess(result);
  };

  const importCurrentDesign = async () => {
    const result = (await importMutation.mutateAsync({
      designId,
      source: "current-design",
    })) as ImportDesignTokensResult;
    return handleImportSuccess(result);
  };

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  const groups = data?.groups ?? [];
  const tokenCount = data?.tokenCount ?? 0;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
        <div className="flex items-center gap-1.5">
          <span className="!text-[11px] font-semibold text-foreground">
            {t("designEditor.tokens.title")}
          </span>
          {tokenCount > 0 && (
            <span className="tabular-nums text-[10px] text-muted-foreground/50">
              ({tokenCount})
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-6 cursor-pointer text-muted-foreground/60 hover:text-foreground"
                onClick={() => void refetch()}
                aria-label={t("designEditor.tokens.refresh")}
              >
                <IconRefresh className="size-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("designEditor.tokens.refresh")}</TooltipContent>
          </Tooltip>
          <NewTokenPopover
            onAdd={handleNewToken}
            onImportFiles={importFiles}
            onImportText={importText}
            onImportCurrentDesign={importCurrentDesign}
            isPending={importMutation.isPending}
          />
        </div>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading && (
          <div className="flex flex-col gap-1.5 px-3 py-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="h-6 animate-pulse rounded bg-muted/40"
                style={{ width: `${60 + (i % 3) * 15}%` }}
              />
            ))}
          </div>
        )}

        {!isLoading && groups.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
            <IconPalette className="size-6 text-muted-foreground/30" />
            <p className="!text-[11px] leading-snug text-muted-foreground/60">
              {t("designEditor.tokens.empty")}
            </p>
            <p className="text-[10px] text-muted-foreground/40">
              {t("designEditor.tokens.emptyHint")}
            </p>
          </div>
        )}

        {!isLoading && groups.length > 0 && (
          <div className="pb-2">
            {groups.map((group) => (
              <TokenGroupSection
                key={group.type}
                group={group}
                editingKey={editingKey}
                editDraft={editDraft}
                onStartEdit={startEdit}
                onDraftChange={setEditDraft}
                onCommit={commitEdit}
                onCancelEdit={cancelEdit}
                onEdit={(cssVar, value) =>
                  applyMutation.mutate(
                    { designId, edits: [{ cssVar, value }] },
                    {
                      onSuccess: (result) => {
                        void refetch();
                        const r = result as {
                          resolvedCssVars?: Record<string, string>;
                        };
                        if (r?.resolvedCssVars && onTokensApplied) {
                          onTokensApplied(r.resolvedCssVars);
                        }
                      },
                    },
                  )
                }
              />
            ))}
          </div>
        )}
      </div>

      {/* Pending indicator */}
      {applyMutation.isPending && (
        <div className="flex items-center gap-1.5 border-t border-border/60 px-3 py-1.5">
          <span className="size-1.5 animate-pulse rounded-full bg-primary" />
          <span className="text-[10px] text-muted-foreground">
            {t("designEditor.tokens.applying")}
          </span>
        </div>
      )}
    </div>
  );
}
