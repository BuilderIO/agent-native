// i18n-raw-literal-disable-file — new Design Studio panel; UI strings are localized when this feature is finalized in the follow-up PR.
import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { parseCssColorExtended } from "@shared/color-utils";
import {
  IconBorderRadius,
  IconBrush,
  IconChevronDown,
  IconChevronRight,
  IconDownload,
  IconFileText,
  IconFolder,
  IconLetterCase,
  IconPalette,
  IconPlus,
  IconSearch,
  IconShadow,
  IconSpacingHorizontal,
  IconUpload,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { LeftPanelHeader } from "@/components/design/editor/LeftPanelHeader";
import { LeftPanelSearchField } from "@/components/design/editor/LeftPanelSearchField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import {
  DESIGN_TOKEN_IMPORT_MAX_FILENAME_CHARS,
  DESIGN_TOKEN_IMPORT_MAX_FILES,
  DESIGN_TOKEN_IMPORT_MAX_TOTAL_BYTES,
} from "../../../shared/design-token-import-limits";
import {
  LAYER_ROW_GEOMETRY_CLASS,
  LayerRowIndentSlots,
  layerRowIndentCount,
} from "./LayersPanel";
import { TokenColorPicker } from "./TokenColorPicker";

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
  rejectedCount?: number;
  skippedCount?: number;
  omittedTokenCount?: number;
  omittedFileCount?: number;
  readFailureCount?: number;
  resolvedCssVars?: Record<string, string>;
}

export function createEmptyFilesImportResult(
  designId: string,
  omittedFileCount: number,
  readFailureCount = 0,
): ImportDesignTokensResult {
  return {
    designId,
    importedCount: 0,
    filesAnalyzed: [],
    omittedFileCount,
    readFailureCount,
  };
}

export function getTokenImportStatus(result: {
  importedCount: number;
  rejectedCount?: number;
  skippedCount?: number;
  omittedTokenCount?: number;
  omittedFileCount?: number;
  readFailureCount?: number;
}): {
  key:
    | "designEditor.tokens.importedCount"
    | "designEditor.tokens.importedWithSkipped"
    | "designEditor.tokens.importedWithOmissions"
    | "designEditor.tokens.importedWithReadFailures"
    | "designEditor.tokens.importedWithReadFailuresAndOmissions"
    | "designEditor.tokens.noTokensFound";
  values?: {
    count: number;
    skipped?: number;
    omittedTokens?: number;
    omittedFiles?: number;
    readFailures?: number;
  };
} {
  const skippedCount = (result.skippedCount ?? 0) + (result.rejectedCount ?? 0);
  const readFailureCount = result.readFailureCount ?? 0;
  const omittedTokenCount = result.omittedTokenCount ?? 0;
  const omittedFileCount = result.omittedFileCount ?? 0;
  if (readFailureCount > 0) {
    if (skippedCount > 0 || omittedTokenCount > 0 || omittedFileCount > 0) {
      return {
        key: "designEditor.tokens.importedWithReadFailuresAndOmissions",
        values: {
          count: result.importedCount,
          skipped: skippedCount,
          omittedTokens: omittedTokenCount,
          omittedFiles: omittedFileCount,
          readFailures: readFailureCount,
        },
      };
    }
    return {
      key: "designEditor.tokens.importedWithReadFailures",
      values: { count: result.importedCount, readFailures: readFailureCount },
    };
  }
  if (omittedTokenCount > 0 || omittedFileCount > 0) {
    return {
      key: "designEditor.tokens.importedWithOmissions",
      values: {
        count: result.importedCount,
        skipped: skippedCount,
        omittedTokens: omittedTokenCount,
        omittedFiles: omittedFileCount,
      },
    };
  }
  if (skippedCount > 0) {
    return {
      key: "designEditor.tokens.importedWithSkipped",
      values: { count: result.importedCount, skipped: skippedCount },
    };
  }
  if (result.importedCount === 0) {
    return { key: "designEditor.tokens.noTokensFound" };
  }
  return {
    key: "designEditor.tokens.importedCount",
    values: { count: result.importedCount },
  };
}

interface TokenImportFile {
  filename: string;
  content: string;
}

export interface TokensPanelProps {
  designId: string;
  onTokensApplied?: (resolvedCssVars: Record<string, string>) => void;
}

export function isColorValue(value: string): boolean {
  const v = value.trim();
  return (
    /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v) ||
    /^rgba?\(/.test(v) ||
    /^hsla?\(/.test(v) ||
    /^oklch\(/.test(v) ||
    /^color\(/.test(v)
  );
}

export function normalizeCssVarName(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.startsWith("--") ? trimmed : `--${trimmed}`;
}

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
      return { label: "Spacing & Layout", Icon: IconSpacingHorizontal };
    case "radius":
      return { label: "Radius", Icon: IconBorderRadius };
    case "shadow":
      return { label: "Shadows & Effects", Icon: IconShadow };
    default:
      return { label: "Other", Icon: IconBrush };
  }
}

function TokenTypeIcon({ type }: { type: DesignToken["type"] }) {
  const { Icon } = typeLabel(type);
  return <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />;
}

interface TokenRowProps {
  token: DesignToken;
  editing: boolean;
  editDraft: string;
  onDraftChange: (v: string) => void;
  onCommit: () => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onColorCommit: (cssVar: string, value: string) => Promise<void>;
}

function TokenRow({
  token,
  editing,
  editDraft,
  onDraftChange,
  onCommit,
  onStartEdit,
  onCancelEdit,
  onColorCommit,
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
        "group rounded-[4px]",
        LAYER_ROW_GEOMETRY_CLASS,
        editing
          ? "bg-[var(--design-editor-selection-color)] text-foreground"
          : "text-foreground/90 hover:bg-[var(--design-editor-layer-hover-color)] hover:text-foreground",
      )}
    >
      <LayerRowIndentSlots count={layerRowIndentCount(1)} />
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {showSwatch ? (
          parseCssColorExtended(token.value) ? (
            <span className="flex size-4 shrink-0 items-center justify-center">
              <TokenColorPicker
                name={token.name}
                value={token.value}
                onCommit={(value) => onColorCommit(token.cssVar, value)}
              />
            </span>
          ) : (
            <span className="flex size-4 shrink-0 items-center justify-center">
              <span
                className="size-4 rounded-[3px] ring-1 ring-inset ring-border"
                style={{ backgroundColor: token.value }}
                aria-hidden
              />
            </span>
          )
        ) : (
          <TokenTypeIcon type={token.type} />
        )}
        <button
          type="button"
          className="min-w-0 flex-1 cursor-default truncate bg-transparent p-0 text-left font-normal leading-4 text-foreground"
          onClick={onStartEdit}
          aria-label={`Edit ${token.name}`}
          title={`${token.name} (${token.cssVar})`}
        >
          {token.name}
        </button>
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
            className="h-6 w-24 px-1 py-0 !text-[11px] font-mono md:!text-[11px]"
          />
        ) : (
          <button
            type="button"
            className="max-w-[6rem] shrink-0 cursor-default truncate bg-transparent p-0 text-right font-mono leading-4 text-muted-foreground hover:text-foreground"
            title={token.value}
            aria-label={`Edit value for ${token.name}`}
            onClick={onStartEdit}
          >
            {token.value}
          </button>
        )}
      </div>
    </div>
  );
}

interface TokenGroupSectionProps {
  group: TokenGroup;
  editingKey: string | null;
  editDraft: string;
  onStartEdit: (cssVar: string, currentValue: string) => void;
  onDraftChange: (v: string) => void;
  onCommit: () => void;
  onCancelEdit: () => void;
  onColorCommit: (cssVar: string, value: string) => Promise<void>;
}

function TokenGroupSection({
  group,
  editingKey,
  editDraft,
  onStartEdit,
  onDraftChange,
  onCommit,
  onCancelEdit,
  onColorCommit,
}: TokenGroupSectionProps) {
  const [collapsed, setCollapsed] = useState(false);
  const { label, Icon } = typeLabel(group.type);

  return (
    <div>
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        className={cn(
          "w-full cursor-default rounded-[4px] text-left text-foreground/90 outline-none hover:bg-[var(--design-editor-layer-hover-color)] hover:text-foreground focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]",
          LAYER_ROW_GEOMETRY_CLASS,
        )}
      >
        <LayerRowIndentSlots
          count={layerRowIndentCount(0)}
          control={
            <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
              {collapsed ? (
                <IconChevronRight
                  className="!size-3 rtl:-scale-x-100"
                  strokeWidth={1.8}
                />
              ) : (
                <IconChevronDown className="!size-3" strokeWidth={1.8} />
              )}
            </span>
          }
        />
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate font-normal leading-4 text-foreground">
            {label}
          </span>
        </span>
      </button>

      {!collapsed &&
        group.tokens.map((token) => (
          <TokenRow
            key={token.cssVar}
            token={token}
            editing={editingKey === token.cssVar}
            editDraft={editDraft}
            onDraftChange={onDraftChange}
            onCommit={onCommit}
            onStartEdit={() => onStartEdit(token.cssVar, token.value)}
            onCancelEdit={onCancelEdit}
            onColorCommit={onColorCommit}
          />
        ))}
    </div>
  );
}

type ImportMode = "menu" | "text";

const DEFAULT_TOKEN_VAR = "--my-token";
// guard:allow-raw-color — default value for a new token input, not UI styling
const DEFAULT_TOKEN_VALUE = "#000000";

function HeaderIconPopover({
  label,
  icon,
  open,
  onOpenChange,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 cursor-pointer rounded-md text-foreground"
              aria-label={label}
            >
              {icon}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-72 p-2 text-[12px]">
        {children}
      </PopoverContent>
    </Popover>
  );
}

function AddTokenPopover({
  onAdd,
}: {
  onAdd: (cssVar: string, value: string) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [cssVar, setCssVar] = useState(DEFAULT_TOKEN_VAR);
  const [value, setValue] = useState(DEFAULT_TOKEN_VALUE);

  const reset = () => {
    setCssVar(DEFAULT_TOKEN_VAR);
    setValue(DEFAULT_TOKEN_VALUE);
  };

  return (
    <HeaderIconPopover
      label={t("designEditor.tokens.newToken")}
      icon={<IconPlus className="size-4" />}
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) reset();
      }}
    >
      <div className="space-y-2 p-1">
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-muted-foreground">
            {t("designEditor.tokens.cssVar")}
          </label>
          <Input
            value={cssVar}
            onChange={(e) => setCssVar(e.target.value)}
            className="h-6 font-mono !text-[11px] md:!text-[11px]"
            placeholder={DEFAULT_TOKEN_VAR}
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
            // guard:allow-raw-color — example value in an input placeholder, not UI styling
            placeholder="#3B82F6"
          />
        </div>
        <Button
          type="button"
          className="h-7 w-full cursor-pointer !text-[11px]"
          onClick={() => {
            onAdd(normalizeCssVarName(cssVar), value.trim());
            setOpen(false);
            reset();
          }}
          disabled={!cssVar.trim() || !value.trim()}
        >
          {t("designEditor.tokens.add")}
        </Button>
      </div>
    </HeaderIconPopover>
  );
}

interface ImportTokensPopoverProps {
  onImportFiles: (
    files: TokenImportFile[],
    omittedFileCount: number,
    readFailureCount: number,
  ) => Promise<ImportDesignTokensResult>;
  onImportText: (text: string) => Promise<ImportDesignTokensResult>;
  onImportCurrentDesign: () => Promise<ImportDesignTokensResult>;
  isPending: boolean;
}

function ImportTokensPopover({
  onImportFiles,
  onImportText,
  onImportCurrentDesign,
  isPending,
}: ImportTokensPopoverProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ImportMode>("menu");
  const [text, setText] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const runImport = async (
    importer: () => Promise<ImportDesignTokensResult>,
  ) => {
    setStatus(t("designEditor.tokens.importing"));
    try {
      const result = await importer();
      const status = getTokenImportStatus(result);
      setStatus(status.values ? t(status.key, status.values) : t(status.key));
      if (result.importedCount > 0) {
        setText("");
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = snapshotImportFiles(event.currentTarget);
    if (files.length === 0) return;
    void runImport(async () => {
      const imported = await readImportFiles(files);
      return onImportFiles(
        imported.files,
        imported.omittedFileCount,
        imported.readFailureCount,
      );
    });
  };

  return (
    <HeaderIconPopover
      label={t("designEditor.tokens.import")}
      icon={<IconDownload className="size-4" />}
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          setMode("menu");
          setStatus(null);
          setText("");
        }
      }}
    >
      {mode === "menu" ? (
        <div className="space-y-0.5">
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
      ) : (
        <div className="space-y-2 p-1">
          <TokenCreateBackButton onClick={() => setMode("menu")} />
          <p className="text-[10px] leading-snug text-muted-foreground">
            Paste a token set from CSS, JSON, Tailwind config, or design notes.
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
        {...({ directory: "", webkitdirectory: "" } as Record<string, string>)}
      />

      {status && (
        <p
          className="mt-2 px-1 text-[10px] leading-snug text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          {status}
        </p>
      )}
    </HeaderIconPopover>
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

const TOKEN_IMPORT_ACCEPT = [
  ".css",
  ".scss",
  ".less",
  ".html",
  ".htm",
  ".json",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".md",
  ".mdx",
  ".txt",
].join(",");

export function snapshotImportFiles(
  input: Pick<HTMLInputElement, "files" | "value">,
): File[] {
  const files = Array.from(input.files ?? []);
  input.value = "";
  return files;
}

export async function readImportFiles(selectedFiles: File[]): Promise<{
  files: TokenImportFile[];
  omittedFileCount: number;
  readFailureCount: number;
}> {
  const selected = selectedFiles.slice(0, DESIGN_TOKEN_IMPORT_MAX_FILES);
  const files: TokenImportFile[] = [];
  const encoder = new TextEncoder();
  let readBytes = 0;
  let contentBytes = 0;
  let omittedFileCount = selectedFiles.length - selected.length;
  let readFailureCount = 0;

  for (const file of selected) {
    const relativePath =
      (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
      file.name;
    let filename = relativePath.trim();
    if (filename.length > DESIGN_TOKEN_IMPORT_MAX_FILENAME_CHARS) {
      filename = file.name.trim();
    }
    if (!filename || filename.length > DESIGN_TOKEN_IMPORT_MAX_FILENAME_CHARS) {
      omittedFileCount += 1;
      continue;
    }

    if (
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      readBytes + file.size > DESIGN_TOKEN_IMPORT_MAX_TOTAL_BYTES
    ) {
      omittedFileCount += 1;
      continue;
    }

    let content: string;
    try {
      content = await file.text();
    } catch {
      readFailureCount += 1;
      continue;
    }
    const encodedSize = encoder.encode(content).byteLength;
    if (contentBytes + encodedSize > DESIGN_TOKEN_IMPORT_MAX_TOTAL_BYTES) {
      omittedFileCount += 1;
      continue;
    }

    readBytes += file.size;
    contentBytes += encodedSize;
    if (content.length === 0) continue;
    files.push({
      filename,
      content,
    });
  }

  return {
    files,
    omittedFileCount,
    readFailureCount,
  };
}

export function TokensPanel({ designId, onTokensApplied }: TokensPanelProps) {
  const t = useT();

  const { data, isLoading, refetch } = useActionQuery<IndexDesignTokensResult>(
    "index-design-tokens",
    { designId },
  );

  const applyMutation = useActionMutation("apply-design-token-edit");
  const importMutation = useActionMutation("import-design-tokens");

  const designIdRef = useRef(designId);
  designIdRef.current = designId;

  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
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

  const applyTokenEdit = (cssVar: string, value: string) => {
    const requestDesignId = designId;
    applyMutation.mutate(
      { designId, edits: [{ cssVar, value }] },
      {
        onSuccess: (result) => {
          if (designIdRef.current !== requestDesignId) return;
          void refetch();
          const r = result as { resolvedCssVars?: Record<string, string> };
          if (r?.resolvedCssVars && onTokensApplied) {
            onTokensApplied(r.resolvedCssVars);
          }
        },
      },
    );
  };

  const commitTokenColor = async (cssVar: string, value: string) => {
    const requestDesignId = designId;
    const result = (await applyMutation.mutateAsync({
      designId,
      edits: [{ cssVar, value }],
    })) as { resolvedCssVars?: Record<string, string> };
    if (designIdRef.current !== requestDesignId) return;
    await refetch();
    if (result?.resolvedCssVars && onTokensApplied) {
      onTokensApplied(result.resolvedCssVars);
    }
  };

  const commitEdit = () => {
    if (!editingKey || !editDraft.trim()) {
      cancelEdit();
      return;
    }
    const cssVar = editingKey;
    const value = editDraft.trim();
    cancelEdit();
    applyTokenEdit(cssVar, value);
  };

  const handleNewToken = (cssVar: string, value: string) => {
    applyTokenEdit(cssVar, value);
  };

  const handleImportSuccess = (
    result: ImportDesignTokensResult,
    requestDesignId: string,
  ) => {
    if (designIdRef.current !== requestDesignId) return result;
    void refetch();
    if (result.resolvedCssVars && onTokensApplied) {
      onTokensApplied(result.resolvedCssVars);
    }
    return result;
  };

  const importFiles = async (
    files: TokenImportFile[],
    clientOmittedFileCount: number,
    clientReadFailureCount: number,
  ) => {
    if (files.length === 0) {
      return createEmptyFilesImportResult(
        designId,
        clientOmittedFileCount,
        clientReadFailureCount,
      );
    }

    const requestDesignId = designId;
    const result = (await importMutation.mutateAsync({
      designId,
      source: "files",
      files,
    })) as ImportDesignTokensResult;
    return handleImportSuccess(
      {
        ...result,
        omittedFileCount:
          (result.omittedFileCount ?? 0) + clientOmittedFileCount,
        readFailureCount: clientReadFailureCount,
      },
      requestDesignId,
    );
  };

  const importText = async (text: string) => {
    const requestDesignId = designId;
    const result = (await importMutation.mutateAsync({
      designId,
      source: "paste",
      text,
    })) as ImportDesignTokensResult;
    return handleImportSuccess(result, requestDesignId);
  };

  const importCurrentDesign = async () => {
    const requestDesignId = designId;
    const result = (await importMutation.mutateAsync({
      designId,
      source: "current-design",
    })) as ImportDesignTokensResult;
    return handleImportSuccess(result, requestDesignId);
  };

  const tokenCount = data?.tokenCount ?? 0;
  const showSearch = searchOpen || Boolean(search.trim());
  const query = search.trim().toLowerCase();
  const allGroups = data?.groups;
  const groups = useMemo(() => {
    if (!allGroups || !query) return allGroups ?? [];
    return allGroups
      .map((group) => ({
        ...group,
        tokens: group.tokens.filter((token) =>
          [token.name, token.cssVar, token.value].some((field) =>
            field.toLowerCase().includes(query),
          ),
        ),
      }))
      .filter((group) => group.tokens.length > 0);
  }, [allGroups, query]);
  const hasTokens = (allGroups?.length ?? 0) > 0;
  const focusSearch = () => {
    setSearchOpen(true);
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <LeftPanelHeader>
        <span className="min-w-0 flex-1 truncate pl-2 !text-xs leading-4 text-muted-foreground">
          {t("designEditor.tokens.count", { count: tokenCount })}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 cursor-pointer rounded-md text-foreground"
              aria-label={t("designEditor.tokens.search")}
              onClick={focusSearch}
            >
              <IconSearch className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("designEditor.tokens.search")}</TooltipContent>
        </Tooltip>
        <ImportTokensPopover
          onImportFiles={importFiles}
          onImportText={importText}
          onImportCurrentDesign={importCurrentDesign}
          isPending={importMutation.isPending}
        />
        <AddTokenPopover onAdd={handleNewToken} />
      </LeftPanelHeader>

      {showSearch && (
        <LeftPanelSearchField
          ref={searchInputRef}
          value={search}
          placeholder={t("designEditor.tokens.search")}
          onValueChange={setSearch}
          onEscapeWhenEmpty={() => setSearchOpen(false)}
        />
      )}

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1">
        {isLoading && (
          <div className="px-1.5">
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className={cn(LAYER_ROW_GEOMETRY_CLASS, "gap-2")}
                style={{ paddingInlineStart: i === 1 ? undefined : "58px" }}
              >
                <div className="size-4 shrink-0 animate-pulse rounded bg-muted/40" />
                <div
                  className="h-3 animate-pulse rounded bg-muted/40"
                  style={{ width: `${40 + (i % 3) * 15}%` }}
                />
              </div>
            ))}
          </div>
        )}

        {!isLoading && !hasTokens && (
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

        {!isLoading && hasTokens && groups.length === 0 && (
          <p className="px-3 py-8 text-center !text-[11px] text-muted-foreground">
            {t("designEditor.tokens.noMatches")}
          </p>
        )}

        {!isLoading && groups.length > 0 && (
          <div className="px-1.5">
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
                onColorCommit={commitTokenColor}
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
