import { friendlyTokenName } from "@agent-native/core/brand-kit";
// i18n-raw-literal-disable-file — new Design Studio panel; UI strings are localized when this feature is finalized in the follow-up PR.
import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  DESIGN_TOKEN_TYPES,
  groupDesignTokens,
  tokenTypeForKind,
  type DesignToken,
  type DesignTokenGroup,
  type DesignTokenKind,
  type DesignTokenType,
} from "@shared/design-token-kinds";
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
  resolvedCssVars?: Record<string, string>;
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

function TokenLeadingVisual({
  type,
  value,
}: {
  type: DesignTokenType;
  value: string;
}) {
  if (type === "color" && isColorValue(value)) {
    return (
      <span className="flex size-4 shrink-0 items-center justify-center">
        <span
          className="size-4 rounded-[3px] ring-1 ring-inset ring-border"
          style={{ backgroundColor: value }}
          aria-hidden
        />
      </span>
    );
  }
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

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  return (
    <div
      className={cn(
        "group flex h-8 items-center gap-2 px-4 transition-colors hover:bg-accent/40",
        editing && "bg-accent/60",
      )}
    >
      <span className="size-4 shrink-0" aria-hidden />
      <TokenLeadingVisual type={token.type} value={token.value} />
      <button
        type="button"
        className="min-w-0 flex-1 cursor-pointer truncate bg-transparent p-0 text-left !text-[11px] leading-4 tracking-[0.055px] text-foreground"
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
          className="max-w-[6rem] shrink-0 cursor-pointer truncate bg-transparent p-0 text-right font-mono !text-[11px] leading-4 text-muted-foreground hover:text-foreground"
          title={token.value}
          aria-label={`Edit value for ${token.name}`}
          onClick={onStartEdit}
        >
          {token.value}
        </button>
      )}
    </div>
  );
}

interface TokenGroupSectionProps {
  group: DesignTokenGroup;
  editingKey: string | null;
  editDraft: string;
  onStartEdit: (cssVar: string, currentValue: string) => void;
  onDraftChange: (v: string) => void;
  onCommit: () => void;
  onCancelEdit: () => void;
  draftRow?: React.ReactNode;
}

function TokenGroupSection({
  group,
  editingKey,
  editDraft,
  onStartEdit,
  onDraftChange,
  onCommit,
  onCancelEdit,
  draftRow,
}: TokenGroupSectionProps) {
  const [collapsed, setCollapsed] = useState(false);
  const { label } = typeLabel(group.type);

  return (
    <div className="border-t border-border first:border-t-0">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        className="flex h-10 w-full cursor-pointer items-center pr-3 text-left hover:bg-accent/30"
      >
        <span className="flex size-4 shrink-0 items-center justify-center">
          {collapsed ? (
            <IconChevronRight className="size-3" />
          ) : (
            <IconChevronDown className="size-3" />
          )}
        </span>
        <span className="min-w-0 flex-1 truncate !text-[11px] font-[550] leading-4 tracking-[0.055px] text-foreground">
          {label}
        </span>
      </button>

      {(!collapsed || draftRow) && (
        <div>
          {draftRow}
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
}: {
  label: string;
  icon: React.ReactNode;
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
          >
            {icon}
          </Button>
        </DropdownMenuTrigger>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

const TOKEN_KIND_MENU: DesignTokenKind[][] = [
  ["color"],
  ["font-family", "font-weight", "font-size", "line-height", "letter-spacing"],
  ["spacing", "container", "breakpoint", "radius"],
  ["shadow", "opacity"],
];

function tokenKindLabelKey(kind: DesignTokenKind): string {
  return `designEditor.tokens.kinds.${kind.replace(/-(\w)/g, (_, c: string) => c.toUpperCase())}`;
}

const DRAFT_DEFAULT_VALUES: Record<DesignTokenKind, string> = {
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
  kind: DesignTokenKind;
  cssVar: string;
  value: string;
}

function nextDraftCssVar(kind: DesignTokenKind, taken: Set<string>): string {
  let n = 1;
  while (taken.has(`--${kind}-${n}`)) n += 1;
  return `--${kind}-${n}`;
}

function AddTokenMenu({ onPick }: { onPick: (kind: DesignTokenKind) => void }) {
  const t = useT();
  const label = t("designEditor.tokens.newToken");
  const pickedKindRef = useRef<DesignTokenKind | null>(null);
  return (
    <DropdownMenu>
      <HeaderMenuTrigger label={label} icon={<IconPlus className="size-4" />} />
      <DropdownMenuContent
        align="end"
        className={cn("w-[220px]", TOKEN_MENU_CONTENT_CLASS)}
        // The menu keeps focus trapped until its close animation ends, so the
        // draft row is started only here; starting it from onSelect mounts the
        // row while focus is still trapped and its value input never focuses.
        onCloseAutoFocus={(event) => {
          const kind = pickedKindRef.current;
          if (!kind) return;
          pickedKindRef.current = null;
          event.preventDefault();
          onPick(kind);
        }}
      >
        {TOKEN_KIND_MENU.map((section, index) => (
          <div key={section[0]}>
            {index > 0 && (
              <DropdownMenuSeparator className={TOKEN_MENU_SEPARATOR_CLASS} />
            )}
            {section.map((kind) => (
              <DropdownMenuItem
                key={kind}
                className={TOKEN_MENU_ITEM_CLASS}
                onSelect={() => {
                  pickedKindRef.current = kind;
                }}
              >
                {t(tokenKindLabelKey(kind))}
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
  const type = tokenTypeForKind(draft.kind);

  useEffect(() => {
    valueRef.current?.focus();
    valueRef.current?.select();
  }, [draft.kind]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") onCommit();
    if (event.key === "Escape") onDiscard();
  };

  return (
    <div
      className="flex h-8 items-center gap-2 bg-accent/60 px-4"
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
          return;
        }
        onCommit();
      }}
    >
      <span className="size-4 shrink-0" aria-hidden />
      <TokenLeadingVisual type={type} value={draft.value} />
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
  );
}

interface ImportTokensMenuProps {
  onImportFiles: (
    files: TokenImportFile[],
  ) => Promise<ImportDesignTokensResult>;
  onImportText: (text: string) => Promise<ImportDesignTokensResult>;
  onImportCurrentDesign: () => Promise<ImportDesignTokensResult>;
  isPending: boolean;
}

const DTCG_ACCEPT = ".json,.tokens";
const CSS_OR_TAILWIND_ACCEPT = ".css,.scss,.sass,.less,.js,.cjs,.mjs,.ts";

function ImportTokensMenu({
  onImportFiles,
  onImportText,
  onImportCurrentDesign,
  isPending,
}: ImportTokensMenuProps) {
  const t = useT();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const runImport = async (
    importer: () => Promise<ImportDesignTokensResult>,
  ) => {
    const id = toast.loading(t("designEditor.tokens.importing"));
    try {
      const { importedCount } = await importer();
      if (importedCount > 0) {
        toast.success(
          t("designEditor.tokens.importedCount", { count: importedCount }),
          { id },
        );
      } else {
        toast.error(t("designEditor.tokens.importNone"), { id });
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
    void runImport(() => onImportText(text));
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    // Copy before clearing: resetting `value` empties the live FileList.
    const files = [...(event.currentTarget.files ?? [])];
    event.currentTarget.value = "";
    if (!files.length) return;
    void runImport(async () => onImportFiles(await readImportFiles(files)));
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
            onSelect={() => void runImport(onImportCurrentDesign)}
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

async function readImportFiles(fileList: File[]): Promise<TokenImportFile[]> {
  const selected = fileList.slice(0, 20);
  const files = await Promise.all(
    selected.map(async (file) => ({
      filename: file.name,
      content: await file.text(),
    })),
  );

  return files.filter((file) => file.content.trim().length > 0);
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

  const [search, setSearch] = useState<string | null>(null);
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
    options?: { kind?: DesignTokenKind; onError?: (error: Error) => void },
  ) => {
    const requestDesignId = designId;
    const kind = options?.kind;
    applyMutation.mutate(
      { designId, edits: [{ cssVar, value, ...(kind ? { kind } : {}) }] },
      {
        onError: (error) => {
          if (designIdRef.current !== requestDesignId) return;
          options?.onError?.(
            error instanceof Error ? error : new Error(String(error)),
          );
        },
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

  const startTokenDraft = (kind: DesignTokenKind) => {
    const taken = new Set((data?.tokens ?? []).map((token) => token.cssVar));
    setSearch(null);
    setTokenDraft({
      kind,
      cssVar: nextDraftCssVar(kind, taken),
      value: DRAFT_DEFAULT_VALUES[kind],
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
      type: tokenTypeForKind(draft.kind),
      kind: draft.kind,
      source: "Tweaks",
    };
    const previous =
      queryClient.getQueryData<IndexDesignTokensResult>(tokensQueryKey);
    if (previous) {
      void queryClient.cancelQueries({ queryKey: tokensQueryKey, exact: true });
      const tokens = [
        ...previous.tokens.filter((token) => token.cssVar !== cssVar),
        pending,
      ];
      queryClient.setQueryData<IndexDesignTokensResult>(tokensQueryKey, {
        ...previous,
        tokenCount: tokens.length,
        groups: groupDesignTokens(tokens),
        tokens,
      });
    }
    applyTokenEdit(cssVar, value, {
      kind: draft.kind,
      onError: (error) => {
        if (previous) queryClient.setQueryData(tokensQueryKey, previous);
        setTokenDraft(draft);
        toast.error(
          t("designEditor.tokens.addFailed", { message: error.message }),
        );
      },
    });
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

  const importFiles = async (files: TokenImportFile[]) => {
    const requestDesignId = designId;
    const result = (await importMutation.mutateAsync({
      designId,
      source: "files",
      files,
    })) as ImportDesignTokensResult;
    return handleImportSuccess(result, requestDesignId);
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
  const searchOpen = search !== null;
  const query = (search ?? "").trim().toLowerCase();
  const indexedGroups = data?.groups;
  const draftType = tokenDraft ? tokenTypeForKind(tokenDraft.kind) : null;
  const allGroups = useMemo(() => {
    const indexed = indexedGroups ?? [];
    if (!draftType || indexed.some((group) => group.type === draftType)) {
      return indexed;
    }
    return DESIGN_TOKEN_TYPES.flatMap((type) =>
      type === draftType
        ? [{ type, tokens: [] }]
        : indexed.filter((group) => group.type === type),
    );
  }, [indexedGroups, draftType]);
  const groups = useMemo(() => {
    if (!query) return allGroups;
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
  const hasTokens = allGroups.length > 0;

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
              aria-pressed={searchOpen}
              onClick={() => setSearch(searchOpen ? null : "")}
            >
              <IconSearch className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("designEditor.tokens.search")}</TooltipContent>
        </Tooltip>
        <ImportTokensMenu
          onImportFiles={importFiles}
          onImportText={importText}
          onImportCurrentDesign={importCurrentDesign}
          isPending={importMutation.isPending}
        />
        <AddTokenMenu onPick={startTokenDraft} />
      </LeftPanelHeader>

      {searchOpen && (
        <div className="shrink-0 border-b border-border px-2 py-1.5">
          <Input
            autoFocus
            value={search ?? ""}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setSearch(null);
            }}
            aria-label={t("designEditor.tokens.search")}
            placeholder={t("designEditor.tokens.search")}
            className="h-7 !text-xs md:!text-xs"
          />
        </div>
      )}

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
          <p className="px-4 py-6 text-center !text-[11px] text-muted-foreground">
            {t("designEditor.tokens.noMatches")}
          </p>
        )}

        {!isLoading && groups.length > 0 && (
          <div>
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
                draftRow={
                  tokenDraft && group.type === draftType ? (
                    <DraftTokenRow
                      draft={tokenDraft}
                      onChange={setTokenDraft}
                      onCommit={commitTokenDraft}
                      onDiscard={() => setTokenDraft(null)}
                    />
                  ) : undefined
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
