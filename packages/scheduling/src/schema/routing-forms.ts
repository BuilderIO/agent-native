import {
  table,
  text,
  ownableColumns,
  createSharesTable,
} from "@agent-native/core/db/schema";
import { boolean } from "drizzle-orm/pg-core";

export const routingForms = table("routing_forms", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  teamId: text("team_id"),
  disabled: boolean("disabled").notNull().default(false),
  fields: text("fields").notNull().default("[]"),
  rules: text("rules").notNull().default("[]"),
  fallback: text("fallback"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  ...ownableColumns(),
});

export const routingFormResponses = table("routing_form_responses", {
  id: text("id").primaryKey(),
  formId: text("form_id").notNull(),
  response: text("response").notNull(),
  bookingId: text("booking_id"),
  matchedRuleId: text("matched_rule_id"),
  routedTo: text("routed_to"),
  submitterEmail: text("submitter_email"),
  submitterIp: text("submitter_ip"),
  createdAt: text("created_at").notNull(),
});

export const routingFormShares = createSharesTable("routing_form_shares");
