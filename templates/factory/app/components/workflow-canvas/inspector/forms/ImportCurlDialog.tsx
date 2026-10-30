import { useEffect, useReducer } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import type { WorkflowCatalog } from "@/lib/workflow-editor";
import {
  applyCurlImport,
  hasLeftOut,
  leftOutOf,
  type ApiRequestArgs,
  type ImportedLeftOut,
} from "@/lib/workflow-editor/api-request";
import {
  parseCurlImport,
  type CurlImportProvider,
} from "@/lib/workflow-editor/curl-import";

import { useWorkflowStrings } from "../../../workflow/workflow-strings";
import { useWorkflowCanvasStrings } from "../../strings";
import { EMPTY_IMPORT, importReducer } from "./import-curl-state";

type ImportStrings = ReturnType<
  typeof useWorkflowCanvasStrings
>["inspector"]["apiRequest"]["importDialog"];

/** What a command left behind, one sentence for each kind of thing, naming each by its header, flag or parameter. */
function leftOutSentences(left: ImportedLeftOut, s: ImportStrings): string[] {
  const named = (names: readonly string[]) =>
    names
      .map((name) => (name === "url-userinfo" ? s.leftOut.urlUserinfo : name))
      .join(", ");
  return [
    ...(left.credentials.length > 0
      ? [s.leftOut.credentials(named(left.credentials))]
      : []),
    ...(left.headers.length > 0
      ? [s.leftOut.headers(named(left.headers))]
      : []),
    ...(left.bodies.length > 0 ? [s.leftOut.bodies(named(left.bodies))] : []),
    ...(left.flags.length > 0 ? [s.leftOut.flags(named(left.flags))] : []),
    ...(left.unreadableHeader ? [s.leftOut.unreadableHeader] : []),
    ...(left.extraUrl ? [s.leftOut.extraUrl] : []),
  ];
}

interface ImportCurlDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  catalog: WorkflowCatalog;
  /** The providers a command can be matched against; undefined while the provider list loads. */
  providers: readonly CurlImportProvider[] | undefined;
  providersFailed: boolean;
  onRetryProviders: () => void;
  /** Switches the step to what the command says. */
  onImport: (imported: { operation: string; args: ApiRequestArgs }) => void;
}

/** Overwrites the step's settings with a pasted cURL command, and says what it had to leave out. */
export function ImportCurlDialog({
  open,
  onOpenChange,
  catalog,
  providers,
  providersFailed,
  onRetryProviders,
  onImport,
}: ImportCurlDialogProps) {
  const s = useWorkflowCanvasStrings().inspector.apiRequest.importDialog;
  const ws = useWorkflowStrings();
  const [{ command, error, left }, dispatch] = useReducer(
    importReducer,
    EMPTY_IMPORT,
  );

  // However the dialog closes (Cancel, Escape, a click outside, the form going away), nothing pasted stays in it.
  useEffect(() => {
    if (!open) dispatch({ type: "closed" });
  }, [open]);

  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) dispatch({ type: "closed" });
  };

  const run = () => {
    if (providers === undefined) return;
    const parsed = parseCurlImport(command, providers);
    if (!parsed.ok) {
      const flag = parsed.issues.find(
        (issue) => issue.code === "method_not_get",
      )?.detail;
      dispatch({
        type: "refused",
        error:
          parsed.reason === "method_not_get" && flag !== undefined
            ? s.failFlag(flag)
            : s.fail[parsed.reason],
      });
      return;
    }
    const applied = applyCurlImport(catalog, parsed);
    if (!applied) {
      dispatch({ type: "refused", error: s.fail.unknown_host });
      return;
    }
    onImport(applied);
    const dropped = leftOutOf(parsed.issues);
    if (hasLeftOut(dropped)) {
      dispatch({ type: "imported", left: leftOutSentences(dropped, s) });
      return;
    }
    toast.success(s.imported);
    close(false);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        className="max-w-lg"
        closeLabel={ws.common.close}
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>{s.title}</DialogTitle>
        </DialogHeader>
        {left === null ? (
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <label htmlFor="api-request-curl" className="text-sm">
                {s.label}
              </label>
              <Textarea
                id="api-request-curl"
                autoFocus
                rows={6}
                value={command}
                placeholder={s.placeholder}
                aria-invalid={error === null ? undefined : true}
                className="font-mono text-xs"
                onChange={(event) =>
                  dispatch({ type: "typed", command: event.target.value })
                }
              />
            </div>
            <p className="text-xs text-muted-foreground">{s.warning}</p>
            {error ? (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            ) : null}
            {providersFailed ? (
              <div className="flex items-center justify-between gap-2">
                <p role="alert" className="text-xs text-destructive">
                  {s.providersFailed}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onRetryProviders}
                >
                  {s.retry}
                </Button>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="grid gap-2">
            <p className="text-sm">{s.leftOutTitle}</p>
            <ul className="grid list-disc gap-1 ps-5 text-sm text-muted-foreground">
              {left.map((sentence) => (
                <li key={sentence} className="break-words">
                  {sentence}
                </li>
              ))}
            </ul>
          </div>
        )}
        <DialogFooter className="gap-2 sm:gap-0">
          {left === null ? (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => close(false)}
              >
                {s.cancel}
              </Button>
              <Button
                type="button"
                disabled={command.trim() === "" || providers === undefined}
                onClick={run}
              >
                {s.import}
              </Button>
            </>
          ) : (
            <Button type="button" onClick={() => close(false)}>
              {s.done}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
