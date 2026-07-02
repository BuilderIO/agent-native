import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import { IconCode, IconDeviceFloppy } from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

interface CodeWorkbenchTheme {
  colorScheme: "light" | "dark";
  values: Record<string, string>;
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

function readThemeVar(
  elementStyles: CSSStyleDeclaration,
  rootStyles: CSSStyleDeclaration,
  names: string[],
): string | undefined {
  for (const name of names) {
    const value =
      elementStyles.getPropertyValue(name) || rootStyles.getPropertyValue(name);
    const normalized = normalizeThemeColorValue(value);
    if (normalized) return normalized;
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

export const WORKBENCH_SRC_DOC = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  :root {
    color-scheme: light;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    --workbench-bg: Canvas;
    --workbench-sidebar-bg: Canvas;
    --workbench-editor-bg: Canvas;
    --workbench-surface-bg: ButtonFace;
    --workbench-border: color-mix(in srgb, CanvasText 16%, transparent);
    --workbench-fg: CanvasText;
    --workbench-muted-fg: color-mix(in srgb, CanvasText 56%, transparent);
    --workbench-hover-bg: color-mix(in srgb, Highlight 10%, transparent);
    --workbench-active-bg: color-mix(in srgb, Highlight 16%, transparent);
    --workbench-active-fg: Highlight;
    --workbench-accent: Highlight;
    --workbench-button-bg: ButtonFace;
    --workbench-button-fg: ButtonText;
    --workbench-selection-bg: color-mix(in srgb, Highlight 28%, transparent);
    --workbench-dirty: Mark;
    background: var(--workbench-bg);
    color: var(--workbench-fg);
  }
  * { box-sizing: border-box; }
  body { margin: 0; height: 100vh; overflow: hidden; background: var(--workbench-bg); }
  button { font: inherit; }
  .shell { display: grid; grid-template-columns: 188px minmax(0, 1fr); height: 100vh; }
  .explorer { border-right: 1px solid var(--workbench-border); background: var(--workbench-sidebar-bg); min-width: 0; display: flex; flex-direction: column; }
  .title { height: 38px; display: flex; align-items: center; padding: 0 12px; gap: 8px; border-bottom: 1px solid var(--workbench-border); font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--workbench-muted-fg); }
  .dot { width: 8px; height: 8px; border-radius: 999px; background: var(--workbench-accent); box-shadow: 0 0 18px color-mix(in srgb, var(--workbench-accent) 55%, transparent); }
  .files { min-height: 0; overflow: auto; padding: 8px 6px; }
  .file { width: 100%; min-width: 0; border: 0; border-radius: 7px; background: transparent; color: var(--workbench-muted-fg); display: flex; align-items: center; gap: 7px; padding: 7px 8px; cursor: pointer; text-align: left; }
  .file:hover { background: var(--workbench-hover-bg); color: var(--workbench-fg); }
  .file.active { background: var(--workbench-active-bg); color: var(--workbench-active-fg); }
  .file .icon { width: 22px; color: var(--workbench-accent); font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; }
  .file .name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
  .status { border-top: 1px solid var(--workbench-border); color: var(--workbench-muted-fg); font-size: 11px; line-height: 1.35; padding: 9px 10px; }
  .editor { min-width: 0; display: flex; flex-direction: column; background: var(--workbench-editor-bg); }
  .tabbar { height: 38px; display: flex; align-items: center; border-bottom: 1px solid var(--workbench-border); background: var(--workbench-surface-bg); }
  .tab { height: 38px; max-width: 260px; display: flex; align-items: center; gap: 8px; padding: 0 13px; border-right: 1px solid var(--workbench-border); color: var(--workbench-fg); font-size: 12px; }
  .dirty { width: 7px; height: 7px; border-radius: 999px; background: var(--workbench-dirty); }
  .toolbar { margin-left: auto; display: flex; align-items: center; gap: 8px; padding: 0 10px; color: var(--workbench-muted-fg); font-size: 11px; }
  .toolbar button { height: 26px; border: 1px solid var(--workbench-border); border-radius: 6px; background: var(--workbench-button-bg); color: var(--workbench-button-fg); padding: 0 9px; cursor: pointer; }
  .toolbar button:disabled { opacity: .4; cursor: default; }
  textarea { flex: 1; width: 100%; min-width: 0; resize: none; border: 0; outline: 0; padding: 18px 20px 28px; background: var(--workbench-editor-bg); color: var(--workbench-fg); font: 12px/1.55 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; tab-size: 2; }
  textarea::selection { background: var(--workbench-selection-bg); }
  .empty { flex: 1; display: grid; place-items: center; color: var(--workbench-muted-fg); font-size: 13px; text-align: center; padding: 24px; }
</style>
</head>
<body>
<div class="shell">
  <aside class="explorer">
    <div class="title"><span class="dot"></span><span>DesignFS</span></div>
    <div id="files" class="files"></div>
    <div id="status" class="status">Waiting for workspace...</div>
  </aside>
  <main class="editor">
    <div class="tabbar">
      <div id="tab" class="tab">No file</div>
      <div class="toolbar">
        <span id="meta"></span>
        <button id="revert" type="button" disabled>Revert</button>
        <button id="save" type="button" disabled>Save</button>
      </div>
    </div>
    <textarea id="editor" spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off"></textarea>
  </main>
</div>
<script>
  const filesEl = document.getElementById("files");
  const statusEl = document.getElementById("status");
  const tabEl = document.getElementById("tab");
  const metaEl = document.getElementById("meta");
  const editorEl = document.getElementById("editor");
  const saveEl = document.getElementById("save");
  const revertEl = document.getElementById("revert");
  let state = { files: [], activePath: null, content: "", savedContent: "", dirty: false, canEdit: false };
  let lastSelectionKey = "";

  function applyTheme(theme) {
    const root = document.documentElement;
    if (!theme) return;
    root.style.colorScheme = theme.colorScheme === "dark" ? "dark" : "light";
    const values = theme.values || {};
    for (const name of Object.keys(values)) {
      root.style.setProperty(name, values[name]);
    }
  }

  function iconFor(path) {
    if (/\\.css$/i.test(path)) return "#";
    if (/\\.jsx?$/i.test(path)) return "JS";
    if (/\\.tsx?$/i.test(path)) return "TS";
    return "<>";
  }

  function renderFiles() {
    filesEl.innerHTML = "";
    state.files.forEach((file) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "file" + (file.path === state.activePath ? " active" : "");
      button.title = file.path;
      const icon = document.createElement("span");
      icon.className = "icon";
      icon.textContent = iconFor(file.path);
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = file.displayName || file.path;
      button.append(icon, name);
      button.addEventListener("click", () => {
        parent.postMessage({ type: "design-code-workbench:select-file", path: file.path }, "*");
      });
      filesEl.appendChild(button);
    });
  }

  function focusSelection() {
    const selection = state.selection || {};
    const key = [state.activePath, selection.nodeId || "", selection.selector || "", state.versionHash || ""].join(":");
    if (!state.content || key === lastSelectionKey) return;
    lastSelectionKey = key;
    const targets = [];
    if (selection.nodeId) {
      targets.push('data-agent-native-node-id="' + selection.nodeId + '"');
      targets.push('data-code-layer-id="' + selection.nodeId + '"');
      targets.push(selection.nodeId);
    }
    if (selection.selector) targets.push(selection.selector);
    for (const target of targets) {
      const index = state.content.indexOf(target);
      if (index >= 0) {
        editorEl.focus();
        editorEl.setSelectionRange(index, Math.min(state.content.length, index + target.length));
        return;
      }
    }
  }

  function render() {
    renderFiles();
    const active = state.files.find((file) => file.path === state.activePath);
    tabEl.replaceChildren();
    if (active) {
      const label = document.createElement("span");
      label.textContent = active.path;
      tabEl.appendChild(label);
      if (state.dirty) {
        const dirty = document.createElement("span");
        dirty.className = "dirty";
        tabEl.appendChild(dirty);
      }
    } else {
      tabEl.textContent = "No file";
    }
    metaEl.textContent = state.dirty ? "Unsaved changes" : (state.versionHash ? "Saved " + state.versionHash : "");
    saveEl.disabled = !state.canEdit || !state.dirty || state.saving || !active;
    revertEl.disabled = !state.dirty || !active;
    statusEl.textContent = active
      ? (state.backendKind || "virtual-inline") + " / " + state.workspaceUri
      : state.files.length ? "Choose a file" : "No inline files";
    if (editorEl.value !== state.content) editorEl.value = state.content || "";
    editorEl.readOnly = !state.canEdit || !active;
    focusSelection();
  }

  window.addEventListener("message", (event) => {
    const message = event.data || {};
    if (message.type !== "design-code-workbench:state") return;
    state = message.state || state;
    applyTheme(state.theme);
    render();
  });

  editorEl.addEventListener("input", () => {
    parent.postMessage({ type: "design-code-workbench:content-change", content: editorEl.value }, "*");
  });
  saveEl.addEventListener("click", () => {
    parent.postMessage({ type: "design-code-workbench:save" }, "*");
  });
  revertEl.addEventListener("click", () => {
    parent.postMessage({ type: "design-code-workbench:revert" }, "*");
  });

  parent.postMessage({ type: "design-code-workbench:ready" }, "*");
</script>
</body>
</html>`;

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
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [draftsByPath, setDraftsByPath] = useState<Record<string, string>>({});
  const [ready, setReady] = useState(false);
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
  const applySourceEditMutation = useActionMutation("apply-source-edit");
  const savedContent = readSource?.content ?? "";
  const draftContent =
    selectedPath && draftsByPath[selectedPath] !== undefined
      ? draftsByPath[selectedPath]
      : savedContent;
  const dirty = draftContent !== savedContent;
  const activeSourceFile = sourceFiles.find(
    (file: any) =>
      file.path === selectedPath ||
      (activeFileId && file.fileId === activeFileId),
  );

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
    onActiveFileChange?.(null);
  }, [designId, onActiveFileChange]);

  useEffect(() => {
    if (!activeFileId && !activeFilename) return;
    const match = sourceFiles.find(
      (file: any) =>
        file.fileId === activeFileId || file.path === activeFilename,
    );
    if (match?.path && match.path !== activePath) {
      setActivePath(match.path);
    }
  }, [activeFileId, activeFilename, activePath, sourceFiles]);

  const setSelectedDraftContent = useCallback(
    (content: string) => {
      if (!selectedPath) return;
      setDraftsByPath((current) => {
        const next = { ...current };
        if (content === savedContent) {
          delete next[selectedPath];
        } else {
          next[selectedPath] = content;
        }
        return next;
      });
    },
    [savedContent, selectedPath],
  );

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

  const workbenchState = useMemo(
    () => ({
      files: sourceFiles,
      activePath: selectedPath || null,
      content: draftContent,
      savedContent,
      dirty,
      canEdit: canEdit && readSource?.readonly !== true,
      saving: applySourceEditMutation.isPending,
      versionHash: readSource?.versionHash,
      workspaceUri: backend?.workspaceUri ?? `designfs://${designId}/`,
      backendKind: backend?.kind ?? "virtual-inline",
      theme,
      selection: {
        nodeId: selectedNodeId,
        selector: selectedSelector,
      },
    }),
    [
      applySourceEditMutation.isPending,
      backend?.kind,
      backend?.workspaceUri,
      canEdit,
      designId,
      dirty,
      draftContent,
      readSource?.readonly,
      readSource?.versionHash,
      savedContent,
      selectedNodeId,
      selectedPath,
      selectedSelector,
      sourceFiles,
      theme,
    ],
  );

  useEffect(() => {
    if (!ready) return;
    iframeRef.current?.contentWindow?.postMessage(
      { type: "design-code-workbench:state", state: workbenchState },
      "*",
    );
  }, [ready, workbenchState]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const message = event.data as
        | { type?: string; path?: string; content?: string }
        | undefined;
      if (!message?.type) return;
      if (message.type === "design-code-workbench:ready") {
        setReady(true);
        return;
      }
      if (
        message.type === "design-code-workbench:select-file" &&
        message.path
      ) {
        setActivePath(message.path);
        return;
      }
      if (
        message.type === "design-code-workbench:content-change" &&
        typeof message.content === "string"
      ) {
        setSelectedDraftContent(message.content);
        return;
      }
      if (message.type === "design-code-workbench:revert") {
        setSelectedDraftContent(savedContent);
        return;
      }
      if (message.type === "design-code-workbench:save") {
        if (!selectedPath || !dirty) return;
        applySourceEditMutation.mutate(
          {
            designId,
            path: selectedPath,
            expectedVersionHash: readSource?.versionHash,
            edit: { kind: "full-replace", content: draftContent },
          } as any,
          {
            onSuccess: () => {
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
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [
    applySourceEditMutation,
    designId,
    dirty,
    draftContent,
    readSource?.versionHash,
    savedContent,
    selectedPath,
    setSelectedDraftContent,
  ]);

  return (
    <div
      ref={containerRef}
      className="flex min-h-0 flex-1 flex-col bg-[var(--design-editor-panel-bg)]"
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/60 px-3">
        <IconCode className="size-4 text-[var(--design-editor-accent-color)]" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-xs font-semibold text-foreground">
            {"Code" /* i18n-ignore */}
          </h3>
          <p className="truncate text-[10px] text-muted-foreground">
            {backend?.workspaceUri ?? `designfs://${designId}/`}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 px-2 text-[11px]"
          disabled={!dirty || !canEdit || applySourceEditMutation.isPending}
          onClick={() => {
            iframeRef.current?.contentWindow?.postMessage(
              { type: "design-code-workbench:state", state: workbenchState },
              "*",
            );
            applySourceEditMutation.mutate(
              {
                designId,
                path: selectedPath,
                expectedVersionHash: readSource?.versionHash,
                edit: { kind: "full-replace", content: draftContent },
              } as any,
              {
                onSuccess: () => {
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
          }}
        >
          {applySourceEditMutation.isPending ? (
            <Spinner className="size-3" />
          ) : (
            <IconDeviceFloppy className="size-3" />
          )}
          {"Save" /* i18n-ignore */}
        </Button>
      </div>
      <div
        className={cn(
          "min-h-0 flex-1 bg-[var(--design-editor-panel-bg)]",
          (sourceFilesQuery.isLoading || readSourceQuery.isLoading) &&
            "opacity-80",
        )}
      >
        <iframe
          ref={iframeRef}
          title={"Design code workspace" /* i18n-ignore */}
          className="h-full w-full border-0"
          srcDoc={WORKBENCH_SRC_DOC}
          sandbox="allow-scripts"
          allow="clipboard-read; clipboard-write"
        />
      </div>
    </div>
  );
}
