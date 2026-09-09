import {
  table,
  text,
  uniqueIndex,
  ownableColumns,
  createSharesTable,
} from "@agent-native/core/db/schema";

export const forms = table("forms", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  slug: text("slug").notNull().unique(),
  fields: text("fields").notNull(), // JSON array of FormField
  settings: text("settings").notNull(), // JSON FormSettings
  status: text("status", { enum: ["draft", "published", "closed"] })
    .notNull()
    .default("draft"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  // ISO timestamp when soft-deleted, NULL while live. Soft delete keeps
  // responses queryable from the Archive view; restore-form clears this.
  deletedAt: text("deleted_at"),
  ...ownableColumns(),
});

export const responses = table(
  "responses",
  {
    id: text("id").primaryKey(),
    formId: text("form_id")
      .notNull()
      .references(() => forms.id),
    data: text("data").notNull(), // JSON object: { fieldId: value }
    submittedAt: text("submitted_at").notNull(),
    ip: text("ip"),
    submitterEmail: text("submitter_email"),
    // URL of the page the respondent was on, forwarded by trusted embeds (e.g.
    // the framework FeedbackButton) as a hidden pass-through field. Client-scrubbed
    // of sensitive query params. NULL for direct fills that send no page context.
    pageUrl: text("page_url"),
    // Runtime shell the feedback was sent from: "web", "electron", or "tauri".
    // Hidden pass-through field forwarded by trusted embeds. NULL when unknown.
    clientSurface: text("client_surface"),
    // Client-generated key used to make retried public submissions idempotent.
    idempotencyKey: text("idempotency_key"),
    // JSON map of side-effect destination keys to pending/succeeded/failed.
    deliveryStatus: text("delivery_status"),
    // Immutable form/schema/integration snapshot used when an idempotent
    // response needs to replay delivery after the form has changed.
    deliverySnapshot: text("delivery_snapshot"),
    // Community app review/promotion state. Uploaded screenshots remain in
    // blob storage; this row only records the Builder publication result.
    promotionStatus: text("promotion_status", {
      enum: ["publishing", "published", "failed", "unknown"],
    }),
    builderContentId: text("builder_content_id"),
    communitySlug: text("community_slug"),
    promotionError: text("promotion_error"),
    promotedAt: text("promoted_at"),
    promotedBy: text("promoted_by"),
  },
  (response) => ({
    idempotencyKeyUnique: uniqueIndex("responses_form_idempotency_key_idx").on(
      response.formId,
      response.idempotencyKey,
    ),
  }),
);

export const responseDeliveries = table(
  "response_deliveries",
  {
    id: text("id").primaryKey(),
    responseId: text("response_id")
      .notNull()
      .references(() => responses.id),
    destination: text("destination").notNull(),
    kind: text("kind", {
      enum: ["application-state", "email", "integration"],
    }).notNull(),
    payload: text("payload").notNull(),
    status: text("status", {
      enum: ["pending", "processing", "succeeded", "failed"],
    })
      .notNull()
      .default("pending"),
    claimToken: text("claim_token"),
    claimedAt: text("claimed_at"),
    errorMessage: text("error_message"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (delivery) => ({
    responseDestinationUnique: uniqueIndex(
      "response_deliveries_response_destination_idx",
    ).on(delivery.responseId, delivery.destination),
  }),
);

export const formShares = createSharesTable("form_shares");
