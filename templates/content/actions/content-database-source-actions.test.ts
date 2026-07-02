import { describe, expect, it } from "vitest";

import type { ContentDatabaseSource } from "../shared/api";
import { serializeBuilderCmsSourceReadMetadataRecord } from "./_database-source-utils";
import { normalizeContentDatabasePageOptions } from "./_database-utils";
import addSourceFieldProperty, {
  propertyTypeForSourceField,
  sourceFieldPropertyValuesFromRows,
} from "./add-content-database-source-field-property";
import attachSource from "./attach-content-database-source";
import changeSourceRole from "./change-content-database-source-role";
import disconnectSource from "./disconnect-content-database-source";
import executeBatch from "./execute-builder-source-batch";
import executeExecution from "./execute-builder-source-execution";
import getSource from "./get-content-database-source";
import listBuilderModels from "./list-builder-cms-models";
import prepareExecution from "./prepare-builder-source-execution";
import prepareReview, {
  buildBuilderSourceReviewPayload,
} from "./prepare-builder-source-review";
import refreshSource from "./refresh-content-database-source";
import reviewChangeSet from "./review-content-database-source-change-set";
import setWriteMode from "./set-content-database-source-write-mode";
import stageBuilderRevision from "./stage-builder-revision";
import validateExecution from "./validate-builder-source-execution";

describe("content database source actions", () => {
  it("accepts database or document IDs for source status reads", () => {
    expect(getSource.schema.parse({ documentId: "database-page" })).toEqual({
      documentId: "database-page",
    });
    expect(getSource.schema.parse({ databaseId: "database" })).toEqual({
      databaseId: "database",
    });
  });

  it("accepts Builder source batch execution args", () => {
    expect(
      executeBatch.schema.parse({
        documentId: "database-page",
        changeSetIds: ["change-1", "change-2"],
        maxConcurrency: 2,
        transitions: {
          "change-2": { publicationTransition: "publish" },
        },
      }),
    ).toEqual({
      documentId: "database-page",
      changeSetIds: ["change-1", "change-2"],
      maxConcurrency: 2,
      transitions: {
        "change-2": { publicationTransition: "publish" },
      },
    });
  });

  it("defaults source attachment to the safe mock-local source type", () => {
    expect(attachSource.schema.parse({ documentId: "database-page" })).toEqual({
      documentId: "database-page",
      limit: 100,
      offset: 0,
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
        relationshipMode: "items",
        limit: 50,
        offset: 25,
      }),
    ).toEqual({
      databaseId: "database",
      sourceType: "builder-cms",
      sourceName: "Mock Builder",
      sourceTable: "blog_article",
      relationshipMode: "items",
      limit: 50,
      offset: 25,
    });
  });

  it("accepts local folder and GitHub URL mounted source attachment args", () => {
    expect(
      attachSource.schema.parse({
        databaseId: "database",
        sourceType: "local-folder",
        sourceName: "Docs repo",
        sourceTable: "docs",
        relationshipMode: "items",
      }),
    ).toEqual({
      databaseId: "database",
      sourceType: "local-folder",
      sourceName: "Docs repo",
      sourceTable: "docs",
      relationshipMode: "items",
      limit: 100,
      offset: 0,
    });

    expect(
      attachSource.schema.parse({
        databaseId: "database",
        sourceType: "github-url",
        sourceName: "Docs on GitHub",
        sourceTable: "https://github.com/BuilderIO/agent-native/tree/main/docs",
      }),
    ).toMatchObject({
      sourceType: "github-url",
      sourceTable: "https://github.com/BuilderIO/agent-native/tree/main/docs",
    });
  });

  it("rejects unsafe source federation normalization formulas", () => {
    expect(() =>
      attachSource.schema.parse({
        databaseId: "database",
        sourceType: "local-table",
        sourceTable: "source-database",
        join: {
          canonicalKey: { label: "URL", type: "text" },
          primary: {
            keyField: "url",
            normalizationFormula: 'regexextract({url}, "(a+)+$", 1)',
          },
          secondary: {
            keyField: "url",
            normalizationFormula: "lower(trim({url}))",
          },
        },
      }),
    ).toThrow();
  });

  it("accepts refresh requests without external provider details", () => {
    expect(refreshSource.schema.parse({ databaseId: "database" })).toEqual({
      databaseId: "database",
    });
  });

  it("caps content database page sizes for bounded responses", () => {
    expect(
      normalizeContentDatabasePageOptions({ limit: 1, offset: -5 }),
    ).toEqual({
      limit: 1,
      offset: 0,
    });
    expect(
      normalizeContentDatabasePageOptions({ limit: 10_000, offset: 25 }),
    ).toEqual({
      limit: 5_000,
      offset: 25,
    });
    expect(normalizeContentDatabasePageOptions({})).toEqual({
      limit: null,
      offset: 0,
    });
  });

  it("accepts source disconnect requests", () => {
    expect(
      disconnectSource.schema.parse({ documentId: "database-page" }),
    ).toEqual({
      documentId: "database-page",
    });
  });

  it("accepts source role changes with an explicit relationship mode", () => {
    expect(
      changeSourceRole.schema.parse({
        documentId: "database-page",
        sourceId: "source-1",
        relationshipMode: "items",
      }),
    ).toEqual({
      documentId: "database-page",
      sourceId: "source-1",
      relationshipMode: "items",
      limit: 100,
      offset: 0,
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

  it("maps Builder source field types to local property types", () => {
    expect(propertyTypeForSourceField("number")).toBe("number");
    expect(propertyTypeForSourceField("datetime")).toBe("date");
    expect(propertyTypeForSourceField("date")).toBe("date");
    expect(propertyTypeForSourceField("url")).toBe("url");
    expect(propertyTypeForSourceField("boolean")).toBe("checkbox");
    expect(propertyTypeForSourceField("text")).toBe("text");
  });

  it("builds populated property values from persisted source row snapshots", () => {
    expect(
      sourceFieldPropertyValuesFromRows(
        [
          {
            databaseItemId: "item-1",
            documentId: "doc-1",
            sourceValuesJson: JSON.stringify({
              "data.handle": "hello-builder",
            }),
          },
          {
            databaseItemId: "item-2",
            documentId: "doc-2",
            sourceValuesJson: JSON.stringify({
              "data.handle": "second-post",
            }),
          },
          {
            databaseItemId: "item-3",
            documentId: "doc-3",
            sourceValuesJson: JSON.stringify({ "data.other": "skip-me" }),
          },
        ],
        "data.handle",
        "text",
      ),
    ).toEqual([
      {
        itemId: "item-1",
        documentId: "doc-1",
        value: "hello-builder",
      },
      {
        itemId: "item-2",
        documentId: "doc-2",
        value: "second-post",
      },
    ]);
  });

  it("maps epoch-millis Builder date values into populated date property values", () => {
    // Builder CMS date fields come back as milliseconds-since-epoch numbers;
    // they must still populate a `date` property rather than being dropped.
    const result = sourceFieldPropertyValuesFromRows(
      [
        {
          databaseItemId: "item-1",
          documentId: "doc-1",
          sourceValuesJson: JSON.stringify({ "data.date": 1781546400000 }),
        },
      ],
      "data.date",
      "date",
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.itemId).toBe("item-1");
    expect(result[0]?.value).not.toBeNull();
  });

  it("accepts no-argument Builder model discovery requests", () => {
    expect(listBuilderModels.schema.parse({})).toEqual({});
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
        publicationTransition: "unpublish",
        confirmUnpublish: true,
      }),
    ).toEqual({
      documentId: "database-page",
      pushModeConfirmation: "autosave",
      publicationTransition: "unpublish",
      confirmUnpublish: true,
    });
  });

  it("accepts local Builder dry-run validation requests", () => {
    expect(
      validateExecution.schema.parse({
        documentId: "database-page",
        changeSetId: "change-set",
        idempotencyKey: "builder-cms:source:change:autosave",
        publicationTransition: "publish",
      }),
    ).toEqual({
      documentId: "database-page",
      changeSetId: "change-set",
      idempotencyKey: "builder-cms:source:change:autosave",
      publicationTransition: "publish",
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

  it("accepts tiered Builder write mode requests", () => {
    expect(
      setWriteMode.schema.parse({
        documentId: "database-page",
        writeMode: "publish_updates",
        allowPublicationTransitions: true,
      }),
    ).toEqual({
      documentId: "database-page",
      writeMode: "publish_updates",
      allowPublicationTransitions: true,
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
