import { z } from "zod";

export const JOURNEY_STATUSES = ["draft", "active", "paused", "finished"] as const;

export const STEP_TYPES = [
  "send_email",
  "internal_alert",
  "delay",
  "wait_salesforce_sync",
  "branch_filter",
  "branch_token",
  "branch_value",
  "outbound_webhook",
  "add_to_list",
  "remove_from_list",
  "update_value",
  "delete_contacts",
  "add_salesforce_campaign",
  "nested_journey",
] as const;

export const STEP_GROUPS: { group: string; types: { type: string; label: string }[] }[] = [
  { group: "Email", types: [{ type: "send_email", label: "Send email" }, { type: "internal_alert", label: "Send internal email alert" }] },
  { group: "Timing", types: [{ type: "delay", label: "Add delay" }, { type: "wait_salesforce_sync", label: "Wait for Salesforce sync" }] },
  { group: "Branching", types: [{ type: "branch_filter", label: "Branch by filter" }, { type: "branch_token", label: "Branch by token" }, { type: "branch_value", label: "Branch by value" }] },
  { group: "Integrations", types: [{ type: "outbound_webhook", label: "Run outbound webhook" }] },
  { group: "Lists", types: [{ type: "add_to_list", label: "Add to static list" }, { type: "remove_from_list", label: "Remove from static list" }] },
  { group: "Data", types: [{ type: "update_value", label: "Update value" }, { type: "delete_contacts", label: "Delete contacts" }] },
  { group: "Salesforce", types: [{ type: "add_salesforce_campaign", label: "Add to Salesforce campaign" }] },
  { group: "Structure", types: [{ type: "nested_journey", label: "Nested journey" }] },
];

export const nodeSchema = z.object({
  id: z.string(),
  type: z.string(),
  x: z.number(),
  y: z.number(),
  label: z.string().optional(),
  config: z.record(z.string(), z.unknown()).default({}),
});
export const edgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  handle: z.string().optional(),
});
export type JourneyNode = z.infer<typeof nodeSchema>;
export type JourneyEdge = z.infer<typeof edgeSchema>;

export const conditionSchema = z.object({
  id: z.string().optional(),
  type: z.enum(["property", "list", "activity"]),
  field: z.string().optional(),
  op: z.string(),
  value: z.string().optional(),
  count: z.number().optional(),
  days: z.number().optional(),
});
export const filterGroupSchema = z.object({
  logic: z.enum(["and", "or"]).default("and"),
  conditions: z.array(conditionSchema).default([]),
});
export const filterSchema = z.object({
  logic: z.enum(["and", "or"]).default("and"),
  groups: z.array(filterGroupSchema).default([]),
});
export type Filter = z.infer<typeof filterSchema>;
export type Condition = z.infer<typeof conditionSchema>;

export const PROPERTY_FIELDS = [
  { key: "name", label: "Name" },
  { key: "email", label: "Email" },
  { key: "title", label: "Job title" },
  { key: "country", label: "Country" },
  { key: "state", label: "State" },
  { key: "lifecycleStage", label: "Lifecycle stage" },
  { key: "source", label: "Source" },
  { key: "account.name", label: "Account name" },
  { key: "account.industry", label: "Account industry" },
  { key: "account.plan", label: "Account plan" },
  { key: "account.score", label: "Account score" },
] as const;

export const ACTIVITY_EVENTS = [
  { key: "email_opened", label: "Opened an email" },
  { key: "email_clicked", label: "Clicked an email link" },
  { key: "form_submitted", label: "Submitted a form" },
  { key: "page_viewed", label: "Viewed a web page" },
  { key: "pricing_viewed", label: "Viewed the pricing page" },
  { key: "workspace_created", label: "Product event: workspace created" },
  { key: "invited_teammate", label: "Product event: invited a teammate" },
  { key: "qualified_for_journey", label: "Qualified for a journey" },
] as const;

export const TEXT_OPS = ["equal to", "not equal to", "contains", "does not contain", "begins with", "does not begin with", "is known", "is unknown"];
export const NUMBER_OPS = ["equal to", "greater than", "less than"];
export const numericFields = ["account.score"];

export interface JourneyRow { id: string; name: string; status: string; kind: string; goal: string; audienceId: string | null; audienceName: string | null; steps: number; entered: number; exited: number; updatedAt: string }
export interface JourneyFull { id: string; name: string; status: string; kind: string; goal: string; audienceId: string | null; nodes: JourneyNode[]; edges: JourneyEdge[]; settings: Record<string, string>; entered: number; exited: number }
export interface EmailRow { id: string; name: string; subject: string; preheader: string; fromName: string; fromEmail: string; replyTo: string; body: string; kind: string; status: string; trackOpens: number; trackClicks: number; updatedAt: string }
export interface AudienceRow { id: string; name: string; kind: string; size: number; updatedAt: string }
export interface AudienceFull extends AudienceRow { filter: Filter; memberIds: string[]; sample: { id: string; name: string; email: string; title: string }[] }
export interface ContactRowView { id: string; name: string; email: string; title: string; company: string; lifecycleStage: string; source: string; subscribed: boolean; lastActive: string | null }
export interface AccountView { id: string; name: string; domain: string; industry: string; plan: string; owner: string; employees: number; renewalDate: string | null; score: number; tier: string; signals: string[]; contacts: number }
export interface TokenRow { id: string; name: string; kind: string; source: string; fallback: string; rules: { when: string; then: string }[] }
export interface ConversionRow { id: string; name: string; eventType: string; windowDays: number; journeyId: string | null; count: number }
export interface ConnectionRow { id: string; provider: string; category: string; status: string; detail: string; lastSyncAt: string | null }
export interface UserRow { id: string; name: string; email: string; role: string; status: string }
export interface Block { type: "heading" | "text" | "button"; text: string; url?: string }
