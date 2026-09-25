import { useT } from "@agent-native/core/client/i18n";
import { SharedRichEditor } from "@agent-native/toolkit/editor";
import { IconChevronDown, IconLoader2 } from "@tabler/icons-react";
import DiffMatchPatch, {
  DIFF_DELETE,
  DIFF_EQUAL,
  DIFF_INSERT,
  type Diff,
} from "diff-match-patch";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const CONTEXT_LENGTH = 120;

function contextualize(segments: Diff[]): Diff[] {
  return segments.flatMap(([operation, text]) => {
    if (operation !== DIFF_EQUAL || text.length <= CONTEXT_LENGTH * 2)
      return [[operation, text] satisfies Diff];
    return [
      [operation, text.slice(0, CONTEXT_LENGTH)] satisfies Diff,
      [operation, "\n…\n"] satisfies Diff,
      [operation, text.slice(-CONTEXT_LENGTH)] satisfies Diff,
    ];
  });
}

function DiffValue({ value, other }: { value: string; other: string }) {
  const segments = useMemo(() => {
    const differ = new DiffMatchPatch();
    const result = differ.diff_main(value, other);
    differ.diff_cleanupSemantic(result);
    return contextualize(result);
  }, [other, value]);

  return segments.map(([operation, text], index) =>
    operation === DIFF_INSERT ? null : operation === DIFF_DELETE ? (
      <mark
        key={`${index}:${text}`}
        className="rounded-sm bg-accent text-accent-foreground"
      >
        {text}
      </mark>
    ) : (
      <span key={`${index}:${text}`}>{text}</span>
    ),
  );
}

interface RecoveryVersion {
  title: string;
  content: string;
}

export function RecoveryComparison({
  mine,
  saved,
  busy,
  keepMineDisabled = false,
  failure,
  stale = false,
  onRefresh,
  onKeepMine,
  onUseSaved,
  onSaveSeparately,
  onCopy,
}: {
  mine: RecoveryVersion;
  saved: RecoveryVersion;
  busy: boolean;
  keepMineDisabled?: boolean;
  failure?: string | null;
  stale?: boolean;
  onRefresh?: () => void;
  onKeepMine: () => void;
  onUseSaved: () => void;
  onSaveSeparately: () => void;
  onCopy: () => void;
}) {
  const t = useT();
  const [fullVersions, setFullVersions] = useState(false);

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden [container-type:inline-size]"
      data-recovery-comparison
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <h2 className="text-sm font-semibold">
          {t("editor.previewDraftCompare")}
        </h2>
        <div className="mt-4 grid min-w-0 gap-3 @min-[48rem]:grid-cols-2">
          {[
            {
              key: "mine",
              label: t("editor.previewDraftYourEdits"),
              value: mine,
              other: saved,
            },
            {
              key: "saved",
              label: t("editor.previewDraftSavedVersion"),
              value: saved,
              other: mine,
            },
          ].map((version) => (
            <section
              key={version.key}
              className="min-w-0 rounded-md border bg-background p-3"
            >
              <h3 className="mb-3 text-xs font-medium text-muted-foreground">
                {version.label}
              </h3>
              {fullVersions ? (
                <>
                  <p className="mb-3 font-medium break-words">
                    {version.value.title}
                  </p>
                  <SharedRichEditor
                    key={`${version.key}:${version.value.content}`}
                    value={version.value.content}
                    onChange={() => undefined}
                    editable={false}
                    dragHandle={false}
                    preset="content"
                    ariaLabel={version.label}
                  />
                </>
              ) : (
                <>
                  <p className="font-medium break-words">
                    <DiffValue
                      value={version.value.title}
                      other={version.other.title}
                    />
                  </p>
                  <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words font-sans text-sm">
                    <DiffValue
                      value={version.value.content}
                      other={version.other.content}
                    />
                  </pre>
                </>
              )}
            </section>
          ))}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-2"
          aria-expanded={fullVersions}
          onClick={() => setFullVersions((value) => !value)}
        >
          <IconChevronDown
            aria-hidden="true"
            className={fullVersions ? "rotate-180" : undefined}
          />
          {fullVersions
            ? t("editor.previewDraftShowChanges")
            : t("editor.previewDraftViewFullVersions")}
        </Button>
        {failure ? (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {failure}
          </p>
        ) : null}
      </div>
      <div className="border-t bg-background px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
        {stale && onRefresh ? (
          <Button type="button" onClick={onRefresh}>
            {t("editor.reconcileRefresh")}
          </Button>
        ) : (
          <>
            <div className="grid gap-2 @min-[32rem]:grid-cols-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy || keepMineDisabled}
                onClick={onKeepMine}
              >
                {busy ? (
                  <IconLoader2 aria-hidden="true" className="animate-spin" />
                ) : null}
                {t("editor.previewDraftKeepMine")}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={onUseSaved}
              >
                {t("editor.previewDraftUseSaved")}
              </Button>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-1"
                  disabled={busy}
                >
                  {t("editor.previewDraftMoreOptions")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onSelect={onSaveSeparately}>
                  {t("editor.previewDraftSaveSeparately")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onCopy}>
                  {t("editor.copyUnsavedText")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>
    </div>
  );
}
