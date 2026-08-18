import { useActionQuery } from "@agent-native/core/client/hooks";
import { IconFileCode, IconLoader2 } from "@tabler/icons-react";
import {
  useCallback,
  Component,
  lazy,
  useMemo,
  Suspense,
  useEffect,
  useState,
  type ComponentType,
  type ErrorInfo,
  type ReactNode,
} from "react";

import { Spinner } from "@/components/ui/spinner";
import { prettyScreenName } from "@/lib/screen-names";
import { cn } from "@/lib/utils";

import { CODE_WORKBENCH_SHELL_CLASSNAME } from "./code-workbench-shell";
import type { CodeWorkbenchProps } from "./CodeWorkbench";
import { baseName } from "./workspace/types";

export type CodeWorkbenchModuleLoader = () => Promise<{
  default: ComponentType<CodeWorkbenchProps>;
}>;

const loadCodeWorkbench: CodeWorkbenchModuleLoader = () =>
  import("./CodeWorkbench").then((module) => ({
    default: module.CodeWorkbench,
  }));

export function preloadCodeWorkbench() {
  void loadCodeWorkbench().catch(() => {
    // The mounted boundary reports import failures. Hover/focus preloading is
    // speculative and must not produce an unhandled rejection.
  });
}

if (typeof window !== "undefined" && import.meta.env.MODE !== "test") {
  preloadCodeWorkbench();
}

export function CodeWorkbenchLoader(props: CodeWorkbenchProps) {
  return (
    <RetryableCodeWorkbenchLoader
      loadWorkbench={loadCodeWorkbench}
      workbenchProps={props}
    />
  );
}

export function RetryableCodeWorkbenchLoader({
  loadWorkbench,
  workbenchProps,
}: {
  loadWorkbench: CodeWorkbenchModuleLoader;
  workbenchProps: CodeWorkbenchProps;
}) {
  const [attempt, setAttempt] = useState(0);
  const LazyCodeWorkbench = useMemo(
    () => lazy(loadWorkbench),
    [attempt, loadWorkbench],
  );
  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  return (
    <CodeWorkbenchLoadErrorBoundary key={attempt} onRetry={retry}>
      <Suspense
        fallback={<CodeWorkbenchLoading {...workbenchProps} onRetry={retry} />}
      >
        <LazyCodeWorkbench {...workbenchProps} />
      </Suspense>
    </CodeWorkbenchLoadErrorBoundary>
  );
}

interface PreviewFile {
  path: string;
  label: string;
}

function CodeWorkbenchLoading({
  designId,
  localhostConnections = [],
  onRetry,
}: CodeWorkbenchProps & { onRetry: () => void }) {
  const [slow, setSlow] = useState(false);
  const sourceFilesQuery = useActionQuery("list-source-files", { designId });

  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), 12_000);
    return () => window.clearTimeout(timer);
  }, []);

  const inlineFiles = (
    sourceFilesQuery.data as
      | { files?: Array<{ path?: string; displayName?: string }> }
      | undefined
  )?.files;

  return (
    <div
      role="status"
      data-testid="design-code-workbench-loading"
      className={cn(
        CODE_WORKBENCH_SHELL_CLASSNAME,
        "flex min-h-0 flex-1 bg-[var(--design-editor-panel-bg)] text-muted-foreground",
      )}
    >
      <div className="flex w-60 shrink-0 flex-col border-r border-border">
        <div className="flex h-9 shrink-0 items-center border-b border-border px-3 text-[11px] font-medium uppercase tracking-wide">
          {"Explorer" /* i18n-ignore */}
        </div>
        <div className="min-h-0 flex-1 overflow-auto py-1">
          <PreviewFileRoot
            label="DESIGN FILES"
            files={(inlineFiles ?? []).map((file) => ({
              path: file.path ?? file.displayName ?? "",
              label:
                file.displayName ??
                (file.path
                  ? prettyScreenName(baseName(file.path))
                  : "Untitled"),
            }))}
            loading={sourceFilesQuery.isLoading}
            error={
              sourceFilesQuery.error instanceof Error
                ? sourceFilesQuery.error.message
                : undefined
            }
          />
          {localhostConnections.map((connection) => (
            <PreviewFileRoot
              key={connection.connectionId}
              label={`LOCAL FILES — ${connection.label}`}
              title={connection.rootPath}
              files={[]}
              loading
              loadingLabel={"Starting editor…" /* i18n-ignore */}
            />
          ))}
        </div>
      </div>
      <div className="grid min-h-0 flex-1 place-items-center bg-[var(--workbench-editor-bg,var(--design-editor-panel-bg))] p-6">
        {slow ? (
          <div className="max-w-sm text-center text-[12px]">
            <p>
              {
                "The code editor is taking longer than expected to load." /* i18n-ignore */
              }
            </p>
            <button
              type="button"
              className="mt-3 cursor-pointer rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground hover:opacity-90"
              onClick={onRetry}
            >
              {"Retry code editor" /* i18n-ignore */}
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-[12px]">
            <Spinner className="size-3.5" />
            <span>{"Starting Monaco…" /* i18n-ignore */}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function PreviewFileRoot({
  label,
  title,
  files,
  loading,
  loadingLabel = "Loading files…" /* i18n-ignore */,
  error,
}: {
  label: string;
  title?: string;
  files: PreviewFile[];
  loading: boolean;
  loadingLabel?: string;
  error?: string;
}) {
  return (
    <section className="pb-1">
      <div
        className="flex h-[22px] items-center px-2 text-[11px] font-bold uppercase tracking-wide"
        title={title}
      >
        <span className="truncate">{label}</span>
      </div>
      {loading ? (
        <div className="flex items-center gap-1.5 px-3 py-1 text-[11px]">
          <IconLoader2 className="size-3 animate-spin" />
          <span>{loadingLabel}</span>
        </div>
      ) : error ? (
        <p className="break-words px-3 py-1 text-[11px]">{error}</p>
      ) : (
        files.map((file) => (
          <div
            key={file.path}
            className="flex h-6 items-center gap-1.5 px-3 text-[12px]"
            title={file.path}
          >
            <IconFileCode className="size-3.5 shrink-0" />
            <span className="truncate">{file.label}</span>
          </div>
        ))
      )}
    </section>
  );
}

function CodeWorkbenchLoadFailure({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      data-testid="design-code-workbench-load-error"
      className={cn(
        CODE_WORKBENCH_SHELL_CLASSNAME,
        "grid min-h-0 flex-1 place-items-center bg-[var(--design-editor-panel-bg)] p-6 text-muted-foreground",
      )}
    >
      <div className="max-w-sm text-center text-[12px]">
        <p>{message}</p>
        <button
          type="button"
          className="mt-3 cursor-pointer rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground hover:opacity-90"
          onClick={onRetry}
        >
          {"Retry code editor" /* i18n-ignore */}
        </button>
      </div>
    </div>
  );
}

interface CodeWorkbenchLoadErrorBoundaryProps {
  children: ReactNode;
  onRetry: () => void;
}

interface CodeWorkbenchLoadErrorBoundaryState {
  error: Error | null;
}

class CodeWorkbenchLoadErrorBoundary extends Component<
  CodeWorkbenchLoadErrorBoundaryProps,
  CodeWorkbenchLoadErrorBoundaryState
> {
  state: CodeWorkbenchLoadErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    // The visible retry state is actionable; runtime reporting still receives
    // the original error through React's error boundary instrumentation.
  }

  render() {
    if (this.state.error) {
      return (
        <CodeWorkbenchLoadFailure
          message={
            this.state.error.message ||
            "The code editor could not be loaded." /* i18n-ignore */
          }
          onRetry={this.props.onRetry}
        />
      );
    }
    return this.props.children;
  }
}
