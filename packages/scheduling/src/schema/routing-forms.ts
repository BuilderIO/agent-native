/**
 * Routing forms — ChiliPiper-style pre-booking forms that route prospects to
 * the right event type based on their answers.
 *
 * A form has fields (text/select/multi), rules (match conditions → action),
 * and a fallback. Public form URL is `/forms/:formId`; on submit we evaluate
 * rules in order and either redirect to an event-type booker, open an
 * external URL, or show a custom message.
 */
import {
  table,
  text,
  integer,
  ownableColumns,
  createSharesTable,
} from "@agent-native/core/db/schema";

export const routingForms = table("routing_forms", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  teamId: text("team_id"),
  disabled: integer("disabled", { mode: "boolean" }).notNull().default(false),
  /** JSON array of RoutingFormField */
  fields: text("fields").notNull().default("[]"),
  /** JSON array of RoutingFormRule */
  rules: text("rules").notNull().default("[]"),
  /** JSON RoutingFormRule action object for when no rules match */
  fallback: text("fallback"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  ...ownableColumns(),
});

export const routingFormResponses = table("routing_form_responses", {
  id: text("id").primaryKey(),
  formId: text("form_id").notNull(),
  /** JSON object of fieldId → value */
  response: text("response").notNull(),
  /** Booking id if the response resulted in a booking */
  bookingId: text("booking_id"),
  /** Which rule matched (null if fallback) */
  matchedRuleId: text("matched_rule_id"),
  /** Resulting action description for quick filtering */
  routedTo: text("routed_to"),
  /** Submitter context */
  submitterEmail: text("submitter_email"),
  submitterIp: text("submitter_ip"),
  createdAt: text("created_at").notNull(),
});

export const routingFormShares = createSharesTable("routing_form_shares");
