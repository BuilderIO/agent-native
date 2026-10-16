import { friendlyTokenName } from "@agent-native/core/brand-kit";
// i18n-raw-literal-disable-file — new Design Studio panel; UI strings are localized when this feature is finalized in the follow-up PR.
import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { parseCssColorExtended } from "@shared/color-utils";
import {
  DESIGN_TOKEN_GROUPS,
  groupDesignTokens,
  tokenGroupForType,
  type DesignToken,
  type DesignTokenGroup,
  type DesignTokenGroupName,
  type DesignTokenType,
} from "@shared/design-token-types";
import {
  IconBorderRadius,
  IconBrush,
  IconChevronDown,
  IconChevronRight,
  IconDownload,
  IconLetterCase,
  IconPalette,
  IconPlus,
  IconSearch,
  IconShadow,
  IconSpacingHorizontal,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { LeftPanelHeader } from "@/components/design/editor/LeftPanelHeader";
import { LeftPanelSearchField } from "@/components/design/editor/LeftPanelSearchField";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
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

interface IndexDesignTokensResult {
  designId: string;
  tokenCount: number;
  groups: DesignTokenGroup[];
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

function groupLabel(group: DesignTokenGroupName): {
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
} {
  switch (group) {
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

function TokenLeadingVisual({
  type,
  value,
  name,
  onColorCommit,
}: {
  type: DesignTokenType;
  value: string;
  /** Given for saved tokens: their swatch opens a color picker. */
  name?: string;
  onColorCommit?: (value: string) => Promise<void>;
}) {
  if (type === "color" && isColorValue(value)) {
    return (
      <span className="flex size-4 shrink-0 items-center justify-center">
        {name && onColorCommit && parseCssColorExtended(value) ? (
          <TokenColorPicker
            name={name}
            value={value}
            onCommit={onColorCommit}
          />
        ) : (
          <span
            className="size-4 rounded-[3px] ring-1 ring-inset ring-border"
            style={{ backgroundColor: value }}
            aria-hidden
          />
        )}
      </span>
    );
  }
  const { Icon } = groupLabel(tokenGroupForType(type));
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
        <TokenLeadingVisual
          type={token.type}
          value={token.value}
          name={token.name}
          onColorCommit={(value) => onColorCommit(token.cssVar, value)}
        />
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
  section: DesignTokenGroup;
  editingKey: string | null;
  editDraft: string;
  onStartEdit: (cssVar: string, currentValue: string) => void;
  onDraftChange: (v: string) => void;
  onCommit: () => void;
  onCancelEdit: () => void;
  draftRow?: React.ReactNode;
  onColorCommit: (cssVar: string, value: string) => Promise<void>;
}

function TokenGroupSection({
  section,
  editingKey,
  editDraft,
  onStartEdit,
  onDraftChange,
  onCommit,
  onCancelEdit,
  draftRow,
  onColorCommit,
}: TokenGroupSectionProps) {
  const [collapsed, setCollapsed] = useState(false);
  const { label, Icon } = groupLabel(section.group);

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

      {(!collapsed || draftRow) && (
        <div>
          {draftRow}
          {!collapsed &&
            section.tokens.map((token) => (
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
      )}
    </div>
  );
}

const TOKEN_MENU_CONTENT_CLASS = "rounded-[10px] p-0";
const TOKEN_MENU_ITEM_CLASS = "rounded-md px-2 py-1 text-sm leading-5";
const TOKEN_MENU_SEPARATOR_CLASS = "mx-0 my-0 bg-border";

function HeaderMenuTrigger({
  label,
  icon,
  disabled,
}: {
  label: string;
  icon: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 cursor-pointer rounded-md text-foreground"
            aria-label={label}
            disabled={disabled}
          >
            {icon}
          </Button>
        </DropdownMenuTrigger>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

type MenuTokenType = Exclude<DesignTokenType, "motion" | "other">;

const TOKEN_TYPE_MENU: MenuTokenType[][] = [
  ["color"],
  ["font-family", "font-weight", "font-size", "line-height", "letter-spacing"],
  ["spacing", "container", "breakpoint", "radius"],
  ["shadow", "opacity"],
];

function tokenTypeLabelKey(type: MenuTokenType): string {
  return `designEditor.tokens.types.${type.replace(/-(\w)/g, (_, c: string) => c.toUpperCase())}`;
}

const DRAFT_DEFAULT_VALUES: Record<MenuTokenType, string> = {
  color: "#000000", // guard:allow-raw-color — starter token value, not UI styling
  "font-family": "Inter, sans-serif",
  "font-weight": "400",
  "font-size": "16px",
  "line-height": "1.5",
  "letter-spacing": "0em",
  spacing: "16px",
  container: "1200px",
  breakpoint: "768px",
  radius: "8px",
  shadow: "0 1px 2px rgb(0 0 0 / 0.1)", // guard:allow-raw-color — starter shadow value
  opacity: "0.5",
};

interface TokenDraft {
  type: MenuTokenType;
  cssVar: string;
  value: string;
}

function nextDraftCssVar(type: MenuTokenType, taken: Set<string>): string {
  let n = 1;
  while (taken.has(`--${type}-${n}`)) n += 1;
  return `--${type}-${n}`;
}

function AddTokenMenu({
  onPick,
  disabled,
}: {
  onPick: (type: MenuTokenType) => void;
  /** Until the token list has loaded, a draft's default name could collide. */
  disabled: boolean;
}) {
  const t = useT();
  const label = t("designEditor.tokens.newToken");
  const pickedTypeRef = useRef<MenuTokenType | null>(null);
  return (
    <DropdownMenu>
      <HeaderMenuTrigger
        label={label}
        icon={<IconPlus className="size-4" />}
        disabled={disabled}
      />
      <DropdownMenuContent
        align="end"
        className={cn("w-[220px]", TOKEN_MENU_CONTENT_CLASS)}
        // The menu keeps focus trapped until its close animation ends, so the
        // draft row is started only here; starting it from onSelect mounts the
        // row while focus is still trapped and its value input never focuses.
        onCloseAutoFocus={(event) => {
          const type = pickedTypeRef.current;
          if (!type) return;
          pickedTypeRef.current = null;
          event.preventDefault();
          onPick(type);
        }}
      >
        {TOKEN_TYPE_MENU.map((section, index) => (
          <div key={section[0]}>
            {index > 0 && (
              <DropdownMenuSeparator className={TOKEN_MENU_SEPARATOR_CLASS} />
            )}
            {section.map((type) => (
              <DropdownMenuItem
                key={type}
                className={TOKEN_MENU_ITEM_CLASS}
                onSelect={() => {
                  pickedTypeRef.current = type;
                }}
              >
                {t(tokenTypeLabelKey(type))}
              </DropdownMenuItem>
            ))}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DraftTokenRow({
  draft,
  onChange,
  onCommit,
  onDiscard,
}: {
  draft: TokenDraft;
  onChange: (draft: TokenDraft) => void;
  onCommit: () => void;
  onDiscard: () => void;
}) {
  const t = useT();
  const valueRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    valueRef.current?.focus();
    valueRef.current?.select();
  }, [draft.type]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") onCommit();
    if (event.key === "Escape") onDiscard();
  };

  return (
    <div
      className={cn(
        "rounded-[4px] bg-[var(--design-editor-selection-color)] text-foreground",
        LAYER_ROW_GEOMETRY_CLASS,
      )}
      onBlur={(event) => {
        if (
          !document.hasFocus() ||
          event.currentTarget.contains(event.relatedTarget as Node | null)
        ) {
          return;
        }
        onCommit();
      }}
    >
      <LayerRowIndentSlots count={layerRowIndentCount(1)} />
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <TokenLeadingVisual type={draft.type} value={draft.value} />
        <Input
          aria-label={t("designEditor.tokens.cssVar")}
          value={draft.cssVar}
          onChange={(e) => onChange({ ...draft, cssVar: e.target.value })}
          onKeyDown={handleKeyDown}
          className="h-6 min-w-0 flex-1 px-1 py-0 font-mono !text-[11px] md:!text-[11px]"
        />
        <Input
          ref={valueRef}
          aria-label={t("designEditor.tokens.value")}
          value={draft.value}
          onChange={(e) => onChange({ ...draft, value: e.target.value })}
          onKeyDown={handleKeyDown}
          className="h-6 w-24 px-1 py-0 font-mono !text-[11px] md:!text-[11px]"
        />
      </div>
    </div>
  );
}

type TokenImportRequest =
  | {
      source: "files";
      files: TokenImportFile[];
      omittedFileCount: number;
      readFailureCount: number;
    }
  | { source: "paste"; text: string }
  | { source: "current-design" };

interface ImportTokensMenuProps {
  onImport: (request: TokenImportRequest) => Promise<ImportDesignTokensResult>;
  isPending: boolean;
}

const DTCG_ACCEPT = ".json,.tokens";
const CSS_OR_TAILWIND_ACCEPT =
  ".css,.scss,.less,.js,.cjs,.mjs,.jsx,.ts,.tsx,.html,.htm,.md,.mdx,.txt";

function ImportTokensMenu({ onImport, isPending }: ImportTokensMenuProps) {
  const t = useT();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const runImport = async (
    request: TokenImportRequest | (() => Promise<TokenImportRequest>),
  ) => {
    const id = toast.loading(t("designEditor.tokens.importing"));
    try {
      const result = await onImport(
        typeof request === "function" ? await request() : request,
      );
      const status = getTokenImportStatus(result);
      const message = status.values
        ? t(status.key, status.values)
        : t(status.key);
      if (result.importedCount > 0) {
        toast.success(message, { id });
      } else {
        toast.error(message, { id });
      }
    } catch (error) {
      toast.error(
        t("designEditor.tokens.importFailed", {
          message: error instanceof Error ? error.message : String(error),
        }),
        { id },
      );
    }
  };

  // One hidden input serves both file items, so `accept` is set on the node
  // right before click() rather than rendered as a prop.
  const pickFiles = (accept: string) => {
    const input = fileInputRef.current;
    if (!input) return;
    input.accept = accept;
    input.click();
  };

  const pasteFromClipboard = async () => {
    let text: string;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      toast.error(t("designEditor.tokens.clipboardBlocked"));
      return;
    }
    if (!text.trim()) {
      toast.error(t("designEditor.tokens.clipboardEmpty"));
      return;
    }
    void runImport({ source: "paste", text });
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = snapshotImportFiles(event.currentTarget);
    if (files.length === 0) return;
    void runImport(async () => ({
      source: "files",
      ...(await readImportFiles(files)),
    }));
  };

  return (
    <>
      <DropdownMenu>
        <HeaderMenuTrigger
          label={t("designEditor.tokens.import")}
          icon={<IconDownload className="size-4" />}
        />
        <DropdownMenuContent
          align="end"
          className={cn("w-[240px]", TOKEN_MENU_CONTENT_CLASS)}
        >
          <DropdownMenuItem
            className={TOKEN_MENU_ITEM_CLASS}
            disabled={isPending}
            onSelect={() => pickFiles(DTCG_ACCEPT)}
          >
            {t("designEditor.tokens.importDtcg")}
          </DropdownMenuItem>
          <DropdownMenuItem
            className={TOKEN_MENU_ITEM_CLASS}
            disabled={isPending}
            onSelect={() => pickFiles(CSS_OR_TAILWIND_ACCEPT)}
          >
            {t("designEditor.tokens.importCssOrTailwind")}
          </DropdownMenuItem>
          <DropdownMenuItem
            className={TOKEN_MENU_ITEM_CLASS}
            disabled={isPending}
            onSelect={() => void pasteFromClipboard()}
          >
            {t("designEditor.tokens.importClipboard")}
          </DropdownMenuItem>
          <DropdownMenuSeparator className={TOKEN_MENU_SEPARATOR_CLASS} />
          <DropdownMenuItem
            className={TOKEN_MENU_ITEM_CLASS}
            disabled={isPending}
            onSelect={() => void runImport({ source: "current-design" })}
          >
            {t("designEditor.tokens.importFromDesign")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileChange}
      />
    </>
  );
}

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

  const queryClient = useQueryClient();
  const tokensQueryKey = ["action", "index-design-tokens", { designId }];
  const applyMutation = useActionMutation("apply-design-token-edit");
  const importMutation = useActionMutation("import-design-tokens");

  const designIdRef = useRef(designId);
  designIdRef.current = designId;

  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [tokenDraft, setTokenDraftState] = useState<TokenDraft | null>(null);
  const tokenDraftRef = useRef<TokenDraft | null>(null);

  // The draft row commits on blur, and Enter/Escape also unmount it; the ref
  // makes the first of those win so a discarded draft is never saved.
  const setTokenDraft = (draft: TokenDraft | null) => {
    tokenDraftRef.current = draft;
    setTokenDraftState(draft);
  };

  const startEdit = (cssVar: string, currentValue: string) => {
    setEditingKey(cssVar);
    setEditDraft(currentValue);
  };

  const cancelEdit = () => {
    setEditingKey(null);
    setEditDraft("");
  };

  const applyTokenEdit = (
    cssVar: string,
    value: string,
    options?: { type?: DesignTokenType; onError?: (error: Error) => void },
  ) => {
    const requestDesignId = designId;
    const type = options?.type;
    // mutateAsync, not mutate(vars, callbacks): per-call callbacks only fire
    // for the latest call, so an earlier save failing while a newer one is in
    // flight would skip its rollback.
    applyMutation
      .mutateAsync({
        designId,
        edits: [{ cssVar, value, ...(type ? { type } : {}) }],
      })
      .then(
        (result) => {
          if (designIdRef.current !== requestDesignId) return;
          void refetch();
          const r = result as { resolvedCssVars?: Record<string, string> };
          if (r?.resolvedCssVars && onTokensApplied) {
            onTokensApplied(r.resolvedCssVars);
          }
        },
        (error: unknown) => {
          if (designIdRef.current !== requestDesignId) return;
          options?.onError?.(
            error instanceof Error ? error : new Error(String(error)),
          );
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

  const startTokenDraft = (type: MenuTokenType) => {
    const taken = new Set((data?.tokens ?? []).map((token) => token.cssVar));
    setSearch("");
    setSearchOpen(false);
    setTokenDraft({
      type,
      cssVar: nextDraftCssVar(type, taken),
      value: DRAFT_DEFAULT_VALUES[type],
    });
  };

  const commitTokenDraft = () => {
    const draft = tokenDraftRef.current;
    if (!draft) return;
    setTokenDraft(null);
    const value = draft.value.trim();
    if (!draft.cssVar.trim() || !value) return;
    const cssVar = normalizeCssVarName(draft.cssVar);
    const pending: DesignToken = {
      name: friendlyTokenName(cssVar),
      cssVar,
      value,
      type: draft.type,
      source: "Tweaks",
    };
    // Patch the current list rather than restoring a snapshot on failure: a
    // snapshot would also undo any save that landed after this one started.
    const updateTokens = (update: (tokens: DesignToken[]) => DesignToken[]) =>
      queryClient.setQueryData<IndexDesignTokensResult>(
        tokensQueryKey,
        (current) => {
          if (!current) return current;
          const tokens = update(current.tokens);
          return {
            ...current,
            tokenCount: tokens.length,
            groups: groupDesignTokens(tokens),
            tokens,
          };
        },
      );
    void queryClient.cancelQueries({ queryKey: tokensQueryKey, exact: true });
    updateTokens((tokens) => [
      ...tokens.filter((token) => token.cssVar !== cssVar),
      pending,
    ]);
    applyTokenEdit(cssVar, value, {
      type: draft.type,
      onError: (error) => {
        updateTokens((tokens) =>
          tokens.filter((token) => token.cssVar !== cssVar),
        );
        void refetch();
        // A newer draft may be open by now; keep it rather than its edits.
        if (!tokenDraftRef.current) setTokenDraft(draft);
        toast.error(
          t("designEditor.tokens.addFailed", { message: error.message }),
        );
      },
    });
  };

  const importTokens = async (
    request: TokenImportRequest,
  ): Promise<ImportDesignTokensResult> => {
    if (request.source === "files" && request.files.length === 0) {
      return createEmptyFilesImportResult(
        designId,
        request.omittedFileCount,
        request.readFailureCount,
      );
    }
    const requestDesignId = designId;
    const response = (await importMutation.mutateAsync(
      request.source === "files"
        ? { designId, source: "files", files: request.files }
        : { designId, ...request },
    )) as ImportDesignTokensResult;
    // Files the browser skipped or could not read never reach the server, so
    // their counts are added to its result for the status message.
    const result =
      request.source === "files"
        ? {
            ...response,
            omittedFileCount:
              (response.omittedFileCount ?? 0) + request.omittedFileCount,
            readFailureCount: request.readFailureCount,
          }
        : response;
    if (designIdRef.current !== requestDesignId) return result;
    void refetch();
    if (result.resolvedCssVars && onTokensApplied) {
      onTokensApplied(result.resolvedCssVars);
    }
    return result;
  };

  const tokenCount = data?.tokenCount ?? 0;
  const showSearch = searchOpen || Boolean(search.trim());
  const query = search.trim().toLowerCase();
  const indexedGroups = data?.groups;
  const draftGroup = tokenDraft ? tokenGroupForType(tokenDraft.type) : null;
  const allGroups = useMemo(() => {
    const indexed = indexedGroups ?? [];
    if (
      !draftGroup ||
      indexed.some((section) => section.group === draftGroup)
    ) {
      return indexed;
    }
    return DESIGN_TOKEN_GROUPS.flatMap((group) =>
      group === draftGroup
        ? [{ group, tokens: [] }]
        : indexed.filter((section) => section.group === group),
    );
  }, [indexedGroups, draftGroup]);
  const groups = useMemo(() => {
    if (!query) return allGroups;
    return allGroups
      .map((section) => ({
        ...section,
        tokens: section.tokens.filter((token) =>
          [token.name, token.cssVar, token.value].some((field) =>
            field.toLowerCase().includes(query),
          ),
        ),
      }))
      .filter((section) => section.tokens.length > 0);
  }, [allGroups, query]);
  const hasTokens = allGroups.length > 0;
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
        <ImportTokensMenu
          onImport={importTokens}
          isPending={importMutation.isPending}
        />
        <AddTokenMenu onPick={startTokenDraft} disabled={!data} />
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
            {groups.map((section) => (
              <TokenGroupSection
                key={section.group}
                section={section}
                editingKey={editingKey}
                editDraft={editDraft}
                onStartEdit={startEdit}
                onDraftChange={setEditDraft}
                onCommit={commitEdit}
                onCancelEdit={cancelEdit}
                draftRow={
                  tokenDraft && section.group === draftGroup ? (
                    <DraftTokenRow
                      draft={tokenDraft}
                      onChange={setTokenDraft}
                      onCommit={commitTokenDraft}
                      onDiscard={() => setTokenDraft(null)}
                    />
                  ) : undefined
                }
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
