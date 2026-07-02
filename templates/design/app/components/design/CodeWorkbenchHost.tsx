import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import {
  IconCode,
  IconDeviceFloppy,
  IconFileCode,
  IconFolder,
  IconRefresh,
  IconSearch,
} from "@tabler/icons-react";
import * as monaco from "monaco-editor";

import "monaco-editor/min/vs/editor/editor.main.css";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import CssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import HtmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import TypeScriptWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

interface CodeWorkbenchTheme {
  colorScheme: "light" | "dark";
  values: Record<string, string>;
}

interface CodeWorkbenchDraft {
  content: string;
  baseVersionHash?: string;
}

export interface CodeWorkbenchActiveFile {
  path: string;
  fileId?: string;
  dirty: boolean;
  versionHash?: string;
  backendKind: "virtual-inline";
}

interface CodeWorkbenchHostProps {
  designId: string;
  activeFileId?: string | null;
  activeFilename?: string | null;
  selectedNodeId?: string | null;
  selectedSelector?: string | null;
  canEdit: boolean;
  onActiveFileChange?: (file: CodeWorkbenchActiveFile | null) => void;
}

const WORKBENCH_THEME_VARS: Record<string, string[]> = {
  "--workbench-bg": ["--design-editor-panel-bg", "--background"],
  "--workbench-sidebar-bg": ["--design-editor-panel-bg", "--card"],
  "--workbench-editor-bg": ["--design-editor-panel-bg", "--background"],
  "--workbench-surface-bg": ["--design-editor-control-bg", "--muted"],
  "--workbench-border": ["--design-editor-control-border", "--border"],
  "--workbench-fg": ["--foreground"],
  "--workbench-muted-fg": ["--muted-foreground"],
  "--workbench-hover-bg": ["--design-editor-layer-hover-color", "--accent"],
  "--workbench-active-bg": ["--design-editor-selection-color", "--accent"],
  "--workbench-active-fg": [
    "--design-editor-accent-color",
    "--accent-foreground",
  ],
  "--workbench-accent": ["--design-editor-accent-color", "--primary"],
  "--workbench-button-bg": ["--design-editor-control-bg", "--background"],
  "--workbench-button-fg": ["--foreground"],
  "--workbench-selection-bg": ["--design-editor-selection-color", "--accent"],
  "--workbench-dirty": ["--warning", "--destructive"],
};

function normalizeThemeColorValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^-?\d+(\.\d+)?\s+-?\d+(\.\d+)?%/.test(trimmed)) {
    return `hsl(${trimmed})`;
  }
  return trimmed;
}

function resolveCssColorValue(value: string): string {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return value;
  }
  const probe = document.createElement("span");
  probe.style.color = value;
  probe.style.position = "fixed";
  probe.style.pointerEvents = "none";
  probe.style.visibility = "hidden";
  document.body.appendChild(probe);
  const resolved = window.getComputedStyle(probe).color;
  probe.remove();
  return resolved || value;
}

function readThemeVar(
  elementStyles: CSSStyleDeclaration,
  rootStyles: CSSStyleDeclaration,
  names: string[],
): string | undefined {
  for (const name of names) {
    const value =
      elementStyles.getPropertyValue(name) || rootStyles.getPropertyValue(name);
    const normalized = normalizeThemeColorValue(value);
    if (normalized) return resolveCssColorValue(normalized);
  }
  return undefined;
}

function readCodeWorkbenchTheme(
  element: HTMLElement | null,
): CodeWorkbenchTheme {
  if (typeof window === "undefined" || !element) {
    return { colorScheme: "light", values: {} };
  }
  const elementStyles = window.getComputedStyle(element);
  const rootStyles = window.getComputedStyle(document.documentElement);
  const values: Record<string, string> = {};
  for (const [targetVar, sourceVars] of Object.entries(WORKBENCH_THEME_VARS)) {
    const value = readThemeVar(elementStyles, rootStyles, sourceVars);
    if (value) values[targetVar] = value;
  }
  const colorScheme =
    document.documentElement.classList.contains("dark") ||
    elementStyles.colorScheme.includes("dark") ||
    rootStyles.colorScheme.includes("dark")
      ? "dark"
      : "light";
  return { colorScheme, values };
}

let monacoEnvironmentInstalled = false;

function ensureMonacoEnvironment() {
  if (monacoEnvironmentInstalled || typeof window === "undefined") return;
  (
    globalThis as typeof globalThis & { MonacoEnvironment?: unknown }
  ).MonacoEnvironment = {
    getWorker(_moduleId: string, label: string) {
      if (label === "css" || label === "scss" || label === "less") {
        return new CssWorker();
      }
      if (label === "html" || label === "handlebars" || label === "razor") {
        return new HtmlWorker();
      }
      if (label === "json") return new JsonWorker();
      if (label === "typescript" || label === "javascript") {
        return new TypeScriptWorker();
      }
      return new EditorWorker();
    },
  };
  monacoEnvironmentInstalled = true;
}

function languageForPath(path: string, language?: string): string {
  if (language === "html" || /\.html?$/i.test(path)) return "html";
  if (language === "css" || /\.css$/i.test(path)) return "css";
  if (language === "json" || /\.json$/i.test(path)) return "json";
  if (language === "typescript" || /\.tsx?$/i.test(path)) return "typescript";
  if (language === "javascript" || /\.jsx?$/i.test(path)) return "javascript";
  return language || "plaintext";
}

function extensionBadgeForPath(path: string): string {
  if (/\.css$/i.test(path)) return "CSS";
  if (/\.tsx$/i.test(path)) return "TSX";
  if (/\.ts$/i.test(path)) return "TS";
  if (/\.jsx$/i.test(path)) return "JSX";
  if (/\.js$/i.test(path)) return "JS";
  if (/\.json$/i.test(path)) return "{}";
  if (/\.html?$/i.test(path)) return "<>";
  return "TXT";
}

function editorUriForPath(designId: string, path: string) {
  return monaco.Uri.from({
    scheme: "designfs",
    authority: designId,
    path: `/${path.replace(/^\/+/, "")}`,
  });
}

function defineMonacoTheme(theme: CodeWorkbenchTheme): string {
  const dark = theme.colorScheme === "dark";
  const values = theme.values;
  const name = dark
    ? "design-code-workbench-dark"
    : "design-code-workbench-light";
  const colors = Object.fromEntries(
    Object.entries({
      "editor.background": values["--workbench-editor-bg"],
      "editor.foreground": values["--workbench-fg"],
      "editor.lineHighlightBackground": values["--workbench-hover-bg"],
      "editor.selectionBackground": values["--workbench-selection-bg"],
      "editor.inactiveSelectionBackground": values["--workbench-active-bg"],
      "editorCursor.foreground": values["--workbench-accent"],
      "editorLineNumber.foreground": values["--workbench-muted-fg"],
      "editorLineNumber.activeForeground": values["--workbench-fg"],
      "editorIndentGuide.background1": values["--workbench-border"],
      "editorIndentGuide.activeBackground1": values["--workbench-muted-fg"],
      "editorWidget.background": values["--workbench-surface-bg"],
      "editorWidget.border": values["--workbench-border"],
      focusBorder: values["--workbench-accent"],
    }).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === "string" && entry[1].length > 0,
    ),
  );
  monaco.editor.defineTheme(name, {
    base: dark ? "vs-dark" : "vs",
    inherit: true,
    rules: [],
    colors,
  });
  return name;
}

const MONACO_FONT_FAMILY =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';

export function CodeWorkbenchHost({
  designId,
  activeFileId,
  activeFilename,
  selectedNodeId,
  selectedSelector,
  canEdit,
  onActiveFileChange,
}: CodeWorkbenchHostProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorHostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const modelRef = useRef<monaco.editor.ITextModel | null>(null);
  const applyingModelContentRef = useRef(false);
  const contentChangeRef = useRef<(content: string) => void>(() => {});
  const saveCommandRef = useRef<(() => void) | null>(null);
  const lastExternalTargetKeyRef = useRef<string | null>(null);
  const lastSelectionKeyRef = useRef<string | null>(null);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [draftsByPath, setDraftsByPath] = useState<
    Record<string, CodeWorkbenchDraft>
  >({});
  const [editorReady, setEditorReady] = useState(false);
  const [cursorLabel, setCursorLabel] = useState("Ln 1, Col 1");
  const [previewSummary, setPreviewSummary] = useState<string | null>(null);
  const [theme, setTheme] = useState<CodeWorkbenchTheme>(() => ({
    colorScheme: "light",
    values: {},
  }));

  const sourceFilesQuery = useActionQuery("list-source-files", { designId });
  const sourceFiles = (sourceFilesQuery.data as any)?.files ?? [];
  const backend = (sourceFilesQuery.data as any)?.backend;
  const selectedPath =
    activePath ?? activeFilename ?? sourceFiles[0]?.path ?? "";
  const readSourceQuery = useActionQuery(
    "read-source-file",
    { designId, path: selectedPath },
    { enabled: Boolean(selectedPath) },
  );
  const readSource = readSourceQuery.data as any;
  const previewSourceEditMutation = useActionMutation("preview-source-edit");
  const applySourceEditMutation = useActionMutation("apply-source-edit");
  const savedContent = readSource?.content ?? "";
  const activeDraft = selectedPath ? draftsByPath[selectedPath] : undefined;
  const draftContent =
    activeDraft !== undefined ? activeDraft.content : savedContent;
  const expectedVersionHash =
    activeDraft?.baseVersionHash ?? readSource?.versionHash;
  const dirty = draftContent !== savedContent;
  const activeSourceFile = sourceFiles.find(
    (file: any) =>
      file.path === selectedPath ||
      (activeFileId && file.fileId === activeFileId),
  );
  const activeDisplayName =
    activeSourceFile?.displayName ?? readSource?.displayName ?? selectedPath;
  const activeLanguage = languageForPath(selectedPath, readSource?.language);
  const canEditSource = canEdit && readSource?.readonly !== true;
  const saving =
    previewSourceEditMutation.isPending || applySourceEditMutation.isPending;
  const workspaceUri = backend?.workspaceUri ?? `designfs://${designId}/`;
  const backendKind = backend?.kind ?? "virtual-inline";

  useEffect(() => {
    const updateTheme = () => {
      const nextTheme = readCodeWorkbenchTheme(containerRef.current);
      setTheme((current) =>
        current.colorScheme === nextTheme.colorScheme &&
        JSON.stringify(current.values) === JSON.stringify(nextTheme.values)
          ? current
          : nextTheme,
      );
    };
    updateTheme();
    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme"],
    });
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", updateTheme);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", updateTheme);
    };
  }, []);

  useEffect(() => {
    setActivePath(null);
    setDraftsByPath({});
    lastExternalTargetKeyRef.current = null;
    lastSelectionKeyRef.current = null;
    onActiveFileChange?.(null);
  }, [designId, onActiveFileChange]);

  useEffect(() => {
    const externalTargetKey = [activeFileId ?? "", activeFilename ?? ""].join(
      ":",
    );
    if (!activeFileId && !activeFilename) {
      lastExternalTargetKeyRef.current = null;
      return;
    }
    if (lastExternalTargetKeyRef.current === externalTargetKey) return;
    const match = sourceFiles.find(
      (file: any) =>
        file.fileId === activeFileId || file.path === activeFilename,
    );
    if (match?.path) {
      lastExternalTargetKeyRef.current = externalTargetKey;
      setActivePath(match.path);
    }
  }, [activeFileId, activeFilename, sourceFiles]);

  const setSelectedDraftContent = useCallback(
    (content: string) => {
      if (!selectedPath) return;
      setDraftsByPath((current) => {
        const next = { ...current };
        if (content === savedContent) {
          delete next[selectedPath];
        } else {
          next[selectedPath] = {
            content,
            baseVersionHash:
              current[selectedPath]?.baseVersionHash ?? readSource?.versionHash,
          };
        }
        return next;
      });
    },
    [readSource?.versionHash, savedContent, selectedPath],
  );

  const revertSelectedFile = useCallback(() => {
    setSelectedDraftContent(savedContent);
    setPreviewSummary(null);
  }, [savedContent, setSelectedDraftContent]);

  useEffect(() => {
    contentChangeRef.current = (content: string) => {
      setSelectedDraftContent(content);
      setPreviewSummary(null);
    };
  }, [setSelectedDraftContent]);

  const saveSelectedFile = useCallback(() => {
    if (!selectedPath || !dirty || !canEditSource || saving) return;
    const edit = { kind: "full-replace" as const, content: draftContent };
    previewSourceEditMutation.mutate(
      {
        designId,
        path: selectedPath,
        expectedVersionHash,
        edit,
      } as any,
      {
        onSuccess: (preview: any) => {
          if (preview?.okToApply === false) {
            toast.error(
              preview.message ||
                "Source file changed since it was read" /* i18n-ignore */,
            );
            return;
          }
          setPreviewSummary(
            preview?.diff?.summary ||
              `${preview?.editsApplied ?? 1} edit previewed` /* i18n-ignore */,
          );
          applySourceEditMutation.mutate(
            {
              designId,
              path: selectedPath,
              expectedVersionHash:
                preview?.currentVersionHash ?? expectedVersionHash,
              edit,
            } as any,
            {
              onSuccess: (result: any) => {
                setDraftsByPath((current) => {
                  const next = { ...current };
                  delete next[selectedPath];
                  return next;
                });
                setPreviewSummary(
                  result?.diff?.summary ||
                    "Saved through source actions" /* i18n-ignore */,
                );
                toast.success("Source file saved" /* i18n-ignore */);
              },
              onError: (error) => {
                toast.error(
                  error instanceof Error
                    ? error.message
                    : "Could not save source file" /* i18n-ignore */,
                );
              },
            },
          );
        },
        onError: (error) => {
          toast.error(
            error instanceof Error
              ? error.message
              : "Could not preview source edit" /* i18n-ignore */,
          );
        },
      },
    );
  }, [
    applySourceEditMutation,
    canEditSource,
    designId,
    dirty,
    draftContent,
    expectedVersionHash,
    previewSourceEditMutation,
    saving,
    selectedPath,
  ]);

  useEffect(() => {
    saveCommandRef.current = saveSelectedFile;
  }, [saveSelectedFile]);

  useEffect(() => {
    onActiveFileChange?.(
      selectedPath
        ? {
            path: selectedPath,
            fileId: readSource?.fileId ?? activeSourceFile?.fileId,
            dirty,
            versionHash: readSource?.versionHash,
            backendKind: "virtual-inline",
          }
        : null,
    );
  }, [
    activeSourceFile?.fileId,
    dirty,
    onActiveFileChange,
    readSource?.fileId,
    readSource?.versionHash,
    selectedPath,
  ]);

  useEffect(() => {
    ensureMonacoEnvironment();
    if (!editorHostRef.current || editorRef.current) return;
    const editor = monaco.editor.create(editorHostRef.current, {
      value: "",
      language: "html",
      theme: defineMonacoTheme(theme),
      automaticLayout: true,
      contextmenu: true,
      fontFamily: MONACO_FONT_FAMILY,
      fontSize: 12,
      lineHeight: 20,
      minimap: { enabled: true, scale: 0.75, showSlider: "mouseover" },
      bracketPairColorization: { enabled: true },
      guides: { bracketPairs: true, indentation: true },
      lineNumbers: "on",
      renderLineHighlight: "all",
      renderWhitespace: "selection",
      scrollBeyondLastLine: false,
      stickyScroll: { enabled: true },
      tabSize: 2,
      insertSpaces: true,
      wordWrap: "off",
    });
    editorRef.current = editor;
    setEditorReady(true);

    const updateCursorLabel = () => {
      const position = editor.getPosition();
      setCursorLabel(
        position
          ? `Ln ${position.lineNumber}, Col ${position.column}` /* i18n-ignore */
          : "Ln 1, Col 1" /* i18n-ignore */,
      );
    };
    const disposables = [
      editor.onDidChangeModelContent(() => {
        if (applyingModelContentRef.current) return;
        contentChangeRef.current(editor.getValue());
      }),
      editor.onDidChangeCursorPosition(updateCursorLabel),
    ];
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () =>
      saveCommandRef.current?.(),
    );
    updateCursorLabel();

    return () => {
      disposables.forEach((disposable) => disposable?.dispose?.());
      editor.dispose();
      modelRef.current?.dispose();
      modelRef.current = null;
      editorRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!editorRef.current) return;
    monaco.editor.setTheme(defineMonacoTheme(theme));
  }, [theme]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !selectedPath) return;
    const uri = editorUriForPath(designId, selectedPath);
    const language = activeLanguage;
    const currentModel = modelRef.current;
    if (currentModel?.uri.toString() !== uri.toString()) {
      currentModel?.dispose();
      const nextModel = monaco.editor.createModel(draftContent, language, uri);
      modelRef.current = nextModel;
      editor.setModel(nextModel);
    } else if (currentModel) {
      monaco.editor.setModelLanguage(currentModel, language);
      if (currentModel.getValue() !== draftContent) {
        applyingModelContentRef.current = true;
        currentModel.setValue(draftContent);
        applyingModelContentRef.current = false;
      }
    }
    editor.updateOptions({
      readOnly: !canEditSource,
      readOnlyMessage: {
        value: canEdit
          ? "This source backend is read-only in the current workspace." /* i18n-ignore */
          : "Ask an owner for edit access before changing this file." /* i18n-ignore */,
      },
    });
  }, [
    activeLanguage,
    canEdit,
    canEditSource,
    designId,
    draftContent,
    selectedPath,
  ]);

  useEffect(() => {
    const editor = editorRef.current;
    const model = modelRef.current;
    if (!editor || !model || !selectedPath) return;
    const key = [
      selectedPath,
      selectedNodeId ?? "",
      selectedSelector ?? "",
      readSource?.versionHash ?? "",
    ].join(":");
    if (lastSelectionKeyRef.current === key) return;
    lastSelectionKeyRef.current = key;
    const targets: string[] = [];
    if (selectedNodeId) {
      targets.push(`data-agent-native-node-id="${selectedNodeId}"`);
      targets.push(`data-code-layer-id="${selectedNodeId}"`);
      targets.push(selectedNodeId);
    }
    if (selectedSelector) targets.push(selectedSelector);
    for (const target of targets) {
      const index = draftContent.indexOf(target);
      if (index < 0) continue;
      const start = model.getPositionAt(index);
      const end = model.getPositionAt(index + target.length);
      const range = new monaco.Range(
        start.lineNumber,
        start.column,
        end.lineNumber,
        end.column,
      );
      editor.setSelection(range);
      editor.revealRangeInCenter(range, monaco.editor.ScrollType.Smooth);
      return;
    }
  }, [
    draftContent,
    readSource?.versionHash,
    selectedNodeId,
    selectedPath,
    selectedSelector,
  ]);

  return (
    <div
      ref={containerRef}
      className="flex min-h-0 flex-1 flex-col bg-[var(--workbench-bg)] text-[var(--workbench-fg)]"
      style={theme.values as CSSProperties}
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--workbench-border)] bg-[var(--workbench-surface-bg)] px-3">
        <IconCode className="size-4 text-[var(--design-editor-accent-color)]" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-xs font-semibold text-[var(--workbench-fg)]">
            {"Code" /* i18n-ignore */}
          </h3>
          <p className="truncate text-[10px] text-[var(--workbench-muted-fg)]">
            {workspaceUri}
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 px-2 text-[11px]"
          disabled={!dirty || saving}
          onClick={revertSelectedFile}
        >
          <IconRefresh className="size-3" />
          {"Revert" /* i18n-ignore */}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 px-2 text-[11px]"
          disabled={!dirty || !canEditSource || saving}
          onClick={saveSelectedFile}
        >
          {saving ? (
            <Spinner className="size-3" />
          ) : (
            <IconDeviceFloppy className="size-3" />
          )}
          {"Save" /* i18n-ignore */}
        </Button>
      </div>
      <div
        className={cn(
          "grid min-h-0 flex-1 grid-cols-[210px_minmax(0,1fr)] bg-[var(--workbench-editor-bg)]",
          (sourceFilesQuery.isLoading || readSourceQuery.isLoading) &&
            "opacity-80",
        )}
      >
        <aside className="flex min-h-0 flex-col border-r border-[var(--workbench-border)] bg-[var(--workbench-sidebar-bg)]">
          <div className="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--workbench-border)] px-3 text-[11px] font-semibold uppercase tracking-[0.11em] text-[var(--workbench-muted-fg)]">
            <IconFolder className="size-3.5" />
            {"Explorer" /* i18n-ignore */}
          </div>
          <div className="flex h-8 shrink-0 items-center gap-2 border-b border-[var(--workbench-border)] px-3 text-[11px] text-[var(--workbench-muted-fg)]">
            <IconSearch className="size-3.5" />
            <span className="truncate">
              {"Use Cmd/Ctrl+F in editor" /* i18n-ignore */}
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto py-1">
            {sourceFiles.length > 0 ? (
              sourceFiles.map((file: any) => {
                const active = file.path === selectedPath;
                const disabled = file.readonly && !canEdit;
                return (
                  <button
                    key={file.path}
                    type="button"
                    title={file.path}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex h-7 w-full min-w-0 cursor-pointer items-center gap-2 px-2 text-left text-xs text-[var(--workbench-muted-fg)] outline-none hover:bg-[var(--workbench-hover-bg)] hover:text-[var(--workbench-fg)] focus-visible:ring-1 focus-visible:ring-[var(--workbench-accent)]",
                      active &&
                        "bg-[var(--workbench-active-bg)] text-[var(--workbench-active-fg)]",
                      disabled && "opacity-60",
                    )}
                    onClick={() => {
                      setActivePath(file.path);
                      setPreviewSummary(null);
                    }}
                  >
                    <span className="w-7 shrink-0 font-mono text-[10px] text-[var(--workbench-accent)]">
                      {extensionBadgeForPath(file.path)}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {file.displayName || file.path}
                    </span>
                    {draftsByPath[file.path] ? (
                      <span className="size-1.5 shrink-0 rounded-full bg-[var(--workbench-dirty)]" />
                    ) : null}
                  </button>
                );
              })
            ) : (
              <p className="px-3 py-4 text-xs text-[var(--workbench-muted-fg)]">
                {"No inline source files" /* i18n-ignore */}
              </p>
            )}
          </div>
          <div className="border-t border-[var(--workbench-border)] px-3 py-2 text-[11px] leading-4 text-[var(--workbench-muted-fg)]">
            <div className="truncate">{backendKind}</div>
            <div className="truncate">{workspaceUri}</div>
          </div>
        </aside>

        <main className="flex min-h-0 min-w-0 flex-col bg-[var(--workbench-editor-bg)]">
          <div className="flex h-9 shrink-0 items-center border-b border-[var(--workbench-border)] bg-[var(--workbench-surface-bg)]">
            <div className="flex h-full max-w-[360px] items-center gap-2 border-r border-[var(--workbench-border)] px-3 text-xs text-[var(--workbench-fg)]">
              <IconFileCode className="size-3.5 text-[var(--workbench-accent)]" />
              <span className="min-w-0 truncate">
                {activeDisplayName || "No file" /* i18n-ignore */}
              </span>
              {dirty ? (
                <span className="size-1.5 shrink-0 rounded-full bg-[var(--workbench-dirty)]" />
              ) : null}
            </div>
            <div className="ml-auto flex min-w-0 items-center gap-3 px-3 text-[11px] text-[var(--workbench-muted-fg)]">
              <span className="truncate">
                {dirty
                  ? "Unsaved changes" /* i18n-ignore */
                  : readSource?.versionHash
                    ? `Saved ${readSource.versionHash}` /* i18n-ignore */
                    : previewSummary || ""}
              </span>
            </div>
          </div>
          <div className="relative min-h-0 flex-1">
            <div
              ref={editorHostRef}
              data-testid="design-code-monaco-editor"
              className="absolute inset-0"
            />
            {!selectedPath && !sourceFilesQuery.isLoading ? (
              <div className="absolute inset-0 grid place-items-center px-6 text-center text-sm text-[var(--workbench-muted-fg)]">
                {"Choose a source file to start editing." /* i18n-ignore */}
              </div>
            ) : null}
            {!editorReady ? (
              <div className="absolute inset-0 grid place-items-center bg-[var(--workbench-editor-bg)] text-[var(--workbench-muted-fg)]">
                <Spinner className="size-4" />
              </div>
            ) : null}
          </div>
          <div className="flex h-6 shrink-0 items-center gap-4 border-t border-[var(--workbench-border)] bg-[var(--workbench-surface-bg)] px-3 text-[11px] text-[var(--workbench-muted-fg)]">
            <span>{activeLanguage}</span>
            <span>{cursorLabel}</span>
            <span className="ml-auto truncate">
              {
                previewSummary ??
                  (canEditSource
                    ? "Preview on save, apply with version check" /* i18n-ignore */
                    : "Read-only source") /* i18n-ignore */
              }
            </span>
          </div>
        </main>
      </div>
    </div>
  );
}
