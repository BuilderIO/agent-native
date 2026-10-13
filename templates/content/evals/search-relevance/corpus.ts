/**
 * Invented synthetic corpus for the Content search relevance eval. Every
 * document, person, and company below is fictional; none of it describes a
 * real workspace. See README.md in this folder for how the eval that
 * consumes this corpus is run and scored.
 *
 * The corpus models one small SaaS team ("Meridian Analytics", makers of a
 * fictional product called "Meridian Insights") across two Content spaces
 * (`personal` and `org`), plus a separate `outsider` owner used only to
 * build access-control distractors that must never appear in the eval
 * owner's search results.
 */

export const OWNER_EMAIL = "alice@meridian.example";
export const OUTSIDER_EMAIL = "morgan@cobalt-metrics.example";

export const SPACE_IDS = {
  personal: "search-eval-personal-space",
  org: "search-eval-org-space",
  outsider: "search-eval-outsider-space",
} as const;

export type CorpusSpace = keyof typeof SPACE_IDS;

export interface CorpusDocument {
  /** Stable key referenced by cases.ts; never a generated document id. */
  key: string;
  space: CorpusSpace;
  title: string;
  body: string;
  description?: string;
  /** Key of another CorpusDocument this page is nested under. */
  parentKey?: string;
  /** hideFromSearch=1: excluded from query-based search, per documentDiscoveryFilter. */
  hideFromSearch?: boolean;
  /** trashedAt set: excluded from document discovery entirely. */
  trashed?: boolean;
  /** Membership in one of the two Content database collections below. */
  collection?: "blog-posts" | "task-priorities";
}

export const BLOG_POSTS_COLLECTION_KEY = "blog-posts-collection";
export const TASK_PRIORITIES_COLLECTION_KEY = "task-priorities-collection";

/** Stable, deterministic document id derived from a corpus key. */
export function docId(key: string): string {
  return `doc-${key}`;
}

function longBody(
  core: string,
  templates: string[],
  minLength: number,
): string {
  let body = core;
  let cycle = 0;
  while (body.length < minLength) {
    cycle += 1;
    const paragraph = templates[(cycle - 1) % templates.length]!.replace(
      /\{n\}/g,
      String(cycle),
    );
    body += `\n\n## Appendix ${cycle}\n${paragraph}`;
  }
  return body;
}

const incidentPostmortemBody = longBody(
  "On September 2, the checkout service returned 500s for eighteen minutes " +
    "during a deploy of the payments webhook handler. The root cause: a " +
    "retry loop in the new webhook handler resubmitted the same charge " +
    "request to Stripe multiple times. Webhook retries created duplicate " +
    "charges for twenty-three customers before the on-call engineer rolled " +
    "back the deploy. All duplicate charges were refunded within four " +
    "hours, and the retry loop now checks an idempotency key before " +
    "resubmitting a charge.",
  [
    "Timeline detail {n}: the on-call engineer paged in at minute {n} after " +
      "the error-rate alert fired, and confirmed the webhook handler deploy " +
      "as the likely cause within the first few minutes of investigation.",
    "Customer impact note {n}: follow-up call {n} confirmed the refund " +
      "posted correctly and the customer's finance team had no outstanding " +
      "questions about the duplicate charge.",
    "Monitoring gap {n}: the dashboard that would have caught duplicate " +
      "charge volume earlier didn't exist before this incident; it now " +
      "ships as remediation item {n} on the tracker.",
    "Remediation item {n}: add an idempotency key check to retry path {n} " +
      "of the payments webhook handler, owned by the checkout team.",
    "Related ticket {n}: the flaky checkout end-to-end test suite may be " +
      "exercising the same retry loop, tracked separately as follow-up {n}.",
    "On-call note {n}: the runbook step for rolling back a payments deploy " +
      "was out of date; step {n} of the incident response runbook is now " +
      "corrected.",
    "Appendix data {n}: duplicate-charge count reconciliation pass {n} " +
      "matched the twenty-three customers identified during the incident, " +
      "with no additional accounts found in later audits.",
  ],
  28_000,
);

const onboardingGuideBody = longBody(
  "Welcome to engineering. Your laptop will already have Docker and the " +
    "repo cloned before you sit down on day one, so the first afternoon is " +
    "for reading the architecture overview and picking a starter ticket " +
    "labeled good-first-task. Your onboarding buddy walks the SSO " +
    "integration spec and the ADR index past you before the end of week " +
    "one so you know where past decisions live.",
  [
    "Week {n} focus: pair with your onboarding buddy on a real ticket from " +
      "the Task Priorities board instead of a synthetic exercise, so week " +
      "{n} ends with a shipped change.",
    "Tooling note {n}: local development step {n} covers the seed script " +
      "that loads a sample workspace, so you aren't developing against an " +
      "empty dashboard.",
    "On-call shadowing note {n}: new engineers shadow one on-call shift " +
      "around week {n} before joining the rotation themselves.",
    "Reading list item {n}: ADR-{n} style decision records are linked from " +
      "the architecture overview; skim the summaries before the deep dives.",
    "Buddy check-in {n}: a short async check-in around week {n} covers " +
      "questions that came up during the starter ticket.",
    "Access checklist {n}: confirm access item {n} (staging database, " +
      "logs dashboard, incident paging) is provisioned by the end of week " +
      "one.",
  ],
  26_000,
);

const adr009Body = longBody(
  "Decision: Meridian Insights moves its primary datastore from DynamoDB " +
    "to Postgres. Context: single-region DynamoDB tables were silently " +
    "throttling under bursty writes during month-end reporting spikes, and " +
    "there was no good way to run the join-heavy dashboard queries product " +
    "wanted without duplicating data into a second store. Consequences: we " +
    "lose DynamoDB's near-zero-ops scaling story but gain real joins, " +
    "transactions, and an ecosystem the whole team already knows.",
  [
    "Migration phase {n}: dual-write period {n} ran against both stores " +
      "for two weeks before cutover, and phase {n} caught a data model " +
      "assumption that only held true in DynamoDB's item shape.",
    "Cost comparison note {n}: reserved-capacity estimate {n} for the " +
      "equivalent Postgres instance size came in lower than the DynamoDB " +
      "on-demand bill during the same reporting-spike period.",
    "Rollback criterion {n}: if read latency at the ninety-fifth " +
      "percentile regressed past threshold {n} during the migration " +
      "window, the plan was to pause the cutover for that table.",
    "Query pattern {n}: dashboard query {n} that previously required a " +
      "second denormalized DynamoDB table now runs as a single join.",
    "Team note {n}: engineer {n} on the migration flagged that the " +
      "existing Postgres experience across the team reduced onboarding " +
      "time for the new datastore compared to DynamoDB's access patterns.",
  ],
  24_000,
);

const notificationServiceSpecBody = longBody(
  "Spec for the notification service that fans out product events to " +
    "email, in-app, and Slack channels. Each event type has its own " +
    "delivery policy: incident alerts page immediately, weekly digest " +
    "events batch until Monday morning, and comment mentions respect each " +
    "user's quiet hours setting.",
  [
    "Delivery guarantee {n}: channel {n} (email, in-app, or Slack) retries " +
      "up to three times with backoff before an event is marked failed and " +
      "surfaced in the delivery dashboard.",
    "Rate limit note {n}: per-workspace rate limit tier {n} caps digest " +
      "batching to avoid a single noisy workspace starving delivery " +
      "capacity for everyone else.",
    "Event type {n}: event category {n} in the catalog maps to exactly one " +
      "default delivery policy, which a workspace admin can override per " +
      "channel.",
    "Quiet hours note {n}: quiet hours rule {n} only suppresses in-app and " +
      "Slack delivery; incident alerts always page regardless of quiet " +
      "hours configuration.",
    "Appendix metric {n}: delivery success rate sample {n} from the last " +
      "rollout stayed above the ninety-nine percent target across all " +
      "three channels.",
  ],
  22_000,
);

const namedDocuments: CorpusDocument[] = [
  // --- Nested structure parents (org) ---
  {
    key: "meetings-parent",
    space: "org",
    title: "Team meetings",
    body: "An index of team meeting notes.",
  },
  {
    key: "decisions-parent",
    space: "org",
    title: "Decision records",
    body: "An index of architecture and product decision records.",
  },
  {
    key: "retros-parent",
    space: "org",
    title: "Retros & postmortems",
    body: "An index of retros and incident postmortems.",
  },
  {
    key: "onboarding-parent",
    space: "org",
    title: "Onboarding",
    body: "An index of onboarding guides and checklists.",
  },
  {
    key: "personal-notes-parent",
    space: "personal",
    title: "Personal notes",
    body: "A personal space for notes that don't belong in the team workspace.",
  },

  // --- Near-duplicate roadmap titles (org) ---
  {
    key: "q3-roadmap-old",
    space: "org",
    title: "Q3 roadmap (old)",
    body:
      "Early draft of the Q3 plan before the SSO rollout got " +
      "prioritized. This version focused on mobile parity and the " +
      "analytics embed SDK, with enterprise SSO pushed to Q4. Superseded " +
      "by the current Q3 roadmap after the enterprise sales team flagged " +
      "two renewals blocked on SSO.",
  },
  {
    key: "roadmap-review-q3",
    space: "org",
    title: "Roadmap review Q3",
    parentKey: "meetings-parent",
    body:
      "Notes from the roadmap review where product and engineering " +
      "walked through the Q3 roadmap line by line. Sales pushed hard for " +
      "enterprise SSO to move up given two renewals at risk, which is why " +
      "the current roadmap pulls it in ahead of the mobile parity work. " +
      "Design flagged that the dashboard performance budget needs its own " +
      "workstream instead of riding along with the SSO rollout.",
  },
  {
    key: "q3-roadmap",
    space: "org",
    title: "Q3 roadmap",
    body:
      "The current Q3 roadmap: ship enterprise SSO for the top two " +
      "at-risk renewals, hold the line on dashboard load time under two " +
      "seconds, and land the mobile app v1 launch. Pricing tier changes " +
      "are explicitly out of scope for Q3 and move to the Q4 roadmap " +
      "discussion. This replaces the Q3 roadmap (old) draft after the " +
      "roadmap review meeting reordered priorities.",
  },

  // --- Plans (org) ---
  {
    key: "sso-rollout-plan",
    space: "org",
    title: "Enterprise SSO rollout plan",
    body:
      "Rollout plan for enterprise SSO across the two renewal-risk " +
      "accounts first, then the remaining enterprise tier over six weeks. " +
      "Each customer gets a dedicated onboarding call before their SAML " +
      "metadata is activated in production. Rollback plan: disable the " +
      "SSO enforcement flag per workspace without touching any other " +
      "authentication path.",
  },
  {
    key: "mobile-launch-plan",
    space: "org",
    title: "Mobile app launch plan",
    body:
      "Launch plan for the mobile app v1. We are staging the rollout " +
      "at 10 percent for the first 48 hours, then 50 percent for another " +
      "48 hours, then full availability if crash-free sessions stay above " +
      "99.5 percent. Marketing holds the launch announcement until we " +
      "clear the 50 percent stage.",
  },
  {
    key: "data-pipeline-migration-plan",
    space: "org",
    title: "Data pipeline migration plan",
    body:
      "Plan for migrating the nightly data pipeline off the old batch " +
      "scripts and onto the new orchestrated pipeline runner. Cutover " +
      "happens table by table over three weeks, starting with the " +
      "smallest reporting tables so any issues surface before the large " +
      "event tables migrate. Rollback is a config flag that points the " +
      "pipeline runner back at the old scripts per table.",
  },
  {
    key: "customer-onboarding-revamp-plan",
    space: "org",
    title: "Customer onboarding revamp plan",
    body:
      "Plan to revamp customer onboarding so a new workspace shows a " +
      "populated sample dashboard immediately instead of an empty state. " +
      "Rolls out to new signups first, then existing workspaces opt in " +
      "from a banner.",
  },
  {
    key: "api-v2-launch-plan",
    space: "org",
    title: "API v2 launch plan",
    body:
      "Launch plan for API v2, which adds cursor-based pagination and " +
      "the new bulk export endpoints. v1 stays supported for twelve " +
      "months after v2 general availability.",
  },

  // --- Specs (org) ---
  {
    key: "sso-integration-spec",
    space: "org",
    title: "SSO integration spec",
    body:
      "Technical spec for enterprise SSO. We support SAML 2.0 and " +
      "OIDC, with just-in-time provisioning for SAML assertions so a new " +
      "employee at a customer org gets an account on first login instead " +
      "of waiting on a manual invite. Session tokens are scoped per " +
      "workspace and expire after twelve hours regardless of the identity " +
      "provider's own session length.",
  },
  {
    key: "billing-v2-spec",
    space: "org",
    title: "Billing v2 spec",
    body:
      "Spec for billing v2, which moves invoicing off the homegrown " +
      "ledger and onto the new invoicing provider. Every plan change " +
      "generates a proration line item instead of the old approach of " +
      "waiting until the next billing cycle. Dunning emails for failed " +
      "payments now retry three times over nine days before a workspace " +
      "is downgraded.",
  },
  {
    key: "realtime-collab-spec",
    space: "org",
    title: "Real-time collaboration spec",
    body:
      "Spec for real-time collaboration on dashboards. Cursor " +
      "presence and comment threads sync over the existing websocket " +
      "channel used for live data updates, so we don't need a second " +
      "connection per client. Conflict resolution for simultaneous widget " +
      "edits uses last-write-wins at the field level, not a full CRDT, " +
      "since dashboard widgets rarely see true concurrent edits.",
  },
  {
    key: "data-export-api-spec",
    space: "org",
    title: "Data export API spec",
    body:
      "Spec for the bulk data export API. Exports are asynchronous: a " +
      "client requests an export, polls a status endpoint, and downloads " +
      "a signed URL once the export finishes. Large workspaces stream " +
      "export rows in batches of five thousand to avoid a single query " +
      "holding a long-lived transaction open.",
  },
  {
    key: "notification-service-spec",
    space: "org",
    title: "Notification service technical spec",
    body: notificationServiceSpecBody,
  },

  // --- Decision records (org, nested) ---
  {
    key: "adr-009-postgres-over-dynamodb",
    space: "org",
    parentKey: "decisions-parent",
    title: "ADR-009: Adopt Postgres over DynamoDB",
    body: adr009Body,
  },
  {
    key: "adr-014-drop-safari-15",
    space: "org",
    parentKey: "decisions-parent",
    title: "ADR-014: Drop Safari 15 support",
    body:
      "Decision: we are dropping support for Safari 15 starting next " +
      "release. Context: Safari 15 lacks the CSS container query support " +
      "the new dashboard layout depends on, and usage telemetry shows " +
      "Safari 15 is under 0.4% of sessions, almost all on devices that can " +
      "update to Safari 16 for free. Consequences: a small number of " +
      "enterprise customers on managed, unupdatable Mac fleets will see a " +
      "supported-browsers banner instead of the dashboard until IT " +
      "updates their image.",
  },
  {
    key: "adr-005-grpc",
    space: "org",
    parentKey: "decisions-parent",
    title: "ADR-005: Standardize on gRPC for internal services",
    body:
      "Decision: all new internal services talk to each other over " +
      "gRPC instead of ad hoc REST/JSON. Context: three separate teams " +
      "had built three slightly different internal REST conventions, and " +
      "none of them had streaming support for the export pipeline. " +
      "Consequences: a shared proto registry becomes a dependency for " +
      "every new service, which is a small tax worth paying for " +
      "consistent request tracing and typed clients.",
  },
  {
    key: "adr-021-server-driven-ui",
    space: "org",
    parentKey: "decisions-parent",
    title: "ADR-021: Move to server-driven UI for dashboards",
    body:
      "Decision: dashboard widget layout and configuration move " +
      "server-side, with the client rendering from a schema instead of " +
      "owning widget logic. Context: every new widget type required a " +
      "client release, which put widget rollout on the same six-week " +
      "cadence as the mobile app store review. Consequences: the client " +
      "gets simpler over time, but the server now owns a widget schema " +
      "version it has to keep backward compatible.",
  },

  // --- Retros & postmortems (org, nested) ---
  {
    key: "incident-postmortem-checkout",
    space: "org",
    parentKey: "retros-parent",
    title: "Incident postmortem: checkout outage",
    body: incidentPostmortemBody,
  },
  {
    key: "q2-retro",
    space: "org",
    parentKey: "retros-parent",
    title: "Q2 retro: what went well",
    body:
      "Q2 retro. We shipped four times faster than Q1 without adding " +
      "headcount, mostly by cutting the review queue from three approvers " +
      "to one for routine changes. The dashboard performance work landed " +
      "a week early. What we'd change: on-call rotation felt heavier than " +
      "Q1 even though incident count was flat, so Q3 adds a secondary " +
      "on-call shadow rotation.",
  },
  {
    key: "launch-retro-mobile-v1",
    space: "org",
    parentKey: "retros-parent",
    title: "Launch retro: Mobile app v1",
    body:
      "Retro for the mobile app v1 launch. What we learned: staging " +
      "the rollout at 10 percent for the first 48 hours caught a push " +
      "notification crash on older Android devices before it reached the " +
      "full user base, which validated the staged rollout plan from the " +
      "launch plan doc. App store review took nine days instead of the " +
      "two we budgeted, so the next launch plan should pad review time by " +
      "a week.",
  },
  {
    key: "sprint-42-retro",
    space: "org",
    parentKey: "retros-parent",
    title: "Sprint 42 retro",
    body:
      "Sprint 42 retro. Velocity was steady at 34 points. The team " +
      "finally finished the data pipeline migration this sprint after it " +
      "slipped from sprint 40, and the support queue backlog is down to " +
      "eleven tickets. Next sprint focuses on the notification service " +
      "technical spec review.",
  },

  // --- Onboarding (org, nested) ---
  {
    key: "new-engineer-onboarding-guide",
    space: "org",
    parentKey: "onboarding-parent",
    title: "New engineer onboarding guide",
    body: onboardingGuideBody,
  },
  {
    key: "new-hire-it-setup-checklist",
    space: "org",
    parentKey: "onboarding-parent",
    title: "New hire IT setup checklist",
    body:
      "IT setup checklist for new hires: laptop encryption verified, " +
      "SSO enrollment, Slack and email accounts provisioned before day " +
      "one.",
  },
  {
    key: "support-onboarding-runbook",
    space: "org",
    parentKey: "onboarding-parent",
    title: "Support team onboarding runbook",
    body:
      "Onboarding runbook for new support hires: shadow two weeks of " +
      "tickets, learn the support macros, get read access to the incident " +
      "response runbook.",
  },
  {
    key: "sales-onboarding-playbook",
    space: "org",
    parentKey: "onboarding-parent",
    title: "Sales onboarding playbook",
    body:
      "Onboarding playbook for new sales hires: two weeks of product " +
      "training, shadow calls on enterprise SSO renewal accounts, first " +
      "solo call by week three.",
  },
  {
    key: "japanese-onboarding-guide",
    space: "org",
    parentKey: "onboarding-parent",
    title: "オンボーディングガイド",
    body:
      "新入社員向けのオンボーディングガイドです。初日にはノートパソコンにDockerとリポジトリのクローンがすでに用意されています。" +
      "最初の週の終わりまでに、SSO統合仕様とアーキテクチャ決定記録に目を通しておいてください。",
  },

  // --- Meeting notes (org, nested) ---
  {
    key: "weekly-eng-sync-sept-3",
    space: "org",
    parentKey: "meetings-parent",
    title: "Weekly eng sync - Sept 3",
    body:
      "Notes from the September 3 engineering sync: SSO rollout on " +
      "track, checkout postmortem action items assigned, dashboard load " +
      "time work starts next week.",
  },
  {
    key: "product-review-aug-20",
    space: "org",
    parentKey: "meetings-parent",
    title: "Product review meeting notes - Aug 20",
    body:
      "Notes from the August 20 product review: pricing tier changes " +
      "pushed out of Q3, mobile launch plan staged rollout approved.",
  },
  {
    key: "sales-kickoff-q3",
    space: "org",
    parentKey: "meetings-parent",
    title: "Sales kickoff notes Q3",
    body:
      "Notes from the Q3 sales kickoff: enterprise SSO renewal " +
      "accounts are the top priority, new pricing transparency blog post " +
      "ready for prospect conversations.",
  },
  {
    key: "all-hands-september",
    space: "org",
    parentKey: "meetings-parent",
    title: "All-hands notes September",
    body:
      "Notes from the September all-hands: checkout outage " +
      "postmortem shared company-wide, Q2 retro highlights, new hires " +
      "from the Q3 hiring plan starting in October.",
  },
  {
    key: "customer-advisory-board-notes",
    space: "org",
    parentKey: "meetings-parent",
    title: "Customer advisory board notes",
    body:
      "Notes from the customer advisory board: three customers asked " +
      "about audit log export, one asked about the Safari 15 deprecation " +
      "timeline.",
  },
  {
    key: "design-crit-navigation-redesign",
    space: "org",
    parentKey: "meetings-parent",
    title: "Design crit notes - navigation redesign",
    body:
      "Design crit notes on the navigation redesign: consensus to " +
      "ship the collapsed sidebar variant, revisit the command palette " +
      "after the dashboard editor ships.",
  },
  {
    key: "weekly-eng-sync-sept-10",
    space: "org",
    parentKey: "meetings-parent",
    title: "Weekly eng sync - Sept 10",
    body:
      "Notes from the September 10 engineering sync: SSO rollout hit " +
      "its first renewal account, data pipeline migration plan cutover " +
      "starts next week.",
  },
  {
    key: "support-team-sync-notes",
    space: "org",
    parentKey: "meetings-parent",
    title: "Support team sync notes",
    body:
      "Notes from the support team sync: backlog of support-labeled " +
      "bugs discussed, on-call escalation policy reviewed after last " +
      "month's paging spike.",
  },
  {
    key: "spanish-sales-meeting-notes",
    space: "org",
    parentKey: "meetings-parent",
    title: "Resumen de la reunión de ventas Q3",
    body:
      "Resumen de la reunión de ventas del tercer trimestre. " +
      "Cerramos la negociación con el cliente más grande del trimestre " +
      "después de comprometernos a un plan de implementación de inicio de " +
      "sesión único antes de fin de año. El equipo de ventas también " +
      "señaló dos renovaciones en riesgo que dependen del mismo trabajo " +
      "de SSO empresarial.",
  },

  // --- Other non-English (org) ---
  {
    key: "spanish-refund-policy",
    space: "org",
    title: "Política de reembolsos para clientes empresariales",
    body:
      "Política de reembolsos para clientes empresariales. Los " +
      "reembolsos por cargos duplicados, como los del incidente de pago " +
      "del 2 de septiembre, se procesan en un plazo de cuatro horas " +
      "hábiles. Los reembolsos por cancelación de plan siguen la política " +
      "estándar de prorrateo descrita en la especificación de facturación " +
      "v2.",
  },
  {
    key: "japanese-roadmap-overview",
    space: "org",
    title: "第3四半期ロードマップ概要",
    body:
      "第3四半期のロードマップの概要です。エンタープライズ向けシングルサインオンの提供、" +
      "ダッシュボードの読み込み時間を2秒未満に維持すること、モバイルアプリv1の提供を優先します。" +
      "価格帯の変更は第3四半期の対象外です。",
  },

  // --- Standalone process docs (org) ---
  {
    key: "oncall-rotation-q3",
    space: "org",
    title: "On-call rotation schedule Q3",
    body:
      "The Q3 on-call rotation. Primary on-call rotates weekly across " +
      "six engineers, with a secondary shadow rotation added this quarter " +
      "after the Q2 retro flagged on-call load. Escalation to the " +
      "incident commander happens automatically if a page isn't " +
      "acknowledged within five minutes.",
  },
  {
    key: "hiring-plan-q3",
    space: "org",
    title: "People plan: Q3 hiring roadmap",
    body:
      "The Q3 hiring plan. Engineering adds three roles: a senior " +
      "backend engineer for the billing v2 work, a data engineer for the " +
      "pipeline migration, and a support engineer to handle the growing " +
      "enterprise queue. Sales adds one account executive focused on the " +
      "enterprise SSO renewal accounts.",
  },

  // --- Blog posts collection (org) ---
  {
    key: BLOG_POSTS_COLLECTION_KEY,
    space: "org",
    title: "Blog posts",
    body: "Published and drafted posts for the Meridian Insights blog.",
  },
  {
    key: "pricing-blog",
    space: "org",
    parentKey: BLOG_POSTS_COLLECTION_KEY,
    collection: "blog-posts",
    title: "Pricing transparency: how we think about tiers",
    body:
      "A blog post about how we think about pricing tiers. We " +
      "publish our tier limits instead of hiding them behind a " +
      '"contact sales" wall, because prospective customers evaluating an ' +
      "analytics tool want to know what a workspace actually costs before " +
      "they invest a week wiring up integrations. Pricing tiers scale " +
      "with monthly tracked events, not seats, because teams told us " +
      "seat-based pricing punished them for inviting more people to look " +
      "at the same dashboards.",
  },
  {
    key: "postgres-analytics-blog",
    space: "org",
    parentKey: BLOG_POSTS_COLLECTION_KEY,
    collection: "blog-posts",
    title: "Why we chose Postgres for analytics workloads",
    body:
      "A blog post on choosing Postgres for analytics. The deciding " +
      "factor was being able to run join-heavy dashboard queries directly " +
      "against the primary store instead of maintaining a second copy of " +
      "the data in a warehouse just for reporting. Partitioning by month " +
      "keeps the hot tables small enough that most dashboard queries hit " +
      "an index instead of a sequential scan.",
  },
  {
    key: "realtime-collab-blog",
    space: "org",
    parentKey: BLOG_POSTS_COLLECTION_KEY,
    collection: "blog-posts",
    title: "Building a real-time collaboration engine",
    body:
      "A blog post on building live collaboration into dashboards. " +
      "Early prototypes used full CRDTs for every widget field, but " +
      "operational transforms gave way to CRDTs only after we realized " +
      "most conflicts were on text fields, not structured widget config, " +
      "and OT was simpler to reason about for structured fields. " +
      "Presence indicators turned out to matter more to users than " +
      "perfect conflict resolution.",
  },
  {
    key: "scaling-pipeline-blog",
    space: "org",
    parentKey: BLOG_POSTS_COLLECTION_KEY,
    collection: "blog-posts",
    title: "5 lessons from scaling our data pipeline",
    body:
      "A blog post on lessons from scaling the data pipeline past a " +
      "billion rows a day, including why we moved partitioning decisions " +
      "earlier instead of retrofitting them after a slow query incident.",
  },
  {
    key: "insights-2-blog",
    space: "org",
    parentKey: BLOG_POSTS_COLLECTION_KEY,
    collection: "blog-posts",
    title: "Introducing Meridian Insights 2.0",
    body:
      "A blog post announcing Meridian Insights 2.0, with a " +
      "redesigned dashboard editor and the new real-time collaboration " +
      "engine.",
  },
  {
    key: "onboarding-redesign-blog",
    space: "org",
    parentKey: BLOG_POSTS_COLLECTION_KEY,
    collection: "blog-posts",
    title: "How we redesigned onboarding to cut time-to-value in half",
    body:
      "A blog post on redesigning first-run onboarding so a new " +
      "workspace shows a populated sample dashboard immediately instead " +
      "of an empty state, cutting time-to-first-dashboard in half.",
  },
  {
    key: "dashboard-sprawl-blog",
    space: "org",
    parentKey: BLOG_POSTS_COLLECTION_KEY,
    collection: "blog-posts",
    title: "The hidden cost of dashboard sprawl",
    body:
      "A blog post arguing that dashboard sprawl, not dashboard " +
      "scarcity, is the more common failure mode, and how workspace-level " +
      "dashboard audits catch it.",
  },
  {
    key: "oncall-philosophy-blog",
    space: "org",
    parentKey: BLOG_POSTS_COLLECTION_KEY,
    collection: "blog-posts",
    title: "Our approach to on-call and incident response",
    body:
      "A blog post on the on-call philosophy: small rotations, a " +
      "written incident commander checklist, and blameless postmortems " +
      "published internally within 48 hours.",
  },
  {
    key: "dynamodb-migration-blog",
    space: "org",
    parentKey: BLOG_POSTS_COLLECTION_KEY,
    collection: "blog-posts",
    title: "What we learned migrating off DynamoDB",
    body:
      "A blog post recapping the DynamoDB to Postgres migration from " +
      "ADR-009, including the six-week dual-write period that caught two " +
      "data model assumptions before cutover.",
  },
  {
    key: "safari-15-blog",
    space: "org",
    parentKey: BLOG_POSTS_COLLECTION_KEY,
    collection: "blog-posts",
    title: "Why Safari 15 support finally had to go",
    body:
      "A blog post explaining the Safari 15 deprecation decision from " +
      "ADR-014 in customer-facing language.",
  },

  // --- Task Priorities collection (org) ---
  {
    key: TASK_PRIORITIES_COLLECTION_KEY,
    space: "org",
    title: "Task Priorities",
    body:
      "The current working projection of engineering task " +
      "priorities, kept in priority order and reviewed every Monday.",
  },
  {
    key: "task-fix-flaky-checkout-tests",
    space: "org",
    parentKey: TASK_PRIORITIES_COLLECTION_KEY,
    collection: "task-priorities",
    title: "Fix flaky checkout test suite",
    body:
      "The checkout end-to-end suite fails intermittently on the " +
      "webhook retry test; likely related to the same retry loop from " +
      "the checkout outage postmortem.",
  },
  {
    key: "task-ship-sso-enterprise",
    space: "org",
    parentKey: TASK_PRIORITIES_COLLECTION_KEY,
    collection: "task-priorities",
    title: "Ship SSO for enterprise tier",
    body:
      "Blocked on the two renewal accounts finishing their SAML " +
      "metadata exchange from the SSO rollout plan.",
  },
  {
    key: "task-reduce-dashboard-load-time",
    space: "org",
    parentKey: TASK_PRIORITIES_COLLECTION_KEY,
    collection: "task-priorities",
    title: "Reduce dashboard load time under 2s",
    body:
      "Query planner work plus the new partitioning from the " +
      "Postgres migration should get us most of the way there.",
  },
  {
    key: "task-migrate-billing-provider",
    space: "org",
    parentKey: TASK_PRIORITIES_COLLECTION_KEY,
    collection: "task-priorities",
    title: "Migrate billing to new invoicing provider",
    body:
      "Tracks the billing v2 spec cutover; proration line items are " +
      "the remaining risk.",
  },
  {
    key: "task-resolve-push-notification-bug",
    space: "org",
    parentKey: TASK_PRIORITIES_COLLECTION_KEY,
    collection: "task-priorities",
    title: "Resolve mobile push notification bug",
    body:
      "The Android crash caught during the staged mobile launch " +
      "rollout needs a permanent fix, not just the rollback.",
  },
  {
    key: "task-localize-onboarding-spanish",
    space: "org",
    parentKey: TASK_PRIORITIES_COLLECTION_KEY,
    collection: "task-priorities",
    title: "Localize onboarding flow for Spanish market",
    body:
      "Pairs with the Spanish sales meeting notes; first market " +
      "request came from the deal that closed this quarter.",
  },
  {
    key: "task-rate-limit-export-api",
    space: "org",
    parentKey: TASK_PRIORITIES_COLLECTION_KEY,
    collection: "task-priorities",
    title: "Add rate limiting to export API",
    body:
      "Follow-up from the data export API spec review; large " +
      "workspaces can currently request unlimited concurrent exports.",
  },
  {
    key: "task-clean-up-feature-flags",
    space: "org",
    parentKey: TASK_PRIORITIES_COLLECTION_KEY,
    collection: "task-priorities",
    title: "Clean up stale feature flags",
    body:
      "Feature flag naming conventions doc flagged over forty flags " +
      "with no owner.",
  },
  {
    key: "task-improve-query-planner",
    space: "org",
    parentKey: TASK_PRIORITIES_COLLECTION_KEY,
    collection: "task-priorities",
    title: "Improve query planner for large workspaces",
    body:
      "Same root cause as the dashboard load time work but scoped to " +
      "workspaces over ten million rows.",
  },
  {
    key: "task-draft-q4-roadmap",
    space: "org",
    parentKey: TASK_PRIORITIES_COLLECTION_KEY,
    collection: "task-priorities",
    title: "Draft Q4 roadmap outline",
    body: "Kickoff for Q4 planning once the Q3 roadmap items close out.",
  },
  {
    key: "task-automate-changelog",
    space: "org",
    parentKey: TASK_PRIORITIES_COLLECTION_KEY,
    collection: "task-priorities",
    title: "Automate changelog generation",
    body:
      "Release notes v3.4 and v3.5 were both written by hand; this " +
      "should generate a draft from merged PR titles.",
  },
  {
    key: "task-reduce-cold-start",
    space: "org",
    parentKey: TASK_PRIORITIES_COLLECTION_KEY,
    collection: "task-priorities",
    title: "Reduce cold start time for edge functions",
    body:
      "Notification service delivery latency spikes correlate with " +
      "cold starts on the edge runtime.",
  },
  {
    key: "task-add-audit-log-export",
    space: "org",
    parentKey: TASK_PRIORITIES_COLLECTION_KEY,
    collection: "task-priorities",
    title: "Add audit log export",
    body:
      "Enterprise security questionnaire responses committed to this " +
      "for the next renewal cycle.",
  },
  {
    key: "task-triage-support-backlog",
    space: "org",
    parentKey: TASK_PRIORITIES_COLLECTION_KEY,
    collection: "task-priorities",
    title: "Triage backlog of support-labeled bugs",
    body:
      "Support macros cleanup surfaced a backlog of bugs tagged " +
      "support that never got engineering triage.",
  },
  {
    key: "task-write-search-relevance-eval",
    space: "org",
    parentKey: TASK_PRIORITIES_COLLECTION_KEY,
    collection: "task-priorities",
    title: "Write search relevance eval",
    body:
      "A deterministic eval for judging document search quality " +
      "before the search engine gets replaced.",
  },

  // --- Personal space ---
  {
    key: "personal-garden-tracker-notes",
    space: "personal",
    parentKey: "personal-notes-parent",
    title: "Side project: garden tracker app notes",
    body:
      "Notes for a personal side project tracking watering schedules " +
      "for a small vegetable garden; thinking about a simple SMS reminder " +
      "instead of another app to check.",
  },
  {
    key: "personal-reading-list-q3",
    space: "personal",
    parentKey: "personal-notes-parent",
    title: "Personal reading list Q3",
    body:
      "Currently reading Thinking in Systems and a stack of papers on " +
      "CRDTs after the real-time collaboration engine work sparked the " +
      "interest.",
  },
  {
    key: "personal-1-1-template",
    space: "personal",
    parentKey: "personal-notes-parent",
    title: "1:1 notes template",
    body:
      "A personal template for 1:1s: wins since last time, blockers, " +
      "and one thing to stop doing.",
  },
  {
    key: "personal-career-growth-notes",
    space: "personal",
    parentKey: "personal-notes-parent",
    title: "Career growth notes",
    body:
      "Notes ahead of the next career conversation: wants more " +
      "ownership of the query planner work, less time in support " +
      "escalations.",
  },
  {
    key: "personal-conference-talk-ideas",
    space: "personal",
    parentKey: "personal-notes-parent",
    title: "Conference talk ideas: data infra track",
    body:
      "Draft talk ideas: the DynamoDB to Postgres migration story, or " +
      "the staged mobile rollout story.",
  },
  {
    key: "personal-home-lab-plan",
    space: "personal",
    parentKey: "personal-notes-parent",
    title: "Home lab automation project plan",
    body:
      "Plan for a small home automation project: a Raspberry Pi " +
      "reading the garden soil sensor into a personal dashboard, mostly " +
      "as an excuse to try the new dashboard editor at home.",
  },
  {
    key: "personal-finance-tracker-spec",
    space: "personal",
    parentKey: "personal-notes-parent",
    title: "Personal finance tracker spec",
    body:
      "A personal spec for a finance tracker spreadsheet " +
      "replacement, mostly because the current spreadsheet's formulas " +
      "broke twice this year.",
  },
  {
    key: "personal-recipe-box",
    space: "personal",
    parentKey: "personal-notes-parent",
    title: "Recipe box: weeknight dinners",
    body:
      "A running list of weeknight dinners that survive a toddler's " +
      "opinions: sheet-pan chicken, one specific lentil soup, and a lot " +
      "of pasta.",
  },
  {
    key: "personal-book-notes-thinking-in-systems",
    space: "personal",
    parentKey: "personal-notes-parent",
    title: "Book notes: Thinking in Systems",
    body:
      "Notes from Thinking in Systems, mostly about how feedback " +
      "loops in the book map uncomfortably well onto the on-call " +
      "escalation policy.",
  },
  {
    key: "personal-travel-plan-denver",
    space: "personal",
    parentKey: "personal-notes-parent",
    title: "Travel plan: conference trip to Denver",
    body:
      "Travel plan for a conference trip to Denver in October, " +
      "flight booked, still need a hotel near the convention center.",
  },
  {
    key: "personal-retro-first-year",
    space: "personal",
    parentKey: "personal-notes-parent",
    title: "Personal retro: first year at Meridian",
    body:
      "A personal retro on the first year: shipped the Postgres " +
      "migration, learned more about incident response than expected, " +
      "want to do a conference talk next year.",
  },
  {
    key: "personal-blog-pitch-draft",
    space: "personal",
    parentKey: "personal-notes-parent",
    title: "Draft: blog post pitch for personal site",
    body:
      "A draft pitch for a personal blog post about debugging the " +
      "checkout webhook retry bug, separate from the internal postmortem.",
  },
  {
    key: "personal-running-log-q3",
    space: "personal",
    parentKey: "personal-notes-parent",
    title: "Running training log Q3",
    body:
      "Training log for a Q3 half marathon plan, currently on week " +
      "six of the sixteen-week plan.",
  },
  {
    key: "personal-apartment-hunting-notes",
    space: "personal",
    parentKey: "personal-notes-parent",
    title: "Apartment hunting notes",
    body:
      "Notes comparing three apartments, mostly about commute time " +
      "to the office on the two days a week that matter.",
  },
  {
    key: "personal-japanese-language-log",
    space: "personal",
    parentKey: "personal-notes-parent",
    title: "Language learning log: Japanese",
    body:
      "A personal log for Japanese study, currently on lesson twelve " +
      "of a beginner course, motivated partly by the Tokyo office trip " +
      "next year.",
  },
];

const FILLER_STATUSES = [
  "In progress",
  "Needs review",
  "Blocked on legal",
  "Shipped",
  "On hold",
  "Planned for next quarter",
];
const FILLER_OWNERS = [
  "Priya",
  "Dev",
  "Sam",
  "Noor",
  "Chris",
  "Lena",
  "Marcus",
  "Ava",
];

function fillerBody(topic: string, index: number): string {
  const status = FILLER_STATUSES[index % FILLER_STATUSES.length];
  const owner = FILLER_OWNERS[index % FILLER_OWNERS.length];
  return `${topic} Status: ${status}. Owner: ${owner}.`;
}

const ORG_FILLER_TOPICS: Array<[string, string]> = [
  [
    "design-system-component-audit",
    "Design system component audit. Cataloged every button and input " +
      "variant currently in use to find which ones can merge into one.",
  ],
  [
    "brand-refresh-moodboard-notes",
    "Brand refresh moodboard notes. Collected reference marks and type " +
      "pairings for the upcoming brand refresh kickoff.",
  ],
  [
    "support-macros-refund-requests",
    "Support macros: refund requests. Standard replies for the most " +
      "common refund request patterns support sees.",
  ],
  [
    "support-macros-login-issues",
    "Support macros: login issues. Standard replies for SSO and password " +
      "reset login issues.",
  ],
  [
    "customer-health-score-methodology",
    "Customer health score methodology. Defines the weighted usage, " +
      "support ticket volume, and renewal signals that feed the health " +
      "score.",
  ],
  [
    "renewal-playbook-enterprise",
    "Renewal playbook: enterprise accounts. Steps for the ninety-day " +
      "renewal runway on enterprise tier accounts.",
  ],
  [
    "competitive-positioning-legacybi",
    "Competitive positioning: vs LegacyBI. Talking points for deals " +
      "where LegacyBI is the incumbent tool.",
  ],
  [
    "expense-policy-update-sept-2026",
    "Expense policy update Sept 2026. Raises the conference travel cap " +
      "and clarifies the home office stipend.",
  ],
  [
    "parental-leave-policy",
    "Parental leave policy. Sixteen weeks paid leave for all new " +
      "parents regardless of tenure.",
  ],
  [
    "recruiting-funnel-review-aug",
    "Recruiting funnel review Aug. Offer-to-accept rate held steady; " +
      "sourcing pipeline for the support engineer role is thin.",
  ],
  [
    "intern-program-structure",
    "Intern program structure. Twelve-week summer program with a demo " +
      "day in the final week.",
  ],
  [
    "data-processing-addendum-template",
    "Data processing addendum template. Standard DPA language for " +
      "enterprise contracts in regulated industries.",
  ],
  [
    "soc-2-audit-prep-checklist",
    "SOC 2 audit prep checklist. Evidence collection tasks ahead of the " +
      "annual SOC 2 Type II audit.",
  ],
  [
    "vendor-review-observability-tools",
    "Vendor review: observability tools. Comparing the current logging " +
      "vendor against two alternatives on cost and retention.",
  ],
  [
    "incident-response-runbook",
    "Incident response runbook. Steps for declaring an incident, naming " +
      "an incident commander, and running the retro afterward.",
  ],
  [
    "on-call-escalation-policy",
    "On-call escalation policy. A page not acknowledged in five minutes " +
      "escalates automatically to the secondary on-call.",
  ],
  [
    "feature-flag-naming-conventions",
    "Feature flag naming conventions. Flags are named by team prefix and " +
      "must have an owner and a removal date.",
  ],
  [
    "api-rate-limit-tiers",
    "API rate limit tiers. Rate limits scale with plan tier, with a " +
      "burst allowance for the top two tiers.",
  ],
  [
    "customer-advisory-board-charter",
    "Customer advisory board charter. Meets quarterly with eight rotating " +
      "customer representatives.",
  ],
  [
    "localization-roadmap",
    "Localization roadmap. Spanish and Japanese are the first two " +
      "languages after the onboarding flow work.",
  ],
  [
    "accessibility-audit-findings",
    "Accessibility audit findings. Dashboard color contrast and keyboard " +
      "navigation gaps found during the Q2 audit.",
  ],
  [
    "dashboard-performance-budget",
    "Dashboard performance budget. Sets a load time budget per widget " +
      "type so no single widget can blow the two-second target.",
  ],
  [
    "query-planner-benchmark-results",
    "Query planner benchmark results. Comparing planner behavior before " +
      "and after the partitioning change on the largest workspaces.",
  ],
  [
    "postgres-upgrade-plan-v16",
    "Postgres upgrade plan (v16). Staged upgrade across read replicas " +
      "before the primary, with a maintenance window booked for the " +
      "cutover.",
  ],
  [
    "data-warehouse-cost-review",
    "Data warehouse cost review. Storage costs for the reporting warehouse " +
      "grew faster than usage this quarter; investigating stale tables.",
  ],
  [
    "marketing-site-redesign-brief",
    "Marketing site redesign brief. New homepage should lead with the " +
      "pricing transparency story instead of a generic feature grid.",
  ],
  [
    "seo-audit-notes",
    "SEO audit notes. Blog post metadata is inconsistent across the last " +
      "two years of posts.",
  ],
  [
    "content-calendar-q4",
    "Content calendar Q4. Two blog posts a month, alternating between " +
      "engineering deep dives and customer stories.",
  ],
  [
    "release-notes-v3-4",
    "Release notes: v3.4. Adds the bulk export API and fixes a timezone " +
      "bug in the weekly digest email.",
  ],
  [
    "release-notes-v3-5",
    "Release notes: v3.5. Ships the redesigned dashboard editor and the " +
      "real-time collaboration engine.",
  ],
];

const orgFillerDocuments: CorpusDocument[] = ORG_FILLER_TOPICS.map(
  ([key, topic], index) => ({
    key: `filler-org-${key}`,
    space: "org",
    title: topic.split(".")[0]!,
    body: fillerBody(topic, index),
  }),
);

const OUTSIDER_FILLER_TOPICS: Array<[string, string]> = [
  [
    "cobalt-brand-guidelines",
    "Cobalt Metrics brand guidelines. Logo usage and color palette for " +
      "external decks.",
  ],
  [
    "weekly-growth-metrics-review",
    "Weekly growth metrics review. Signup conversion held flat week over " +
      "week.",
  ],
  [
    "series-b-deck-outline",
    "Series B fundraising deck outline. Ten slides covering traction, " +
      "team, and market size.",
  ],
  [
    "customer-churn-analysis-march",
    "Customer churn analysis March. Churn concentrated in the smallest " +
      "plan tier.",
  ],
  [
    "vendor-security-questionnaire",
    "Vendor security questionnaire. Responses for a prospective " +
      "customer's security review.",
  ],
  [
    "q2-marketing-calendar",
    "Q2 marketing calendar. Webinar cadence and paid campaign schedule.",
  ],
  [
    "office-relocation-faq",
    "Office relocation FAQ. New address, parking, and moving timeline.",
  ],
  [
    "competitive-landscape-notes",
    "Competitive landscape notes. Tracking three direct competitors' " +
      "pricing pages.",
  ],
  [
    "partner-integration-checklist",
    "Partner integration checklist. Steps for onboarding a new " +
      "integration partner.",
  ],
  [
    "sales-commission-plan-2026",
    "Sales commission plan 2026. Accelerators kick in above 100 percent " +
      "of quota.",
  ],
  [
    "data-retention-policy-draft",
    "Data retention policy draft. Proposes a two-year retention window " +
      "for raw event data.",
  ],
  [
    "api-rate-limit-increase-request",
    "API rate limit increase request. A large customer asked for a " +
      "higher burst allowance.",
  ],
  [
    "customer-success-playbook",
    "Customer success playbook. Quarterly business review template for " +
      "top accounts.",
  ],
  [
    "renewal-pipeline-review",
    "Renewal pipeline review. Three accounts flagged as at-risk this " +
      "quarter.",
  ],
  [
    "hiring-plan-q4-engineering",
    "Hiring plan: Q4 engineering. Two backend roles and one platform " +
      "role.",
  ],
  [
    "legal-msa-template-redline",
    "Legal: MSA template redline. Updated liability cap language.",
  ],
  [
    "it-asset-inventory",
    "IT asset inventory. Laptop refresh cycle and asset tagging process.",
  ],
  [
    "trust-center-content-draft",
    "Trust center content draft. Public-facing security and compliance " +
      "summary page.",
  ],
];

const outsiderFillerDocuments: CorpusDocument[] = OUTSIDER_FILLER_TOPICS.map(
  ([key, topic], index) => ({
    key: `filler-outsider-${key}`,
    space: "outsider",
    title: topic.split(".")[0]!,
    body: fillerBody(topic, index),
  }),
);

// Deliberate title/content collisions with real Meridian docs, owned by the
// outsider. These exist purely to prove access control, not textual
// relevance, keeps a same-named or same-topic distractor out of results.
const outsiderCollisionDocuments: CorpusDocument[] = [
  {
    key: "outsider-q3-roadmap",
    space: "outsider",
    title: "Q3 roadmap",
    body:
      "Cobalt Metrics Q3 roadmap priorities: ship the new pricing " +
      "page and finish the churn analysis follow-up work.",
  },
  {
    key: "outsider-sso-integration-spec",
    space: "outsider",
    title: "SSO integration spec",
    body:
      "Cobalt Metrics SSO integration rollout spec for their own " +
      "enterprise tier, unrelated to any other company's identity " +
      "provider work.",
  },
];

const hiddenFillerDocuments: CorpusDocument[] = [
  {
    key: "hidden-notes-to-self",
    space: "org",
    title: "Draft: notes to self",
    hideFromSearch: true,
    body:
      "Scratch notes, not meant to be findable: remember to follow " +
      "up on the SSO renewal call and book the dentist.",
  },
  {
    key: "hidden-pricing-experiment-ideas",
    space: "org",
    title: "Old draft: pricing experiment ideas",
    hideFromSearch: true,
    body:
      "Abandoned pricing experiment ideas from last year, kept for " +
      "reference but intentionally hidden from search.",
  },
  {
    key: "hidden-rebrand-exploration",
    space: "org",
    title: "WIP: rebrand exploration",
    hideFromSearch: true,
    body:
      "Very early rebrand exploration, not ready to be found by " +
      "anyone browsing search.",
  },
  {
    key: "hidden-interview-question-bank",
    space: "org",
    title: "Personal draft: interview questions bank",
    hideFromSearch: true,
    body:
      "A private bank of interview questions, hidden so candidates " +
      "researching the company can't stumble onto it.",
  },
  {
    key: "hidden-2025-planning-archive",
    space: "org",
    title: "Archive: 2025 planning doc",
    hideFromSearch: true,
    body:
      "Archived 2025 planning notes kept for history but hidden from " +
      "everyday search.",
  },
  {
    key: "hidden-partnership-talking-points",
    space: "org",
    title: "Draft: partnership talking points",
    hideFromSearch: true,
    body:
      "Unfinished partnership talking points, still being reviewed by " +
      "legal.",
  },
  {
    key: "hidden-support-macros-cleanup",
    space: "org",
    title: "WIP: support macros cleanup",
    hideFromSearch: true,
    body: "Work in progress cleanup of duplicate support macros.",
  },
  {
    key: "hidden-town-hall-talking-points",
    space: "org",
    title: "Draft: town hall talking points",
    hideFromSearch: true,
    body: "Draft talking points for the next town hall, not final yet.",
  },
  {
    key: "hidden-compensation-bands",
    space: "org",
    title: "Confidential: 2026 compensation bands",
    hideFromSearch: true,
    body:
      "Confidential compensation bands for every leveling track in " +
      "2026, deliberately hidden from search results for everyone.",
  },
  {
    key: "hidden-layoffs-contingency-plan",
    space: "org",
    title: "Draft: layoffs contingency plan",
    hideFromSearch: true,
    body:
      "A layoffs contingency plan headcount scenario document, kept " +
      "hidden from search while it remains a draft.",
  },
];

const trashedFillerDocuments: CorpusDocument[] = [
  {
    key: "trashed-old-q1-roadmap",
    space: "org",
    title: "Old Q1 roadmap (trashed)",
    trashed: true,
    body: "The old Q1 roadmap, moved to Trash once Q1 closed out.",
  },
  {
    key: "trashed-deprecated-auth-spec",
    space: "org",
    title: "Deprecated auth spec",
    trashed: true,
    body:
      "The deprecated authentication spec from before the SSO work, " +
      "moved to Trash.",
  },
  {
    key: "trashed-old-onboarding-doc",
    space: "org",
    title: "Old onboarding doc (pre-2025)",
    trashed: true,
    body:
      "The old onboarding doc from before the current guide, moved to " +
      "Trash.",
  },
  {
    key: "trashed-merger-notes",
    space: "org",
    title: "Draft merger notes (abandoned)",
    trashed: true,
    body:
      "Abandoned merger exploration notes, moved to Trash after the " +
      "conversation ended.",
  },
  {
    key: "trashed-old-brand-guidelines",
    space: "org",
    title: "Old brand guidelines v1",
    trashed: true,
    body:
      "The first version of the brand guidelines, moved to Trash " +
      "after the refresh.",
  },
  {
    key: "trashed-eu-expansion-plan",
    space: "org",
    title: "Cancelled: EU expansion plan",
    trashed: true,
    body: "A cancelled plan for EU expansion, moved to Trash.",
  },
  {
    key: "trashed-old-support-macros",
    space: "org",
    title: "Old support macros",
    trashed: true,
    body:
      "Old support macros replaced by the current set, moved to " + "Trash.",
  },
  {
    key: "trashed-legacy-crm-export-notes",
    space: "org",
    title: "Archived: legacy CRM export notes",
    trashed: true,
    body:
      "Notes on exporting data from the legacy CRM, moved to Trash " +
      "after the migration finished.",
  },
  {
    key: "trashed-old-pricing-page-copy",
    space: "org",
    title: "Old pricing page copy",
    trashed: true,
    body:
      "The old pricing page copy, moved to Trash after the pricing " +
      "transparency redesign.",
  },
  {
    key: "trashed-legacy-billing-spec",
    space: "org",
    title: "Deprecated: legacy billing spec",
    trashed: true,
    body:
      "Legacy billing migration steps from the homegrown ledger, " +
      "moved to Trash once billing v2 shipped.",
  },
];

export const corpusDocuments: CorpusDocument[] = [
  ...namedDocuments,
  ...orgFillerDocuments,
  ...outsiderFillerDocuments,
  ...outsiderCollisionDocuments,
  ...hiddenFillerDocuments,
  ...trashedFillerDocuments,
];
