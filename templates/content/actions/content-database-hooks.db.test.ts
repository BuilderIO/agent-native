import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import {
  createWorkflowEventValues,
  getWorkflowSubscription,
  materializeWorkflowExecutions,
} from "@agent-native/core/workflow";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { serializePropertyOptions } from "../shared/properties.js";
import { contentDefaultPersonSubscriptionId } from "./_content-database-hooks.js";
import {
  executeContentDatabaseHook,
  matchesContentDatabaseHook,
  prepareContentNotificationEffect,
} from "./_content-hook-execution.js";
import { resolveContentNotificationPreference } from "./_content-notification-preferences.js";
import {
  allocateContentWorkflowEventSequence,
  contentWorkflowActorSnapshot,
  runWithContentWorkflowCausality,
} from "./_content-workflow.js";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-database-hooks-${process.pid}-${Date.now()}.sqlite`,
);
const OWNER = "hooks-owner@example.com";
const COLLABORATOR = "hooks-editor@example.com";
const ADMIN = "hooks-admin@example.com";

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let manageHook: typeof import("./manage-content-database-hook.js").default;
let listHooks: typeof import("./list-content-database-hooks.js").default;
let setProperty: typeof import("./set-document-property.js").default;
let getRuntimeControls: typeof import("./get-content-hook-runtime-controls.js").default;
let manageRuntimeControl: typeof import("./manage-content-hook-runtime-control.js").default;
let managePreference: typeof import("./manage-content-notification-preference.js").default;
let getPreference: typeof import("./get-content-notification-preference.js").default;
let manageExecution: typeof import("./manage-content-database-hook-execution.js").default;
let listExecutions: typeof import("./list-content-database-hook-executions.js").default;
let managePolicy: typeof import("./manage-content-database-policy.js").default;
let configureProperty: typeof import("./configure-document-property.js").default;

const ids = {
  databaseDocumentId: "hooks_database_document",
  databaseId: "hooks_database",
  itemDocumentId: "hooks_item_document",
  itemId: "hooks_item",
  statusPropertyId: "hooks_status_property",
  assigneePropertyId: "hooks_assignee_property",
  draftOptionId: "hooks_draft",
  reviewOptionId: "hooks_ready_for_review",
};

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);
  manageHook = (await import("./manage-content-database-hook.js")).default;
  listHooks = (await import("./list-content-database-hooks.js")).default;
  setProperty = (await import("./set-document-property.js")).default;
  getRuntimeControls = (await import("./get-content-hook-runtime-controls.js"))
    .default;
  manageRuntimeControl = (
    await import("./manage-content-hook-runtime-control.js")
  ).default;
  managePreference = (
    await import("./manage-content-notification-preference.js")
  ).default;
  getPreference = (await import("./get-content-notification-preference.js"))
    .default;
  manageExecution = (
    await import("./manage-content-database-hook-execution.js")
  ).default;
  listExecutions = (await import("./list-content-database-hook-executions.js"))
    .default;
  managePolicy = (await import("./manage-content-database-policy.js")).default;
  configureProperty = (await import("./configure-document-property.js"))
    .default;

  const now = new Date().toISOString();
  await getDb()
    .insert(schema.documents)
    .values([
      {
        id: ids.databaseDocumentId,
        ownerEmail: OWNER,
        title: "Design asks",
        content: "",
        visibility: "private",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: ids.itemDocumentId,
        ownerEmail: OWNER,
        parentId: ids.databaseDocumentId,
        title: "Homepage refresh",
        content: "",
        visibility: "private",
        createdAt: now,
        updatedAt: now,
      },
    ]);
  await getDb().insert(schema.contentDatabases).values({
    id: ids.databaseId,
    ownerEmail: OWNER,
    documentId: ids.databaseDocumentId,
    title: "Design asks",
    createdAt: now,
    updatedAt: now,
  });
  await getDb().insert(schema.contentDatabaseItems).values({
    id: ids.itemId,
    ownerEmail: OWNER,
    databaseId: ids.databaseId,
    documentId: ids.itemDocumentId,
    createdAt: now,
    updatedAt: now,
  });
  await getDb()
    .insert(schema.documentPropertyDefinitions)
    .values([
      {
        id: ids.statusPropertyId,
        ownerEmail: OWNER,
        databaseId: ids.databaseId,
        name: "Status",
        type: "status",
        optionsJson: serializePropertyOptions({
          options: [
            { id: ids.draftOptionId, name: "Draft", color: "gray" },
            { id: ids.reviewOptionId, name: "Ready for review", color: "blue" },
          ],
        }),
        createdAt: now,
        updatedAt: now,
      },
      {
        id: ids.assigneePropertyId,
        ownerEmail: OWNER,
        databaseId: ids.databaseId,
        name: "Assignee",
        type: "person",
        createdAt: now,
        updatedAt: now,
      },
    ]);
  await getDb()
    .insert(schema.documentPropertyValues)
    .values([
      {
        id: "hooks_status_value",
        ownerEmail: OWNER,
        documentId: ids.itemDocumentId,
        propertyId: ids.statusPropertyId,
        valueJson: JSON.stringify(ids.draftOptionId),
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "hooks_assignee_value",
        ownerEmail: OWNER,
        documentId: ids.itemDocumentId,
        propertyId: ids.assigneePropertyId,
        valueJson: JSON.stringify(["reviewer@example.com"]),
        createdAt: now,
        updatedAt: now,
      },
    ]);
  await getDb()
    .insert(schema.documentShares)
    .values([
      {
        id: "hooks_editor_share",
        resourceId: ids.databaseDocumentId,
        principalType: "user",
        principalId: COLLABORATOR,
        role: "editor",
        createdBy: OWNER,
        createdAt: now,
      },
      {
        id: "hooks_reviewer_share",
        resourceId: ids.itemDocumentId,
        principalType: "user",
        principalId: "reviewer@example.com",
        role: "viewer",
        createdBy: OWNER,
        createdAt: now,
      },
      {
        id: "hooks_reviewer_database_share",
        resourceId: ids.databaseDocumentId,
        principalType: "user",
        principalId: "reviewer@example.com",
        role: "viewer",
        createdBy: OWNER,
        createdAt: now,
      },
      {
        id: "hooks_admin_share",
        resourceId: ids.databaseDocumentId,
        principalType: "user",
        principalId: ADMIN,
        role: "admin",
        createdBy: OWNER,
        createdAt: now,
      },
    ]);
}, 60_000);

afterAll(() => {
  for (const suffix of ["", "-shm", "-wal"]) {
    rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
  }
});

describe("Content deterministic database hooks", () => {
  it("keeps resource authority separate from a pure system actor", async () => {
    const actor = await runWithRequestContext({}, () =>
      contentWorkflowActorSnapshot(OWNER),
    );
    expect(actor).toMatchObject({
      initiator: { kind: "system", id: "system" },
      executor: { kind: "system", id: "system" },
      authority: { ownerEmail: OWNER },
    });
    expect(
      contentWorkflowActorSnapshot(OWNER, {
        caller: "mcp",
        userEmail: COLLABORATOR,
      }),
    ).toMatchObject({
      initiator: { kind: "human", id: COLLABORATOR },
      executor: { kind: "agent", id: "mcp" },
      origin: { kind: "api", protocol: "mcp" },
      authority: { ownerEmail: OWNER },
    });
  });

  it("allows only database admins to author stable-ID hooks", async () => {
    await expect(
      runWithRequestContext({ userEmail: COLLABORATOR }, () =>
        manageHook.run({
          action: "create",
          databaseId: ids.databaseId,
          name: "Ask for review",
          trigger: {
            kind: "property_changed",
            propertyId: ids.statusPropertyId,
            toOptionId: ids.reviewOptionId,
          },
          effect: {
            kind: "notify",
            recipientPersonPropertyId: ids.assigneePropertyId,
          },
        }),
      ),
    ).rejects.toThrow();

    const propertyRule = await runWithRequestContext({ userEmail: OWNER }, () =>
      manageHook.run({
        action: "create",
        databaseId: ids.databaseId,
        name: "Ask for review",
        trigger: {
          kind: "property_changed",
          propertyId: ids.statusPropertyId,
          fromOptionId: ids.draftOptionId,
          toOptionId: ids.reviewOptionId,
        },
        conditions: {
          mode: "all",
          clauses: [
            {
              propertyId: ids.assigneePropertyId,
              operator: "is_not_empty",
            },
          ],
        },
        effect: {
          kind: "notify",
          recipientPersonPropertyId: ids.assigneePropertyId,
        },
      }),
    );
    expect(propertyRule.hook?.trigger).toEqual({
      kind: "property_changed",
      propertyId: ids.statusPropertyId,
      fromOptionId: ids.draftOptionId,
      toOptionId: ids.reviewOptionId,
    });
    expect(propertyRule.hook?.conditions).toEqual({
      mode: "all",
      clauses: [
        {
          propertyId: ids.assigneePropertyId,
          operator: "is_not_empty",
        },
      ],
    });

    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        manageHook.run({
          action: "create",
          databaseId: ids.databaseId,
          name: "Invalid condition reference",
          trigger: { kind: "item_submitted" },
          conditions: {
            mode: "all",
            clauses: [
              { propertyId: "another-database-field", operator: "is_empty" },
            ],
          },
          effect: {
            kind: "notify",
            recipientPersonPropertyId: ids.assigneePropertyId,
          },
        }),
      ),
    ).rejects.toThrow("does not belong to this database");

    const created = await runWithRequestContext({ userEmail: OWNER }, () =>
      manageHook.run({
        action: "create",
        databaseId: ids.databaseId,
        name: "Share published Builder article",
        trigger: {
          kind: "builder_publication_confirmed",
          publicationAction: "publish",
        },
        effect: {
          kind: "notify",
          recipientPersonPropertyId: ids.assigneePropertyId,
          message: "A design ask is ready for review.",
        },
      }),
    );
    expect(created.hook).toMatchObject({
      databaseId: ids.databaseId,
      createdBy: OWNER,
      trigger: { kind: "builder_publication_confirmed" },
      effect: { recipientPersonPropertyId: ids.assigneePropertyId },
    });
    const listed = await runWithRequestContext({ userEmail: OWNER }, () =>
      listHooks.run({ databaseId: ids.databaseId }),
    );
    expect(listed.hooks).toHaveLength(2);
    expect(listed.triggerAvailability).toContainEqual(
      expect.objectContaining({ kind: "property_changed", available: true }),
    );
    await runWithRequestContext({ userEmail: OWNER }, () =>
      manageHook.run({
        action: "delete",
        databaseId: ids.databaseId,
        hookId: propertyRule.hook!.id,
      }),
    );
  });

  it("validates and versions deterministic property effects", async () => {
    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        manageHook.run({
          action: "create",
          databaseId: ids.databaseId,
          name: "Invalid status mutation",
          trigger: {
            kind: "builder_publication_confirmed",
            publicationAction: "publish",
          },
          effect: {
            kind: "set_property",
            propertyId: ids.statusPropertyId,
            value: "not-a-stable-option",
          },
        }),
      ),
    ).rejects.toThrow("must use stable option IDs");

    const created = await runWithRequestContext({ userEmail: OWNER }, () =>
      manageHook.run({
        action: "create",
        databaseId: ids.databaseId,
        name: "Return published item to draft",
        enabled: false,
        trigger: {
          kind: "builder_publication_confirmed",
          publicationAction: "unpublish",
        },
        effect: {
          kind: "set_property",
          propertyId: ids.statusPropertyId,
          value: ids.draftOptionId,
        },
      }),
    );
    expect(created.hook?.effect).toMatchObject({
      version: 1,
      kind: "set_property",
      propertyId: ids.statusPropertyId,
      value: ids.draftOptionId,
    });
    await runWithRequestContext({ userEmail: OWNER }, () =>
      manageHook.run({
        action: "delete",
        databaseId: ids.databaseId,
        hookId: created.hook!.id,
      }),
    );
  });

  it("keeps global and database incident pauses separate and access-scoped", async () => {
    await expect(
      runWithRequestContext({ userEmail: COLLABORATOR }, () =>
        manageRuntimeControl.run({
          databaseId: ids.databaseId,
          scope: "database",
          evaluatorPaused: true,
          effectsPaused: false,
        }),
      ),
    ).rejects.toThrow();

    await expect(
      runWithRequestContext({ userEmail: ADMIN }, () =>
        manageRuntimeControl.run({
          databaseId: ids.databaseId,
          scope: "database",
          evaluatorPaused: false,
          effectsPaused: true,
        }),
      ),
    ).rejects.toThrow("Only the database owner");
    await runWithRequestContext({ userEmail: OWNER }, () =>
      manageRuntimeControl.run({
        databaseId: ids.databaseId,
        scope: "database",
        evaluatorPaused: false,
        effectsPaused: true,
      }),
    );
    await expect(
      runWithRequestContext({ userEmail: ADMIN }, () =>
        manageRuntimeControl.run({
          databaseId: ids.databaseId,
          scope: "global",
          evaluatorPaused: true,
          effectsPaused: false,
        }),
      ),
    ).rejects.toThrow("Only the database owner");

    await runWithRequestContext({ userEmail: OWNER }, () =>
      manageRuntimeControl.run({
        databaseId: ids.databaseId,
        scope: "global",
        evaluatorPaused: true,
        effectsPaused: false,
      }),
    );
    const controls = await runWithRequestContext(
      { userEmail: COLLABORATOR },
      () => getRuntimeControls.run({ databaseId: ids.databaseId }),
    );
    expect(controls).toMatchObject({
      global: { evaluatorPaused: true, effectsPaused: false },
      database: { evaluatorPaused: false, effectsPaused: true },
      effective: { evaluatorPaused: true, effectsPaused: true },
      canManageGlobal: false,
    });
    await runWithRequestContext({ userEmail: OWNER }, async () => {
      await manageRuntimeControl.run({
        databaseId: ids.databaseId,
        scope: "global",
        evaluatorPaused: false,
        effectsPaused: false,
      });
      await manageRuntimeControl.run({
        databaseId: ids.databaseId,
        scope: "database",
        evaluatorPaused: false,
        effectsPaused: false,
      });
    });
  });

  it("persists the owner-only default Person notification policy as immutable virtual snapshots", async () => {
    await expect(
      runWithRequestContext({ userEmail: COLLABORATOR }, () =>
        managePolicy.run({
          databaseId: ids.databaseId,
          defaultPersonNotificationsEnabled: false,
        }),
      ),
    ).rejects.toThrow("Requires admin role");

    const appendPersonEvent = async (id: string, materialize = true) => {
      const now = Date.now();
      await getDb().transaction(async (tx: any) => {
        const eventSequence = await allocateContentWorkflowEventSequence(tx);
        await tx.insert(schema.workflowEvents).values(
          createWorkflowEventValues({
            id,
            eventSequence,
            topic: "content.database.property.changed",
            subjectType: "content_database_item",
            subjectId: `policy-item-${id}`,
            ownerEmail: OWNER,
            payload: {
              databaseId: ids.databaseId,
              propertyType: "person",
              beforeValue: [],
              afterValue: ["reviewer-policy@example.com"],
            },
            occurredAt: now,
          }),
        );
      });
      if (materialize) {
        await materializeWorkflowExecutions({ eventId: id, now: now + 1 });
      }
    };

    await appendPersonEvent("default-person-policy-before-disable", false);

    const disabled = await runWithRequestContext({ userEmail: OWNER }, () =>
      managePolicy.run({
        databaseId: ids.databaseId,
        defaultPersonNotificationsEnabled: false,
      }),
    );
    expect(disabled).toMatchObject({
      defaultPersonNotificationsEnabled: false,
      defaultPersonNotificationsPolicyVersion: 2,
    });
    const [disabledPolicy, beforeDisableEvent] = await Promise.all([
      getDb()
        .select()
        .from(schema.contentDatabasePolicies)
        .where(
          and(
            eq(schema.contentDatabasePolicies.databaseId, ids.databaseId),
            eq(schema.contentDatabasePolicies.version, 2),
          ),
        )
        .then((rows) => rows[0]),
      getDb()
        .select({ eventSequence: schema.workflowEvents.eventSequence })
        .from(schema.workflowEvents)
        .where(
          eq(schema.workflowEvents.id, "default-person-policy-before-disable"),
        )
        .then((rows) => rows[0]),
    ]);
    expect(disabledPolicy).toMatchObject({
      version: 2,
      enabled: false,
      ownerEmail: OWNER,
    });
    expect(disabledPolicy!.activeAfterSequence).toBeGreaterThan(
      beforeDisableEvent!.eventSequence,
    );

    await materializeWorkflowExecutions({
      eventId: "default-person-policy-before-disable",
      now: Date.now() + 1,
    });
    const beforeDisableExecution = await getDb()
      .select()
      .from(schema.workflowExecutions)
      .where(
        and(
          eq(
            schema.workflowExecutions.eventId,
            "default-person-policy-before-disable",
          ),
          eq(
            schema.workflowExecutions.subscriptionId,
            contentDefaultPersonSubscriptionId(ids.databaseId),
          ),
        ),
      );
    expect(beforeDisableExecution).toHaveLength(1);
    expect(beforeDisableExecution[0]?.subscriptionVersion).toBe(1);

    await appendPersonEvent("default-person-policy-disabled");
    const [afterDisableEvent] = await getDb()
      .select({ eventSequence: schema.workflowEvents.eventSequence })
      .from(schema.workflowEvents)
      .where(eq(schema.workflowEvents.id, "default-person-policy-disabled"));
    expect(disabledPolicy!.activeAfterSequence).toBeLessThan(
      afterDisableEvent!.eventSequence,
    );
    const disabledSnapshot = await getDb()
      .select()
      .from(schema.workflowSubscriptionVersions)
      .where(
        and(
          eq(
            schema.workflowSubscriptionVersions.subscriptionId,
            contentDefaultPersonSubscriptionId(ids.databaseId),
          ),
          eq(schema.workflowSubscriptionVersions.version, 2),
        ),
      );
    expect(disabledSnapshot).toHaveLength(1);
    expect(disabledSnapshot[0]).toMatchObject({ enabled: false });
    expect(JSON.parse(disabledSnapshot[0]!.config)).toMatchObject({
      policy: {
        enabled: false,
        source: "database_policy",
        disabledReason: "owner_disabled",
      },
    });
    const disabledExecutions = await getDb()
      .select()
      .from(schema.workflowExecutions)
      .where(
        and(
          eq(
            schema.workflowExecutions.eventId,
            "default-person-policy-disabled",
          ),
          eq(
            schema.workflowExecutions.subscriptionId,
            contentDefaultPersonSubscriptionId(ids.databaseId),
          ),
        ),
      );
    expect(disabledExecutions).toHaveLength(0);

    const enabled = await runWithRequestContext({ userEmail: OWNER }, () =>
      managePolicy.run({
        databaseId: ids.databaseId,
        defaultPersonNotificationsEnabled: true,
      }),
    );
    expect(enabled).toMatchObject({
      defaultPersonNotificationsEnabled: true,
      defaultPersonNotificationsPolicyVersion: 3,
    });
    expect(beforeDisableExecution[0]?.subscriptionVersion).toBe(1);
    await appendPersonEvent("default-person-policy-enabled");
    const enabledExecutions = await getDb()
      .select()
      .from(schema.workflowExecutions)
      .where(
        and(
          eq(
            schema.workflowExecutions.eventId,
            "default-person-policy-enabled",
          ),
          eq(
            schema.workflowExecutions.subscriptionId,
            contentDefaultPersonSubscriptionId(ids.databaseId),
          ),
        ),
      );
    expect(enabledExecutions).toHaveLength(1);
  });

  it("enforces the database schema lock for members while preserving owner edits", async () => {
    await runWithRequestContext({ userEmail: OWNER }, () =>
      managePolicy.run({ databaseId: ids.databaseId, schemaLocked: true }),
    );
    const propertyInput = {
      documentId: ids.databaseDocumentId,
      name: "Locked schema proof",
      type: "text" as const,
    };
    await expect(
      runWithRequestContext({ userEmail: COLLABORATOR }, () =>
        configureProperty.run(propertyInput),
      ),
    ).rejects.toThrow("This database is locked");
    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        configureProperty.run(propertyInput),
      ),
    ).resolves.toMatchObject({ databaseId: ids.databaseId });
    await runWithRequestContext({ userEmail: OWNER }, () =>
      managePolicy.run({ databaseId: ids.databaseId, schemaLocked: false }),
    );
  });

  it("commits the actor-aware property transition envelope atomically", async () => {
    await runWithRequestContext(
      {
        userEmail: OWNER,
        run: {
          owner: OWNER,
          threadId: "thread-hooks-1",
          model: "test-agent-model",
        },
      },
      () =>
        setProperty.run({
          documentId: ids.itemDocumentId,
          propertyId: ids.statusPropertyId,
          value: ids.reviewOptionId,
        }),
    );

    const events = await getDb()
      .select()
      .from(schema.workflowEvents)
      .where(eq(schema.workflowEvents.subjectId, ids.itemDocumentId));
    expect(events).toHaveLength(1);
    const event = events[0];
    const payload = JSON.parse(event.payload);
    const actor = JSON.parse(event.actorContext);
    expect(payload).toMatchObject({
      databaseId: ids.databaseId,
      propertyId: ids.statusPropertyId,
      beforeValue: ids.draftOptionId,
      afterValue: ids.reviewOptionId,
      propertyValues: {
        [ids.assigneePropertyId]: ["reviewer@example.com"],
      },
    });
    expect(actor).toMatchObject({
      initiator: { kind: "human", id: OWNER },
      executor: {
        kind: "agent",
        id: "thread-hooks-1",
        model: "test-agent-model",
      },
      origin: { kind: "agent", threadId: "thread-hooks-1" },
    });
    expect(
      matchesContentDatabaseHook(
        {
          ...event,
          payload,
          actorContext: actor,
        },
        {
          databaseId: ids.databaseId,
          trigger: {
            kind: "property_changed",
            propertyId: ids.statusPropertyId,
            fromOptionId: ids.draftOptionId,
            toOptionId: ids.reviewOptionId,
          },
          conditions: {
            mode: "all",
            clauses: [
              {
                propertyId: ids.assigneePropertyId,
                operator: "is_not_empty",
              },
            ],
          },
        },
      ),
    ).toBe(true);
  });

  it("carries causal hook lineage into the atomic property event", async () => {
    await runWithRequestContext({ userEmail: OWNER }, () =>
      runWithContentWorkflowCausality(
        {
          causalEventId: "parent-event-example",
          parentExecutionId: "parent-execution-example",
          parentSubscriptionId: "parent-subscription-example",
          chainDepth: 2,
          subscriptionPath: [
            "first-subscription",
            "parent-subscription-example",
          ],
          initiator: { kind: "human", id: COLLABORATOR },
        },
        () =>
          setProperty.run({
            documentId: ids.itemDocumentId,
            propertyId: ids.assigneePropertyId,
            value: [ADMIN],
          }),
      ),
    );

    const [event] = await getDb()
      .select()
      .from(schema.workflowEvents)
      .where(eq(schema.workflowEvents.causalEventId, "parent-event-example"));
    expect(event).toBeTruthy();
    expect(JSON.parse(event.actorContext)).toMatchObject({
      initiator: { kind: "human", id: COLLABORATOR },
      executor: {
        kind: "automation",
        id: "content-hook:parent-subscription-example",
      },
      origin: { kind: "system" },
      lineage: {
        parentExecutionId: "parent-execution-example",
        parentSubscriptionId: "parent-subscription-example",
        chainDepth: 2,
        subscriptionPath: ["first-subscription", "parent-subscription-example"],
      },
      authority: { ownerEmail: OWNER },
    });
  });

  it("notifies newly added people by default and honors item-to-global preference precedence", async () => {
    const database = {
      id: ids.databaseId,
      title: "Design asks",
      ownerEmail: OWNER,
      orgId: null,
    };
    await materializeWorkflowExecutions({ now: Date.now() });
    const subscription = await getWorkflowSubscription(
      contentDefaultPersonSubscriptionId(database.id),
    );
    expect(subscription).toMatchObject({
      id: contentDefaultPersonSubscriptionId(database.id),
      enabled: true,
      config: {
        system: "default_person_notifications",
        databaseId: database.id,
      },
    });
    if (!subscription)
      throw new Error("Virtual person rule was not materialized");
    const event = {
      id: "default-person-event",
      eventSequence: 100,
      topic: "content.database.property.changed",
      subjectType: "content_database_item",
      subjectId: ids.itemDocumentId,
      subjectKey: `content_database_item:${ids.itemDocumentId}`,
      ownerEmail: OWNER,
      orgId: null,
      payload: {
        databaseId: ids.databaseId,
        propertyType: "person",
        beforeValue: ["existing@example.com"],
        afterValue: ["existing@example.com", "reviewer@example.com"],
      },
      actorContext: {},
      causalEventId: null,
      occurredAt: Date.now(),
      availableAt: Date.now(),
      createdAt: Date.now(),
    };
    expect(
      prepareContentNotificationEffect({ event, subscription }),
    ).toMatchObject({
      payload: { recipients: ["reviewer@example.com"] },
    });
    expect(
      prepareContentNotificationEffect({
        event: {
          ...event,
          id: "default-person-create-event",
          topic: "content.database.item.created",
          payload: {
            databaseId: ids.databaseId,
            personPropertyIds: [ids.assigneePropertyId],
            propertyValues: {
              [ids.assigneePropertyId]: ["reviewer@example.com"],
              [ids.statusPropertyId]: ["not-a-person@example.com"],
            },
          },
        },
        subscription,
      }),
    ).toMatchObject({
      payload: { recipients: ["reviewer@example.com"] },
    });

    const actionContext = {
      caller: "frontend" as const,
      userEmail: "reviewer@example.com",
      orgId: null,
    };
    const managePersonalPreference = (
      args: Parameters<typeof managePreference.run>[0],
    ) =>
      runWithRequestContext({ userEmail: "reviewer@example.com" }, () =>
        managePreference.run(args, actionContext),
      );
    await managePersonalPreference({
      action: "set",
      target: { scope: "global" },
      enabled: false,
    });
    await managePersonalPreference({
      action: "set",
      target: { scope: "database", databaseId: ids.databaseId },
      enabled: true,
    });
    await managePersonalPreference({
      action: "set",
      target: {
        scope: "rule",
        databaseId: ids.databaseId,
        subscriptionId: subscription.id,
      },
      enabled: false,
    });
    await managePersonalPreference({
      action: "set",
      target: {
        scope: "item",
        databaseId: ids.databaseId,
        documentId: ids.itemDocumentId,
      },
      enabled: true,
    });
    await expect(
      runWithRequestContext({ userEmail: "reviewer@example.com" }, () =>
        getPreference.run(
          {
            scope: "item",
            databaseId: ids.databaseId,
            documentId: ids.itemDocumentId,
          },
          actionContext,
        ),
      ),
    ).resolves.toMatchObject({
      target: {
        scope: "item",
        databaseId: ids.databaseId,
        documentId: ids.itemDocumentId,
      },
      preference: { enabled: true, source: "item" },
    });
    await expect(
      getPreference.run(
        {
          scope: "item",
          databaseId: ids.databaseId,
          documentId: ids.itemDocumentId,
          subscriptionId: subscription.id,
        },
        actionContext,
      ),
    ).rejects.toThrow("Unexpected identifiers for item scope.");
    await expect(
      resolveContentNotificationPreference({
        ownerEmail: "reviewer@example.com",
        databaseId: ids.databaseId,
        subscriptionId: subscription.id,
        documentId: ids.itemDocumentId,
      }),
    ).resolves.toMatchObject({ enabled: true, source: "item" });

    await managePersonalPreference({
      action: "remove",
      target: {
        scope: "item",
        databaseId: ids.databaseId,
        documentId: ids.itemDocumentId,
      },
    });
    await expect(
      resolveContentNotificationPreference({
        ownerEmail: "reviewer@example.com",
        databaseId: ids.databaseId,
        subscriptionId: subscription.id,
        documentId: ids.itemDocumentId,
      }),
    ).resolves.toMatchObject({ enabled: false, source: "rule" });

    await executeContentDatabaseHook({
      id: "suppressed-execution",
      eventId: event.id,
      subscriptionId: subscription.id,
      subscriptionVersion: subscription.version,
      status: "running",
      attempt: 1,
      leaseToken: "suppressed-lease",
      leaseExpiresAt: Date.now() + 30_000,
      fenceVersion: 1,
      event,
      subscription,
    });
    const [effect] = await getDb()
      .select()
      .from(schema.workflowEffects)
      .where(eq(schema.workflowEffects.executionId, "suppressed-execution"));
    expect(effect.status).toBe("suppressed");
    expect(JSON.parse(effect.result)).toMatchObject({
      recipient: "reviewer@example.com",
      outcome: "suppressed_by_preference",
      preferenceScope: "rule",
    });
  });

  it("polls durable events without a bus wake and records unroutable recipients", async () => {
    const eventId = "hooks_bus_off_event";
    const now = Date.now();
    await getDb().transaction(async (tx: any) => {
      const eventSequence = await allocateContentWorkflowEventSequence(tx);
      await tx.insert(schema.workflowEvents).values(
        createWorkflowEventValues({
          id: eventId,
          eventSequence,
          topic: "content.builder.publication.confirmed",
          subjectType: "content_database_item",
          subjectId: ids.itemDocumentId,
          ownerEmail: OWNER,
          payload: {
            databaseId: ids.databaseId,
            documentId: ids.itemDocumentId,
            effect: "publish",
            propertyValues: {
              [ids.assigneePropertyId]: ["no-access@example.com"],
            },
          },
          actorContext: {
            initiator: { kind: "system", id: "system" },
            executor: { kind: "system", id: "system" },
            authority: { ownerEmail: OWNER },
          },
          occurredAt: now,
        }),
      );
    });

    const [hook] = await runWithRequestContext({ userEmail: OWNER }, () =>
      listHooks.run({ databaseId: ids.databaseId }),
    ).then((result) => result.hooks);
    let execution: any;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      [execution] = await getDb()
        .select()
        .from(schema.workflowExecutions)
        .where(
          and(
            eq(schema.workflowExecutions.eventId, eventId),
            eq(schema.workflowExecutions.subscriptionId, hook.id),
          ),
        );
      if (execution?.status === "succeeded") break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(execution?.status).toBe("succeeded");
    const [effect] = await getDb()
      .select()
      .from(schema.workflowEffects)
      .where(eq(schema.workflowEffects.executionId, execution.id));
    expect(effect).toMatchObject({ status: "failed" });
    expect(JSON.parse(effect.result)).toEqual({
      recipient: "no-access@example.com",
      unroutable: true,
    });
    expect(effect.errorMessage).toContain("does not have access");
  });

  it("derives inspector truth from the core ledger and limits retry acknowledgement to the owner", async () => {
    const [hook] = await runWithRequestContext({ userEmail: OWNER }, () =>
      listHooks.run({ databaseId: ids.databaseId }),
    ).then((result) => result.hooks);
    const [version] = await getDb()
      .select()
      .from(schema.workflowSubscriptionVersions)
      .where(eq(schema.workflowSubscriptionVersions.subscriptionId, hook.id));
    const now = Date.now();
    await getDb()
      .insert(schema.workflowExecutions)
      .values([
        {
          id: "inspect-unknown-execution",
          eventId: "inspect-event",
          subscriptionId: hook.id,
          subscriptionVersion: version.version,
          subjectKey: `content_database_item:${ids.itemDocumentId}`,
          status: "unknown",
          attempt: 1,
          fenceVersion: 1,
          errorMessage: "Delivery outcome is unknown.",
          createdAt: now,
          updatedAt: now,
          completedAt: now,
        },
        {
          id: "inspect-failed-execution",
          eventId: "inspect-retry-event",
          subscriptionId: hook.id,
          subscriptionVersion: version.version,
          subjectKey: "content_database_item:retry-item",
          status: "failed",
          attempt: 2,
          fenceVersion: 2,
          errorMessage: "Delivery failed.",
          createdAt: now - 1,
          updatedAt: now - 1,
          completedAt: now - 1,
        },
      ]);
    await getDb()
      .insert(schema.workflowEffects)
      .values([
        {
          id: "inspect-delivered-effect",
          executionId: "inspect-unknown-execution",
          kind: "notification",
          idempotencyKey: "inspect-delivered-effect-key",
          status: "delivered",
          result: JSON.stringify({
            recipient: "reviewer@example.com",
            notificationId: "inspect-notification",
          }),
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "inspect-coalesced-effect",
          executionId: "inspect-unknown-execution",
          kind: "notification",
          idempotencyKey: "inspect-coalesced-effect-key",
          status: "coalesced",
          result: JSON.stringify({
            outcome: "coalesced_by_event_recipient_item_destination",
            coalescedIntoExecutionId: "another-execution",
          }),
          createdAt: now + 1,
          updatedAt: now + 1,
        },
      ]);
    await getDb().insert(schema.notificationDeliveryAttempts).values({
      id: "inspect-delivery-attempt",
      effectId: "inspect-delivered-effect",
      notificationId: "inspect-notification",
      channel: "inbox",
      attempt: 1,
      status: "delivered",
      createdAt: now,
      updatedAt: now,
    });

    await expect(
      runWithRequestContext({ userEmail: ADMIN }, () =>
        manageExecution.run(
          {
            action: "acknowledge",
            databaseId: ids.databaseId,
            executionId: "inspect-unknown-execution",
          },
          { caller: "frontend", userEmail: ADMIN, orgId: null },
        ),
      ),
    ).rejects.toThrow(/only the database owner/i);

    const acknowledged = await runWithRequestContext({ userEmail: OWNER }, () =>
      manageExecution.run(
        {
          action: "acknowledge",
          databaseId: ids.databaseId,
          executionId: "inspect-unknown-execution",
        },
        { caller: "frontend", userEmail: OWNER, orgId: null },
      ),
    );
    expect(acknowledged.execution.status).toBe("acknowledged");
    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        manageExecution.run(
          {
            action: "retry",
            databaseId: ids.databaseId,
            executionId: "inspect-unknown-execution",
          },
          { caller: "frontend", userEmail: OWNER, orgId: null },
        ),
      ),
    ).rejects.toThrow(/only failed or unknown/i);

    const retried = await runWithRequestContext({ userEmail: OWNER }, () =>
      manageExecution.run(
        {
          action: "retry",
          databaseId: ids.databaseId,
          executionId: "inspect-failed-execution",
        },
        { caller: "frontend", userEmail: OWNER, orgId: null },
      ),
    );
    expect(retried.execution).toMatchObject({
      status: "pending",
      attempt: 2,
    });

    const inspected = await runWithRequestContext({ userEmail: OWNER }, () =>
      listExecutions.run({ databaseId: ids.databaseId, limit: 50 }),
    );
    const execution = inspected.executions.find(
      (candidate) => candidate.id === "inspect-unknown-execution",
    );
    expect(execution).toMatchObject({
      hookName: "Share published Builder article",
      subscriptionVersion: version.version,
      status: "acknowledged",
      canRetry: false,
      canAcknowledge: false,
      effects: [
        {
          id: "inspect-delivered-effect",
          status: "delivered",
          deliveryAttempts: [
            {
              id: "inspect-delivery-attempt",
              channel: "inbox",
              status: "delivered",
            },
          ],
        },
        {
          id: "inspect-coalesced-effect",
          status: "coalesced",
          result: {
            outcome: "coalesced_by_event_recipient_item_destination",
          },
        },
      ],
    });
  });
});
