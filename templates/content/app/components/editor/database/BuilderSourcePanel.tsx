import type {
  ContentDatabaseSource,
  ContentDatabaseSourceWriteMode,
} from "@shared/api";
import { useState, type ReactNode } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { usePreviewBuilderSourceReview } from "@/hooks/use-content-database";

import { builderSourceWriteMode } from "./builder-source-progress";
import {
  builderProgress,
  builderSourceProblem,
} from "./BuilderSourceStatusLine";
import {
  SourcePanel,
  SourcePanelActions,
  SourcePanelEditing,
  SourcePanelMore,
  SourcePanelStatus,
  SourcePanelUnlink,
} from "./SourcePanel";
import {
  SentenceWithName,
  SourceSyncNowButton,
  useNow,
} from "./SourceStatusLine";
import { dbText, type DatabaseMessageKey } from "./text";

export interface BuilderSourceWriteSettings {
  sourceId: string;
  writeMode: ContentDatabaseSourceWriteMode;
  allowPublicationTransitions: boolean;
}

const EDITING_TEXT: Record<ContentDatabaseSourceWriteMode, DatabaseMessageKey> =
  {
    read_only: "sourceEditingBuilderReadOnly",
    stage_only: "sourceEditingBuilderStageOnly",
    publish_updates: "sourceEditingBuilderPublish",
  };

const WRITE_MODE_CHOICES: Array<{
  mode: ContentDatabaseSourceWriteMode;
  label: DatabaseMessageKey;
}> = [
  { mode: "read_only", label: "sourceBuilderEditsDontSend" },
  { mode: "stage_only", label: "sourceBuilderEditsSaveForReview" },
  { mode: "publish_updates", label: "sourceBuilderEditsPublish" },
];

function BuilderChangesWaiting({
  source,
  documentId,
  knownCount,
  reviewDisabled,
  onReview,
}: {
  source: ContentDatabaseSource;
  documentId: string;
  knownCount: number | null;
  reviewDisabled: boolean;
  onReview: () => void;
}) {
  const preview = usePreviewBuilderSourceReview({
    documentId,
    sourceId: source.id,
    scope: "all",
    enabled: knownCount === null,
  });
  if (knownCount === null && preview.isPending) {
    return (
      <Skeleton className="h-4 w-32" data-source-panel-changes="loading" />
    );
  }
  if (knownCount === null && preview.isError) {
    return (
      <div
        className="flex min-w-0 flex-wrap items-center gap-2"
        data-source-panel-changes="error"
      >
        <span className="text-muted-foreground">
          {dbText("sourceChangesCheckFailed")}
        </span>
        <Button
          type="button"
          size="xs"
          variant="outline"
          onClick={() => void preview.refetch()}
        >
          {dbText("retry")}
        </Button>
      </div>
    );
  }
  const count =
    knownCount ??
    preview.data?.review?.totalRowCount ??
    preview.data?.changeSetIds.length ??
    0;
  if (count === 0) {
    return (
      <p className="text-muted-foreground" data-source-panel-changes="none">
        {dbText("sourceNoChangesWaiting")}
      </p>
    );
  }
  return (
    <div
      className="flex min-w-0 flex-wrap items-center justify-between gap-2"
      data-source-panel-changes={count}
    >
      <span className="font-medium">
        {count === 1
          ? dbText("sourcePagesChangedOne")
          : dbText("sourcePagesChanged", { count })}
      </span>
      <Button
        type="button"
        size="sm"
        disabled={reviewDisabled}
        onClick={onReview}
      >
        {dbText("sourceReviewAndSend")}
      </Button>
    </div>
  );
}

function BuilderWriteModeChoice({
  source,
  disabled,
  onChange,
}: {
  source: ContentDatabaseSource;
  disabled: boolean;
  onChange: (settings: BuilderSourceWriteSettings) => void;
}) {
  const writeMode = builderSourceWriteMode(source);
  const allowTransitions =
    writeMode === "publish_updates" &&
    source.metadata.allowPublicationTransitions === true;
  const [confirmPublish, setConfirmPublish] = useState(false);
  const choose = (mode: ContentDatabaseSourceWriteMode) => {
    if (mode === writeMode) return;
    if (mode === "publish_updates") {
      setConfirmPublish(true);
      return;
    }
    onChange({
      sourceId: source.id,
      writeMode: mode,
      allowPublicationTransitions: false,
    });
  };
  return (
    <div className="grid min-w-0 gap-2">
      <div className="font-medium" id={`builder-edits-${source.id}`}>
        {dbText("sourceBuilderEditsHeading")}
      </div>
      <RadioGroup
        value={writeMode}
        onValueChange={(value) =>
          choose(value as ContentDatabaseSourceWriteMode)
        }
        disabled={disabled}
        aria-labelledby={`builder-edits-${source.id}`}
      >
        {WRITE_MODE_CHOICES.map((choice) => (
          <div key={choice.mode} className="flex min-w-0 items-center gap-2">
            <RadioGroupItem
              value={choice.mode}
              id={`builder-edits-${source.id}-${choice.mode}`}
            />
            <Label htmlFor={`builder-edits-${source.id}-${choice.mode}`}>
              {dbText(choice.label)}
            </Label>
          </div>
        ))}
      </RadioGroup>
      {writeMode === "publish_updates" ? (
        <div className="flex min-w-0 items-center gap-2 ps-6">
          <Checkbox
            id={`builder-transitions-${source.id}`}
            checked={allowTransitions}
            disabled={disabled}
            onCheckedChange={(checked) =>
              onChange({
                sourceId: source.id,
                writeMode: "publish_updates",
                allowPublicationTransitions: checked === true,
              })
            }
          />
          <Label htmlFor={`builder-transitions-${source.id}`}>
            {dbText("allowPublishUnpublishPerItem")}
          </Label>
        </div>
      ) : null}
      <AlertDialog open={confirmPublish} onOpenChange={setConfirmPublish}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {dbText("sourceBuilderPublishConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {dbText("sourceBuilderPublishConfirmBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{dbText("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                onChange({
                  sourceId: source.id,
                  writeMode: "publish_updates",
                  allowPublicationTransitions: false,
                })
              }
            >
              {dbText("sourceBuilderEditsPublish")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function BuilderSourcePanel({
  source,
  documentId,
  canEdit,
  pageCount,
  knownChangeCount,
  syncPending,
  syncDisabled,
  retryContentDisabled,
  reviewDisabled,
  writeModeDisabled,
  roleDisabled,
  unlinkDisabled,
  notice,
  onSyncNow,
  onRetryContent,
  onReview,
  onSetWriteMode,
  onAddDetailsInstead,
  onUnlinked,
}: {
  source: ContentDatabaseSource;
  documentId: string;
  canEdit: boolean;
  pageCount: number;
  knownChangeCount: number | null;
  syncPending: boolean;
  syncDisabled: boolean;
  retryContentDisabled: boolean;
  reviewDisabled: boolean;
  writeModeDisabled: boolean;
  roleDisabled: boolean;
  unlinkDisabled: boolean;
  notice?: ReactNode;
  onSyncNow: () => void;
  onRetryContent: () => void;
  onReview: () => void;
  onSetWriteMode: (settings: BuilderSourceWriteSettings) => void;
  onAddDetailsInstead?: (() => void) | undefined;
  onUnlinked: () => void;
}) {
  const now = useNow();
  const progress = builderProgress(source, false, undefined);
  const problem = builderSourceProblem(source, progress, now);
  const retryContent = progress?.failed && progress.retry === "content";
  const writeMode = builderSourceWriteMode(source);
  return (
    <SourcePanel provider="builder">
      <SentenceWithName
        name={source.sourceName}
        sentence={(mark) =>
          dbText("sourcePanelFromBuilderModel", { name: mark })
        }
      />
      <SourcePanelStatus
        checkedAt={source.lastRefreshedAt}
        now={now}
        problem={
          problem
            ? {
                text: problem,
                actions: canEdit ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={
                      retryContent ? retryContentDisabled : syncDisabled
                    }
                    onClick={retryContent ? onRetryContent : onSyncNow}
                  >
                    {dbText("retry")}
                  </Button>
                ) : null,
              }
            : null
        }
        progress={
          progress && !progress.failed
            ? {
                label: progress.content
                  ? dbText("sourceLoadingPageContent", progress.content)
                  : progress.label,
                percent: progress.percent,
              }
            : null
        }
      />
      <div className="grid min-w-0 gap-2">
        <SourcePanelEditing>
          {dbText(EDITING_TEXT[writeMode])}
        </SourcePanelEditing>
        {canEdit && writeMode !== "read_only" ? (
          <BuilderChangesWaiting
            source={source}
            documentId={documentId}
            knownCount={knownChangeCount}
            reviewDisabled={reviewDisabled}
            onReview={onReview}
          />
        ) : null}
      </div>
      {notice}
      {canEdit ? (
        <SourcePanelActions>
          <SourceSyncNowButton
            size="sm"
            pending={syncPending}
            disabled={syncDisabled}
            onClick={onSyncNow}
          />
        </SourcePanelActions>
      ) : null}
      <SourcePanelMore>
        <BuilderWriteModeChoice
          source={source}
          disabled={writeModeDisabled}
          onChange={onSetWriteMode}
        />
        {onAddDetailsInstead ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="justify-self-start"
            disabled={!canEdit || roleDisabled}
            onClick={onAddDetailsInstead}
          >
            {dbText("addDetailsInstead")}
          </Button>
        ) : null}
      </SourcePanelMore>
      {canEdit ? (
        <SourcePanelUnlink
          note={dbText("sourceUnlinkKeepsPages")}
          provider="builder"
          documentId={documentId}
          sourceId={source.id}
          pageCount={pageCount}
          disabled={unlinkDisabled}
          onUnlinked={onUnlinked}
        />
      ) : null}
    </SourcePanel>
  );
}
