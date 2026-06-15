import { describe, expect, it } from "vitest";
import attachSource from "./attach-content-database-source";
import addSourceFieldProperty from "./add-content-database-source-field-property";
import disconnectSource from "./disconnect-content-database-source";
import executeExecution from "./execute-builder-source-execution";
import getSource from "./get-content-database-source";
import listBuilderModels from "./list-builder-cms-models";
import prepareExecution from "./prepare-builder-source-execution";
import prepareReview, {
  buildBuilderSourceReviewPayload,
} from "./prepare-builder-source-review";
import proposeChangeSet from "./propose-content-database-source-change-set";
import refreshSource from "./refresh-content-database-source";
import reviewChangeSet from "./review-content-database-source-change-set";
import setWriteMode from "./set-content-database-source-write-mode";
import stageBuilderRevision from "./stage-builder-revision";
import validateExecution from "./validate-builder-source-execution";
import { serializeBuilderCmsSourceReadMetadataRecord } from "./_database-source-utils";
import type { ContentDatabaseSource } from "../shared/api";

describe("content database source actions", () => {
  it("accepts database or document IDs for source status reads", () => {
    expect(getSource.schema.parse({ documentId: "database-page" })).toEqual({
      documentId: "database-page",
    });
    expect(getSource.schema.parse({ databaseId: "database" })).toEqual({
      databaseId: "database",
    });
  });

  it("defaults source attachment to the safe mock-local source type", () => {
    expect(attachSource.schema.parse({ documentId: "database-page" })).toEqual({
      documentId: "database-page",
      sourceType: "mock-local",
    });
  });

  it("preserves explicit mock source metadata in attachment args", () => {
    expect(
      attachSource.schema.parse({
        databaseId: "database",
        sourceType: "builder-cms",
        sourceName: "Mock Builder",
        sourceTable: "blog_article",
      }),
    ).toEqual({
      databaseId: "database",
      sourceType: "builder-cms",
      sourceName: "Mock Builder",
      sourceTable: "blog_article",
    });
  });

  it("accepts refresh requests without external provider details", () => {
    expect(refreshSource.schema.parse({ databaseId: "database" })).toEqual({
      databaseId: "database",
    });
  });

  it("accepts source disconnect requests", () => {
    expect(
      disconnectSource.schema.parse({ documentId: "database-page" }),
    ).toEqual({
      documentId: "database-page",
    });
  });

  it("accepts source-backed property creation requests", () => {
    expect(
      addSourceFieldProperty.schema.parse({
        documentId: "database-page",
        sourceFieldId: "source-field",
      }),
    ).toEqual({
      documentId: "database-page",
      sourceFieldId: "source-field",
    });
  });

  it("accepts no-argument Builder model discovery requests", () => {
    expect(listBuilderModels.schema.parse({})).toEqual({});
  });

  it("keeps proposed change-set inputs scoped to local review metadata", () => {
    expect(
      proposeChangeSet.schema.parse({
        databaseId: "database",
        itemDocumentId: "row-page",
        propertyId: "title",
        includeBodyChange: true,
      }),
    ).toEqual({
      databaseId: "database",
      itemDocumentId: "row-page",
      propertyId: "title",
      includeBodyChange: true,
    });
  });

  it("accepts local-only Builder revision staging requests", () => {
    expect(
      stageBuilderRevision.schema.parse({ documentId: "database-page" }),
    ).toEqual({
      documentId: "database-page",
    });
  });

  it("accepts local source change-set review decisions", () => {
    expect(
      reviewChangeSet.schema.parse({
        databaseId: "database",
        changeSetId: "change-set",
        decision: "approve",
      }),
    ).toEqual({
      databaseId: "database",
      changeSetId: "change-set",
      decision: "approve",
    });
  });

  it("accepts local Builder execution preparation requests", () => {
    expect(
      prepareExecution.schema.parse({
        documentId: "database-page",
        changeSetId: "change-set",
        pushModeConfirmation: "autosave",
      }),
    ).toEqual({
      documentId: "database-page",
      changeSetId: "change-set",
      pushModeConfirmation: "autosave",
    });
  });

  it("accepts consolidated Builder source review requests", () => {
    expect(
      prepareReview.schema.parse({
        documentId: "database-page",
        pushModeConfirmation: "autosave",
      }),
    ).toEqual({
      documentId: "database-page",
      pushModeConfirmation: "autosave",
    });
  });

  it("accepts local Builder dry-run validation requests", () => {
    expect(
      validateExecution.schema.parse({
        documentId: "database-page",
        changeSetId: "change-set",
        idempotencyKey: "builder-cms:source:change:autosave",
      }),
    ).toEqual({
      documentId: "database-page",
      changeSetId: "change-set",
      idempotencyKey: "builder-cms:source:change:autosave",
    });
  });

  it("accepts live Builder execution requests behind the execution gate", () => {
    expect(
      executeExecution.schema.parse({
        documentId: "database-page",
        changeSetId: "change-set",
        idempotencyKey: "builder-cms:source:change:autosave",
        pushModeConfirmation: "autosave",
      }),
    ).toEqual({
      documentId: "database-page",
      changeSetId: "change-set",
      idempotencyKey: "builder-cms:source:change:autosave",
      pushModeConfirmation: "autosave",
    });
  });

  it("accepts explicit per-source Builder live-write enablement requests", () => {
    expect(
      setWriteMode.schema.parse({
        documentId: "database-page",
        liveWritesEnabled: true,
        allowedWriteModes: ["autosave"],
      }),
    ).toEqual({
      documentId: "database-page",
      liveWritesEnabled: true,
      allowedWriteModes: ["autosave"],
    });
  });

  it("marks successful Builder reads as live source metadata", () => {
    expect(
      JSON.parse(
        serializeBuilderCmsSourceReadMetadataRecord({
          sourceTable: "agent-native-blog-article-test",
          readState: "live",
          entryCount: 20,
          matchedRowCount: 20,
        }),
      ),
    ).toMatchObject({
      readMode: "builder-api",
      liveReadConfigured: true,
      lastReadEntryCount: 20,
      lastReadMatchedRowCount: 20,
    });
  });

  it("groups pending Builder diffs into one review payload", () => {
    const source: ContentDatabaseSource = {
      id: "source",
      databaseId: "database",
      sourceType: "builder-cms",
      sourceName: "Builder CMS",
      sourceTable: "blog_article",
      syncState: "idle",
      freshness: "fresh",
      lastRefreshedAt: null,
      lastSourceUpdatedAt: null,
      lastError: null,
      capabilities: {
        canRefresh: true,
        canCreateChangeSets: true,
        canWriteFields: true,
        canWriteBody: true,
        canPush: true,
        canPull: true,
        canPublish: true,
        canDelete: false,
        canStageLocalRevision: true,
        liveWritesEnabled: false,
        readOnlyRefresh: true,
      },
      metadata: {
        primaryKey: "id",
        titleField: "title",
        pushMode: "autosave",
      },
      fields: [],
      rows: [
        {
          id: "row",
          databaseItemId: "item",
          documentId: "doc",
          sourceRowId: "builder-row",
          sourceQualifiedId: "builder://blog_article/builder-row",
          sourceDisplayKey: "Old title",
          provenance: "fixture",
          syncState: "linked",
          freshness: "fresh",
          lastSyncedAt: null,
          lastSourceUpdatedAt: null,
        },
      ],
      changeSets: [],
    };
    const review = buildBuilderSourceReviewPayload({
      source,
      changeSets: [
        {
          id: "change",
          databaseItemId: "item",
          documentId: "doc",
          kind: "field_update",
          direction: "outbound",
          state: "pending_push",
          pushMode: "autosave",
          localOnly: true,
          summary: "Pending local Builder CMS title change.",
          fieldChanges: [
            {
              propertyId: null,
              propertyName: "Title",
              localFieldKey: "title",
              sourceFieldKey: "data.title",
              currentValue: "Old title",
              proposedValue: "New title",
            },
          ],
          bodyChange: null,
          riskLevel: "low",
          riskReasons: ["single field diff"],
          conflictState: "none",
          reviewEvents: [],
          executions: [],
          createdAt: "2026-06-08T00:00:00.000Z",
          updatedAt: "2026-06-08T00:00:00.000Z",
        },
      ],
    });

    expect(review.summary).toBe("1 Builder row has changes ready to review.");
    expect(review.rows[0]?.title).toBe("New title");
    expect(review.rows[0]?.fieldChanges[0]?.sourceFieldKey).toBe("data.title");
    expect(review.result.message).toContain("Push will check the update only");
  });
});
