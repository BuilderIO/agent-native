import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  notifyWithDelivery,
  notifyPersonalWithDelivery,
  claimWorkflowEffectRetry,
  recordWorkflowEffect,
  finalizeWorkflowEffect,
  resolveAccess,
  resolveContentNotificationPreference,
  resolveContentHookRuntimeControls,
  scheduleWorkflowWork,
  setDocumentPropertyValue,
} = vi.hoisted(() => ({
  notifyWithDelivery: vi.fn(),
  notifyPersonalWithDelivery: vi.fn(),
  claimWorkflowEffectRetry: vi.fn(),
  recordWorkflowEffect: vi.fn(),
  finalizeWorkflowEffect: vi.fn(),
  resolveAccess: vi.fn(),
  resolveContentNotificationPreference: vi.fn(),
  resolveContentHookRuntimeControls: vi.fn(),
  scheduleWorkflowWork: vi.fn(),
  setDocumentPropertyValue: vi.fn(),
}));

vi.mock("@agent-native/core/notifications", () => ({
  notifyWithDelivery,
  notifyPersonalWithDelivery,
}));
vi.mock("@agent-native/core/sharing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/sharing")>()),
  resolveAccess,
}));
vi.mock("@agent-native/core/workflow", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/workflow")>()),
  recordWorkflowEffect,
  claimWorkflowEffectRetry,
  finalizeWorkflowEffect,
  scheduleWorkflowWork,
}));
vi.mock("./_content-notification-preferences.js", () => ({
  resolveContentNotificationPreference,
}));
vi.mock("./_content-hook-runtime-controls.js", () => ({
  resolveContentHookRuntimeControls,
}));
vi.mock("./set-document-property.js", () => ({ setDocumentPropertyValue }));
vi.mock("./_content-database-hooks.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./_content-database-hooks.js")>()),
  contentHookHasCurrentAuthority: vi.fn(async () => true),
}));

import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";

import {
  contentHookConditionsMatch,
  executeContentDatabaseHook,
  matchesContentDatabaseHook,
  previewContentDatabaseHook,
} from "./_content-hook-execution.js";

function mutationClaim(lineage: Record<string, unknown> = {}) {
  return {
    id: "execution-mutation",
    eventId: "event-mutation",
    subscriptionId: "subscription-mutation",
    subscriptionVersion: 1,
    status: "running" as const,
    attempt: 1,
    leaseToken: "lease-mutation",
    leaseExpiresAt: Date.now() + 30_000,
    fenceVersion: 1,
    event: {
      id: "event-mutation",
      topic: "content.database.property.changed",
      subjectType: "content_database_item",
      subjectId: "document-example",
      subjectKey: "content_database_item:document-example",
      ownerEmail: "owner@example.com",
      orgId: null,
      payload: {
        databaseId: "database-example",
        propertyId: "status-example",
        beforeValue: "draft-example",
        afterValue: "published-example",
      },
      actorContext: {
        initiator: { kind: "human", id: "author@example.com" },
        lineage,
      },
      causalEventId: null,
      occurredAt: 1,
      availableAt: 1,
      createdAt: 1,
    },
    subscription: {
      id: "subscription-mutation",
      version: 1,
      kind: "deterministic" as const,
      eventPattern: "content.database.property.changed",
      ownerEmail: "owner@example.com",
      orgId: null,
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
      config: {
        domain: "content",
        databaseId: "database-example",
        name: "Set review owner",
        trigger: {
          kind: "property_changed",
          propertyId: "status-example",
          fromOptionId: "draft-example",
          toOptionId: "published-example",
        },
        effects: [
          {
            version: 1,
            kind: "set_property",
            propertyId: "review-owner-example",
            value: "owner@example.com",
          },
        ],
        timing: { kind: "immediate" },
        createdBy: "owner@example.com",
      },
    },
  };
}

describe("Content shared-destination hook effects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    let effect = 0;
    const effects = new Map<string, Record<string, unknown>>();
    recordWorkflowEffect.mockImplementation(
      async ({ executionId, idempotencyKey, kind }) => {
        const existing = effects.get(idempotencyKey);
        if (existing) return { created: false, effect: existing };
        const created = {
          id: `effect-${effect++}`,
          executionId,
          idempotencyKey,
          kind,
          status: "unknown",
        };
        effects.set(idempotencyKey, created);
        return { created: true, effect: created };
      },
    );
    finalizeWorkflowEffect.mockImplementation(async ({ effectId, status }) => {
      for (const effectValue of effects.values()) {
        if (effectValue.id === effectId) effectValue.status = status;
      }
      return true;
    });
    claimWorkflowEffectRetry.mockImplementation(async ({ effectId }) => {
      for (const effectValue of effects.values()) {
        if (effectValue.id !== effectId || effectValue.status !== "failed") {
          continue;
        }
        effectValue.status = "unknown";
        return true;
      }
      return false;
    });
    notifyWithDelivery.mockImplementation(async (input) => ({
      deliveredChannels: input.channels ?? [],
      unknownChannels: [],
      skippedChannels: [],
      failedChannels: [],
      channelOutcomes: [],
      notification: { id: "notification-example" },
    }));
    notifyPersonalWithDelivery.mockResolvedValue({
      deliveredChannels: ["inbox"],
      unknownChannels: [],
      skippedChannels: [],
      failedChannels: [],
      channelOutcomes: [],
      notification: { id: "notification-example" },
    });
    resolveAccess.mockResolvedValue({ role: "viewer" });
    resolveContentNotificationPreference.mockResolvedValue({
      enabled: true,
      source: "default",
      preferenceId: null,
    });
    resolveContentHookRuntimeControls.mockResolvedValue({
      evaluatorPaused: false,
      effectsPaused: false,
    });
    scheduleWorkflowWork.mockResolvedValue("scheduled-example");
    setDocumentPropertyValue.mockResolvedValue({
      documentId: "document-example",
    });
  });

  it("evaluates inspectable all and any conditions against one property snapshot", () => {
    const values = {
      status: "ready",
      title: "Launch notes",
      tags: ["marketing", "sales"],
      brief: "",
    };
    expect(
      contentHookConditionsMatch(values, {
        mode: "all",
        clauses: [
          { propertyId: "status", operator: "equals", value: "ready" },
          { propertyId: "title", operator: "contains", value: "Launch" },
          { propertyId: "tags", operator: "contains", value: "sales" },
          { propertyId: "brief", operator: "is_empty" },
        ],
      }),
    ).toBe(true);
    expect(
      contentHookConditionsMatch(values, {
        mode: "any",
        clauses: [
          { propertyId: "status", operator: "not_equals", value: "ready" },
          { propertyId: "brief", operator: "is_not_empty" },
        ],
      }),
    ).toBe(false);
  });

  it("applies conditions to the immutable event snapshot", () => {
    const event = {
      ...mutationClaim().event,
      payload: {
        ...mutationClaim().event.payload,
        propertyValues: { status: "ready", requiredBrief: "" },
      },
    };
    expect(
      matchesContentDatabaseHook(event, {
        databaseId: "database-example",
        trigger: { kind: "property_changed", propertyId: "status-example" },
        conditions: {
          mode: "all",
          clauses: [{ propertyId: "requiredBrief", operator: "is_empty" }],
        },
      }),
    ).toBe(true);
    expect(
      matchesContentDatabaseHook(event, {
        databaseId: "database-example",
        trigger: { kind: "property_changed", propertyId: "status-example" },
        conditions: {
          mode: "all",
          clauses: [{ propertyId: "requiredBrief", operator: "is_not_empty" }],
        },
      }),
    ).toBe(false);
  });

  it("does not execute an immediate Rule when its event-snapshot conditions fail", async () => {
    const claim = mutationClaim() as any;
    claim.event.payload.propertyValues = { requiredBrief: "" };
    claim.subscription.config.conditions = {
      mode: "all",
      clauses: [{ propertyId: "requiredBrief", operator: "is_not_empty" }],
    };

    await expect(executeContentDatabaseHook(claim)).resolves.toEqual({
      status: "succeeded",
    });
    expect(setDocumentPropertyValue).not.toHaveBeenCalled();
    expect(recordWorkflowEffect).not.toHaveBeenCalled();
  });

  it("matches logical submission independently from generic item creation", () => {
    const event = {
      ...mutationClaim().event,
      topic: "content.database.item.submitted",
    };
    expect(
      matchesContentDatabaseHook(event, {
        databaseId: "database-example",
        trigger: { kind: "item_submitted" },
      }),
    ).toBe(true);
    expect(
      matchesContentDatabaseHook(event, {
        databaseId: "database-example",
        trigger: { kind: "item_created" },
      }),
    ).toBe(false);
  });

  it("runs ordered team Slack and signed-webhook effects without storing secret values", async () => {
    const result = await executeContentDatabaseHook({
      id: "execution-example",
      eventId: "event-example",
      subscriptionId: "subscription-example",
      subscriptionVersion: 1,
      status: "running",
      attempt: 1,
      leaseToken: "lease-example",
      leaseExpiresAt: Date.now() + 30_000,
      fenceVersion: 1,
      event: {
        id: "event-example",
        topic: "content.database.property.changed",
        subjectType: "content_database_item",
        subjectId: "document-example",
        subjectKey: "content_database_item:document-example",
        ownerEmail: "owner@example.com",
        orgId: null,
        payload: {
          databaseId: "database-example",
          propertyId: "status-example",
          beforeValue: "draft-example",
          afterValue: "published-example",
        },
        actorContext: {},
        causalEventId: null,
        occurredAt: 1,
        availableAt: 1,
        createdAt: 1,
      },
      subscription: {
        id: "subscription-example",
        version: 1,
        kind: "deterministic",
        eventPattern: "content.database.property.changed",
        ownerEmail: "owner@example.com",
        orgId: null,
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
        config: {
          domain: "content",
          databaseId: "database-example",
          name: "Blog published",
          trigger: {
            kind: "property_changed",
            propertyId: "status-example",
            fromOptionId: "draft-example",
            toOptionId: "published-example",
          },
          effects: [
            { kind: "team_slack", webhookKey: "MARKETING_SLACK" },
            {
              kind: "webhook",
              urlKey: "PUBLISH_WEBHOOK_URL",
              signatureKey: "PUBLISH_WEBHOOK_SIGNING_SECRET",
            },
          ],
          createdBy: "owner@example.com",
        },
      },
    });

    expect(result).toEqual({ status: "succeeded" });
    expect(recordWorkflowEffect.mock.calls.map(([call]) => call.kind)).toEqual([
      "team_slack",
      "webhook",
    ]);
    expect(notifyWithDelivery).toHaveBeenCalledTimes(2);
    expect(notifyWithDelivery.mock.calls[0][0]).toMatchObject({
      channels: ["slack"],
      metadata: {
        delivery: { slackWebhookUrl: "${keys.MARKETING_SLACK}" },
      },
    });
    expect(notifyWithDelivery.mock.calls[1][0]).toMatchObject({
      channels: ["webhook"],
      metadata: {
        delivery: {
          webhookUrl: "${keys.PUBLISH_WEBHOOK_URL}",
          webhookSignature: "${keys.PUBLISH_WEBHOOK_SIGNING_SECRET}",
        },
      },
    });
    expect(JSON.stringify(notifyWithDelivery.mock.calls)).not.toContain(
      "example-signing-secret",
    );
    expect(finalizeWorkflowEffect).toHaveBeenCalledTimes(2);
  });

  it("keeps an accepted team Slack send unknown without a delivery receipt", async () => {
    notifyWithDelivery.mockResolvedValueOnce({
      deliveredChannels: [],
      unknownChannels: ["slack"],
      skippedChannels: [],
      failedChannels: [],
      channelOutcomes: [
        {
          channel: "slack",
          status: "unknown",
          evidence: { providerAccepted: true },
        },
      ],
    });
    const claim = mutationClaim() as any;
    claim.subscription.config.name = "Announce publication";
    claim.subscription.config.effects = [
      { kind: "team_slack", webhookKey: "MARKETING_SLACK" },
    ];

    await expect(executeContentDatabaseHook(claim)).resolves.toMatchObject({
      status: "unknown",
    });
    expect(finalizeWorkflowEffect).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "unknown",
        result: expect.objectContaining({
          destination: "team_slack",
          unknownChannels: ["slack"],
        }),
      }),
    );
  });

  it("retries a destination that explicitly failed before provider acceptance", async () => {
    notifyWithDelivery.mockResolvedValueOnce({
      deliveredChannels: [],
      unknownChannels: [],
      skippedChannels: [],
      failedChannels: ["slack"],
      channelOutcomes: [
        { channel: "slack", status: "failed", error: "rejected" },
      ],
    });
    const claim = mutationClaim() as any;
    claim.subscription.config.effects = [
      { kind: "team_slack", webhookKey: "MARKETING_SLACK" },
    ];

    await expect(executeContentDatabaseHook(claim)).resolves.toMatchObject({
      status: "retrying",
    });
    claim.attempt = 2;
    await expect(executeContentDatabaseHook(claim)).resolves.toEqual({
      status: "succeeded",
    });
    expect(claimWorkflowEffectRetry).toHaveBeenCalledTimes(1);
    expect(notifyWithDelivery).toHaveBeenCalledTimes(2);
  });

  it("binds destination delivery to the claimed owner and organization", async () => {
    const claim = mutationClaim() as any;
    claim.subscription.orgId = "org-claimed";
    claim.event.orgId = "org-claimed";
    claim.subscription.config.effects = [
      { kind: "webhook", urlKey: "URL", signatureKey: "SIGNATURE" },
    ];
    notifyWithDelivery.mockImplementationOnce(async (input) => {
      expect(getRequestUserEmail()).toBe("owner@example.com");
      expect(getRequestOrgId()).toBe("org-claimed");
      return {
        deliveredChannels: input.channels ?? [],
        unknownChannels: [],
        skippedChannels: [],
        failedChannels: [],
        channelOutcomes: [],
      };
    });

    await expect(executeContentDatabaseHook(claim)).resolves.toEqual({
      status: "succeeded",
    });
  });

  it("runs a versioned property effect through the certified mutation service", async () => {
    await expect(executeContentDatabaseHook(mutationClaim())).resolves.toEqual({
      status: "succeeded",
    });

    expect(setDocumentPropertyValue).toHaveBeenCalledWith(
      {
        documentId: "document-example",
        propertyId: "review-owner-example",
        value: "owner@example.com",
      },
      { caller: "tool", userEmail: "owner@example.com" },
    );
    expect(finalizeWorkflowEffect).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "delivered",
        result: expect.objectContaining({
          outcome: "property_set",
          chainDepth: 1,
          subscriptionPath: ["subscription-mutation"],
        }),
      }),
    );
  });

  it.each([
    [
      "cycle_detected",
      { subscriptionPath: ["subscription-mutation"], chainDepth: 1 },
    ],
    [
      "max_chain_depth_exceeded",
      {
        subscriptionPath: Array.from(
          { length: 8 },
          (_, index) => `subscription-${index}`,
        ),
        chainDepth: 8,
      },
    ],
  ])(
    "records %s before refusing a property mutation",
    async (outcome, lineage) => {
      await expect(
        executeContentDatabaseHook(mutationClaim(lineage)),
      ).resolves.toEqual({ status: "succeeded" });

      expect(setDocumentPropertyValue).not.toHaveBeenCalled();
      expect(finalizeWorkflowEffect).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "suppressed",
          result: expect.objectContaining({ outcome }),
        }),
      );
    },
  );

  it("previews matches and ordered effects without delivering anything", () => {
    const preview = previewContentDatabaseHook({
      event: {
        id: "event-preview",
        topic: "content.database.property.changed",
        subjectType: "content_database_item",
        subjectId: "document-preview",
        subjectKey: "content_database_item:document-preview",
        ownerEmail: "owner@example.com",
        orgId: null,
        payload: {
          databaseId: "database-example",
          propertyId: "status-example",
          beforeValue: "draft-example",
          afterValue: "published-example",
          propertyValues: { assignee: ["reviewer@example.com"] },
        },
        actorContext: { initiator: { kind: "human" } },
        causalEventId: null,
        occurredAt: 1,
        availableAt: 1,
        createdAt: 1,
      },
      subscription: {
        id: "subscription-preview",
        version: 1,
        kind: "deterministic",
        eventPattern: "content.database.property.changed",
        ownerEmail: "owner@example.com",
        orgId: null,
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
        config: {
          domain: "content",
          databaseId: "database-example",
          name: "Published",
          trigger: {
            kind: "property_changed",
            propertyId: "status-example",
            fromOptionId: "draft-example",
            toOptionId: "published-example",
          },
          effects: [
            { kind: "notify", recipientPersonPropertyId: "assignee" },
            { kind: "team_slack", webhookKey: "MARKETING_SLACK" },
          ],
          createdBy: "owner@example.com",
        },
      },
    });

    expect(preview).toMatchObject({
      matched: true,
      effects: [
        {
          kind: "notify",
          wouldAttempt: true,
          recipients: ["reviewer@example.com"],
        },
        {
          kind: "team_slack",
          wouldAttempt: true,
          destinationKeyNames: ["MARKETING_SLACK"],
        },
      ],
    });
    expect(notifyWithDelivery).not.toHaveBeenCalled();
    expect(recordWorkflowEffect).not.toHaveBeenCalled();
  });

  it("matches provider-confirmed Builder publication truth", () => {
    const preview = previewContentDatabaseHook({
      event: {
        id: "event-builder-published",
        topic: "content.builder.publication.confirmed",
        subjectType: "content_database_item",
        subjectId: "document-builder",
        subjectKey: "content_database_item:document-builder",
        ownerEmail: "owner@example.com",
        orgId: null,
        payload: { databaseId: "database-example", effect: "publish" },
        actorContext: {},
        causalEventId: null,
        occurredAt: 1,
        availableAt: 1,
        createdAt: 1,
      },
      subscription: {
        id: "subscription-builder",
        version: 1,
        kind: "deterministic",
        eventPattern: "content.builder.publication.confirmed",
        ownerEmail: "owner@example.com",
        orgId: null,
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
        config: {
          domain: "content",
          databaseId: "database-example",
          name: "Builder published",
          trigger: {
            kind: "builder_publication_confirmed",
            publicationAction: "publish",
          },
          effects: [{ kind: "team_slack", webhookKey: "MARKETING_SLACK" }],
          timing: { kind: "immediate" },
          createdBy: "owner@example.com",
        },
      },
    });
    expect(preview?.matched).toBe(true);
  });

  it("schedules delayed and debounced effects on the shared durable timer", async () => {
    const baseClaim = {
      id: "execution-timed",
      eventId: "event-timed",
      subscriptionId: "subscription-timed",
      subscriptionVersion: 1,
      status: "running" as const,
      attempt: 1,
      leaseToken: "lease-timed",
      leaseExpiresAt: Date.now() + 30_000,
      fenceVersion: 1,
      event: {
        id: "event-timed",
        topic: "content.database.item.created",
        subjectType: "content_database_item",
        subjectId: "document-timed",
        subjectKey: "content_database_item:document-timed",
        ownerEmail: "owner@example.com",
        orgId: null,
        payload: { databaseId: "database-example" },
        actorContext: {},
        causalEventId: null,
        occurredAt: 1,
        availableAt: 1,
        createdAt: 1,
      },
      subscription: {
        id: "subscription-timed",
        version: 1,
        kind: "deterministic" as const,
        eventPattern: "content.database.item.created",
        ownerEmail: "owner@example.com",
        orgId: null,
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
        config: {
          domain: "content",
          databaseId: "database-example",
          name: "Quiet assignment",
          trigger: { kind: "item_created" },
          effects: [{ kind: "team_slack", webhookKey: "MARKETING_SLACK" }],
          timing: { kind: "debounced", delayMinutes: 5 },
          createdBy: "owner@example.com",
        },
      },
    };
    await expect(executeContentDatabaseHook(baseClaim)).resolves.toEqual({
      status: "succeeded",
    });
    expect(scheduleWorkflowWork).toHaveBeenCalledWith(
      expect.objectContaining({
        workType: "content_hook_timing",
        dedupeKey:
          "content_hook_debounce:subscription-timed:content_database_item:document-timed",
      }),
    );
    expect(notifyWithDelivery).not.toHaveBeenCalled();

    await executeContentDatabaseHook({
      ...baseClaim,
      id: "execution-later",
      eventId: "event-later",
      event: { ...baseClaim.event, id: "event-later" },
    });
    expect(scheduleWorkflowWork.mock.calls[1][0].dedupeKey).toBe(
      scheduleWorkflowWork.mock.calls[0][0].dedupeKey,
    );
  });

  it("leaves pause authority to the core claim boundary", async () => {
    resolveContentHookRuntimeControls.mockResolvedValue({
      evaluatorPaused: false,
      effectsPaused: true,
    });
    const claim = {
      id: "execution-paused",
      eventId: "event-paused",
      subscriptionId: "subscription-paused",
      subscriptionVersion: 1,
      status: "running" as const,
      attempt: 1,
      leaseToken: "lease-paused",
      leaseExpiresAt: Date.now() + 30_000,
      fenceVersion: 1,
      event: {
        id: "event-paused",
        topic: "content.database.item.created",
        subjectType: "content_database_item",
        subjectId: "document-paused",
        subjectKey: "content_database_item:document-paused",
        ownerEmail: "owner@example.com",
        orgId: null,
        payload: { databaseId: "database-example" },
        actorContext: {},
        causalEventId: null,
        occurredAt: 1,
        availableAt: 1,
        createdAt: 1,
      },
      subscription: {
        id: "subscription-paused",
        version: 1,
        kind: "deterministic" as const,
        eventPattern: "content.database.item.created",
        ownerEmail: "owner@example.com",
        orgId: null,
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
        config: {
          domain: "content",
          databaseId: "database-example",
          name: "Paused",
          trigger: { kind: "item_created" },
          effects: [{ kind: "team_slack", webhookKey: "MARKETING_SLACK" }],
          timing: { kind: "immediate" },
          createdBy: "owner@example.com",
        },
      },
    };
    await expect(executeContentDatabaseHook(claim)).resolves.toEqual({
      status: "succeeded",
    });
    expect(resolveContentHookRuntimeControls).not.toHaveBeenCalled();
    expect(recordWorkflowEffect).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "team_slack" }),
    );
    expect(finalizeWorkflowEffect).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "delivered",
      }),
    );
    expect(notifyWithDelivery).toHaveBeenCalledTimes(1);
  });

  it("atomically coalesces default and custom personal hooks for one committed change", async () => {
    const event = {
      id: "event-coalesce",
      topic: "content.database.item.created",
      subjectType: "content_database_item",
      subjectId: "document-coalesce",
      subjectKey: "content_database_item:document-coalesce",
      ownerEmail: "owner@example.com",
      orgId: null,
      payload: {
        databaseId: "database-example",
        personPropertyIds: ["assignee"],
        propertyValues: { assignee: ["reviewer@example.com"] },
      },
      actorContext: {},
      causalEventId: null,
      occurredAt: 1,
      availableAt: 1,
      createdAt: 1,
    } as const;
    const defaultSubscription = {
      id: "content-default-person:database-example",
      version: 1,
      kind: "deterministic" as const,
      eventPattern: "content.database.*",
      ownerEmail: "owner@example.com",
      orgId: null,
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
      config: {
        domain: "content",
        system: "default_person_notifications",
        databaseId: "database-example",
        name: "Default mention",
      },
    };
    const customSubscription = {
      ...defaultSubscription,
      id: "custom-assignment-hook",
      eventPattern: "content.database.item.created",
      config: {
        domain: "content",
        databaseId: "database-example",
        name: "Assigned",
        trigger: { kind: "item_created" },
        effects: [{ kind: "notify", recipientPersonPropertyId: "assignee" }],
        createdBy: "owner@example.com",
      },
    };
    const claim = (id: string, subscription: typeof defaultSubscription) => ({
      id,
      eventId: event.id,
      subscriptionId: subscription.id,
      subscriptionVersion: 1,
      status: "running" as const,
      attempt: 1,
      leaseToken: `lease-${id}`,
      leaseExpiresAt: Date.now() + 30_000,
      fenceVersion: 1,
      event,
      subscription,
    });

    await executeContentDatabaseHook(
      claim("default-execution", defaultSubscription),
    );
    await executeContentDatabaseHook(
      claim(
        "custom-execution",
        customSubscription as typeof defaultSubscription,
      ),
    );

    expect(notifyPersonalWithDelivery).toHaveBeenCalledTimes(1);
    expect(finalizeWorkflowEffect).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "coalesced",
        result: expect.objectContaining({
          recipient: "reviewer@example.com",
          coalescedIntoExecutionId: "default-execution",
        }),
      }),
    );
  });
});
