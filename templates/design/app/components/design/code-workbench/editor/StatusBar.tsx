import { IconAlertTriangle, IconCircleX } from "@tabler/icons-react";
import type * as monaco from "monaco-editor";
import { useEffect, useState, type MutableRefObject } from "react";

import { cn } from "@/lib/utils";

import { isFormattablePath } from "../format/prettier-format";
import { modelRegistry } from "../model-registry";
import { useWorkbench } from "../store";
import { parseWorkbenchUri, providerKindFromKey } from "../workspace/types";
import { languageDisplayName } from "./status-bar-lang";

interface ProblemCounts {
  errors: number;
  warnings: number;
}

/**
 * Count error/warning markers across the given set of open workbench tab
 * uris, resolved to their Monaco model uris through the model registry.
 * Pure given the monaco module + registry state, so it never counts markers
 * for closed/background models.
 */
export function countProblemsForOpenTabs(
  monacoModule: typeof monaco,
  tabUris: string[],
): ProblemCounts {
  const openModelUriStrings = new Set(
    tabUris
      .map((uri) => modelRegistry.get(uri)?.model.uri.toString())
      .filter((value): value is string => Boolean(value)),
  );
  let errors = 0;
  let warnings = 0;
  for (const marker of monacoModule.editor.getModelMarkers({})) {
    if (!openModelUriStrings.has(marker.resource.toString())) continue;
    if (marker.severity === monacoModule.MarkerSeverity.Error) errors += 1;
    else if (marker.severity === monacoModule.MarkerSeverity.Warning) {
      warnings += 1;
    }
  }
  return { errors, warnings };
}

export interface StatusBarProps {
  editorRef: MutableRefObject<monaco.editor.IStandaloneCodeEditor | null>;
  onGoToLine: () => void;
}

/**
 * 24px status bar, 11px text. Left: workspace badge + problems summary.
 * Right: transient save flash, "Prettier" (only for formattable inline
 * files), Ln/Col, "Spaces: 2", "UTF-8", "LF", language display name. Shows a
 * conflict banner when the active buffer changed externally while dirty.
 */
export function StatusBar({ editorRef, onGoToLine }: StatusBarProps) {
  const { state, api } = useWorkbench();
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const [problems, setProblems] = useState<ProblemCounts>({
    errors: 0,
    warnings: 0,
  });
  const [showSaved, setShowSaved] = useState(false);

  const activeUri = state.activeUri;
  const activeMeta = activeUri ? state.buffers[activeUri] : null;
  const activePath = activeUri ? parseWorkbenchUri(activeUri).path : "";
  const providerKey = activeUri ? parseWorkbenchUri(activeUri).providerKey : "";
  const isInlineActive = activeUri
    ? providerKindFromKey(providerKey) === "inline"
    : false;
  const workspaceBadge = activeUri
    ? isInlineActive
      ? "designfs" /* i18n-ignore */
      : "localhost" /* i18n-ignore */
    : null;
  const showPrettierStatus =
    isInlineActive && Boolean(activePath) && isFormattablePath(activePath);

  // Cursor position subscription follows the live editor instance, not
  // React state, since MonacoHost owns editor creation/disposal.
  useEffect(() => {
    let disposed = false;
    let disposable: monaco.IDisposable | null = null;
    const attach = () => {
      const editor = editorRef.current;
      if (!editor) {
        if (!disposed) requestAnimationFrame(attach);
        return;
      }
      const update = () => {
        const position = editor.getPosition();
        if (position) {
          setCursor({ line: position.lineNumber, column: position.column });
        }
      };
      update();
      disposable = editor.onDidChangeCursorPosition(update);
    };
    attach();
    return () => {
      disposed = true;
      disposable?.dispose();
    };
  }, [editorRef, activeUri]);

  // Problems summary: recompute on Monaco marker changes, scoped to
  // currently open tabs.
  const tabUriKey = state.tabs.map((tab) => tab.uri).join(",");
  useEffect(() => {
    let disposed = false;
    let disposable: monaco.IDisposable | null = null;
    void (async () => {
      const monacoModule = await import("monaco-editor");
      if (disposed) return;
      const tabUris = tabUriKey ? tabUriKey.split(",") : [];
      const update = () => {
        setProblems(countProblemsForOpenTabs(monacoModule, tabUris));
      };
      update();
      disposable = monacoModule.editor.onDidChangeMarkers(update);
    })();
    return () => {
      disposed = true;
      disposable?.dispose();
    };
  }, [tabUriKey]);

  // "Saved" flash for 2s after lastSavedAt changes.
  useEffect(() => {
    if (!activeMeta?.lastSavedAt) return;
    setShowSaved(true);
    const timer = window.setTimeout(() => setShowSaved(false), 2000);
    return () => window.clearTimeout(timer);
  }, [activeMeta?.lastSavedAt]);

  return (
    <div
      data-testid="workbench-status-bar"
      className="flex h-6 shrink-0 items-center gap-3 border-t border-[var(--workbench-border)] bg-[var(--workbench-statusbar-bg)] px-2 text-[11px] text-[var(--workbench-statusbar-fg)]"
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {workspaceBadge ? (
          <StatusBarItem>{workspaceBadge}</StatusBarItem>
        ) : null}
        {problems.errors > 0 || problems.warnings > 0 ? (
          <StatusBarItem>
            <span className="flex items-center gap-1">
              <IconCircleX className="size-3" />
              {problems.errors}
            </span>
            <span className="flex items-center gap-1">
              <IconAlertTriangle className="size-3" />
              {problems.warnings}
            </span>
          </StatusBarItem>
        ) : null}
        {activeMeta?.conflict ? (
          <button
            type="button"
            onClick={() => activeUri && void api.reloadBuffer(activeUri)}
            className="flex cursor-pointer items-center gap-1 rounded-[3px] px-1.5 text-[var(--workbench-warning)] hover:bg-[var(--workbench-list-hover-bg)]"
          >
            {"File changed elsewhere — reload latest" /* i18n-ignore */}
          </button>
        ) : null}
      </div>
      {activeUri ? (
        <div className="flex shrink-0 items-center gap-3">
          {showSaved ? (
            <span className="text-[var(--workbench-accent)]">
              {"Saved" /* i18n-ignore */}
            </span>
          ) : null}
          {showPrettierStatus ? (
            <StatusBarItem>{"Prettier" /* i18n-ignore */}</StatusBarItem>
          ) : null}
          <button
            type="button"
            onClick={onGoToLine}
            className="cursor-pointer rounded-[3px] px-1.5 hover:bg-[var(--workbench-list-hover-bg)]"
          >
            {`Ln ${cursor.line}, Col ${cursor.column}` /* i18n-ignore */}
          </button>
          <StatusBarItem>{"Spaces: 2" /* i18n-ignore */}</StatusBarItem>
          <StatusBarItem>{"UTF-8" /* i18n-ignore */}</StatusBarItem>
          <StatusBarItem>{"LF" /* i18n-ignore */}</StatusBarItem>
          <StatusBarItem>
            {languageDisplayName(activeMeta?.language)}
          </StatusBarItem>
        </div>
      ) : null}
    </div>
  );
}

function StatusBarItem({ children }: { children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "flex items-center gap-1.5 rounded-[3px] px-1.5",
        "hover:bg-[var(--workbench-list-hover-bg)]",
      )}
    >
      {children}
    </span>
  );
}
