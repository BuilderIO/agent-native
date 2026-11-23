import type {
  ContentDatabaseSource,
  ContentDatabaseSourceFederation,
} from "@shared/api";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

import { builderSourceProblem } from "./BuilderSourceStatusLine";
import {
  notionSourceProblem,
  useNotionSyncNow,
} from "./NotionSourceStatusLine";
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
import { dbText } from "./text";

function stripTrim(formula: string): string {
  const match = /^trim\((.*)\)$/.exec(formula);
  return match?.[1] ? stripTrim(match[1]) : formula;
}

export function sourceMatchedOnText(
  federation: ContentDatabaseSourceFederation | undefined,
): string | null {
  const field = federation?.canonicalKey?.label || federation?.keyField;
  if (!federation || !field) return null;
  const formula = stripTrim(
    federation.normalizationFormula
      .replace(/\s+/g, "")
      .replace(/\{[^}]*\}/g, "value"),
  );
  const lowered = /^lower\((.*)\)$/.exec(formula);
  if (formula === "value") return dbText("sourceMatchedOn", { field });
  if (lowered?.[1] && stripTrim(lowered[1]) === "value") {
    return dbText("sourceMatchedOnIgnoringCase", { field });
  }
  return dbText("sourceMatchedOnCustom", { field });
}

function sourceHasChosenDetails(source: ContentDatabaseSource) {
  return source.fields.some(
    (field) =>
      !!field.propertyId &&
      field.mappingType !== "system" &&
      field.mappingType !== "title",
  );
}

function DetailsSourcePanelBody({
  source,
  documentId,
  canEdit,
  pageCount,
  sync,
  problem,
  rolePending,
  onChooseDetails,
  moreActions,
  onUnlinked,
}: {
  source: ContentDatabaseSource;
  documentId: string;
  canEdit: boolean;
  pageCount: number;
  sync: { pending: boolean; disabled?: boolean; run: () => void };
  problem: string | null;
  rolePending: boolean;
  onChooseDetails: () => void;
  moreActions?: ReactNode;
  onUnlinked: () => void;
}) {
  const now = useNow();
  const notion = source.sourceType === "notion-database";
  const matchedOn = sourceMatchedOnText(source.metadata.federation);
  return (
    <SourcePanel provider={notion ? "notion" : "builder"}>
      <SentenceWithName
        name={source.sourceName}
        sentence={(mark) =>
          dbText(
            notion
              ? "sourcePanelDetailsFromNotionDatabase"
              : "sourcePanelDetailsFromBuilderModel",
            { name: mark },
          )
        }
      />
      <SourcePanelStatus
        checkedAt={source.lastRefreshedAt}
        now={now}
        empty={!sourceHasChosenDetails(source)}
        problem={
          problem
            ? {
                text: problem,
                actions: canEdit ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={sync.pending || sync.disabled}
                    onClick={sync.run}
                  >
                    {dbText("retry")}
                  </Button>
                ) : null,
              }
            : null
        }
      />
      <SourcePanelEditing>
        {dbText(notion ? "sourceEditingNotion" : "sourceEditingBuilderDetails")}
      </SourcePanelEditing>
      {canEdit ? (
        <SourcePanelActions>
          <SourceSyncNowButton
            size="sm"
            pending={sync.pending}
            disabled={sync.disabled}
            onClick={sync.run}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={rolePending}
            onClick={onChooseDetails}
          >
            {dbText("sourceChooseDetails")}
          </Button>
        </SourcePanelActions>
      ) : null}
      {matchedOn || moreActions ? (
        <SourcePanelMore>
          {matchedOn ? (
            <p className="break-words text-muted-foreground">{matchedOn}</p>
          ) : null}
          {moreActions}
        </SourcePanelMore>
      ) : null}
      {canEdit ? (
        <SourcePanelUnlink
          note={dbText("sourceUnlinkKeepsDetailPages")}
          provider={notion ? "notion" : "builder"}
          documentId={documentId}
          sourceId={source.id}
          pageCount={pageCount}
          disabled={sync.pending || rolePending}
          onUnlinked={onUnlinked}
        />
      ) : null}
    </SourcePanel>
  );
}

export function NotionDetailsSourcePanel({
  source,
  documentId,
  canEdit,
  pageCount,
  rolePending,
  onChooseDetails,
  onUnlinked,
}: {
  source: ContentDatabaseSource;
  documentId: string;
  canEdit: boolean;
  pageCount: number;
  rolePending: boolean;
  onChooseDetails: () => void;
  onUnlinked: () => void;
}) {
  const now = useNow();
  const { pending, failed, reason, syncNow } = useNotionSyncNow(
    source,
    documentId,
  );
  return (
    <DetailsSourcePanelBody
      source={source}
      documentId={documentId}
      canEdit={canEdit}
      pageCount={pageCount}
      sync={{ pending, run: syncNow }}
      problem={failed ? notionSourceProblem(source, reason, now) : null}
      rolePending={rolePending}
      onChooseDetails={onChooseDetails}
      onUnlinked={onUnlinked}
    />
  );
}

export function BuilderDetailsSourcePanel({
  source,
  documentId,
  canEdit,
  pageCount,
  syncPending,
  syncDisabled,
  rolePending,
  onSyncNow,
  onChooseDetails,
  onAddAsItems,
  onUnlinked,
}: {
  source: ContentDatabaseSource;
  documentId: string;
  canEdit: boolean;
  pageCount: number;
  syncPending: boolean;
  syncDisabled: boolean;
  rolePending: boolean;
  onSyncNow: () => void;
  onChooseDetails: () => void;
  onAddAsItems: () => void | Promise<void>;
  onUnlinked: () => void;
}) {
  const now = useNow();
  return (
    <DetailsSourcePanelBody
      source={source}
      documentId={documentId}
      canEdit={canEdit}
      pageCount={pageCount}
      sync={{ pending: syncPending, disabled: syncDisabled, run: onSyncNow }}
      problem={builderSourceProblem(source, null, now)}
      rolePending={rolePending}
      onChooseDetails={onChooseDetails}
      moreActions={
        canEdit ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="justify-self-start"
            disabled={rolePending}
            onClick={() => void onAddAsItems()}
          >
            {dbText("addAsItems")}
          </Button>
        ) : null
      }
      onUnlinked={onUnlinked}
    />
  );
}
