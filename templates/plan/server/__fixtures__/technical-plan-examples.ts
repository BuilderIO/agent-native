import type { Plan, PlanBundle, PlanSection } from "../../shared/types.js";

const TIMESTAMP = "2026-01-01T00:00:00.000Z";

function plan(overrides: Partial<Plan>): Plan {
  return {
    id: "technical_plan_1",
    title: "Technical plan",
    brief: "Exercise technical plan rendering.",
    status: "review",
    source: "codex",
    repoPath: "/Users/steve/Projects/builder/agent-native/framework",
    currentFocus: null,
    html: null,
    markdown: null,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    approvedAt: null,
    ...overrides,
  };
}

function section(
  id: string,
  type: PlanSection["type"],
  title: string,
  body: string,
  html: string | null = null,
): PlanSection {
  return {
    id,
    planId: "technical_plan_1",
    type,
    title,
    body,
    html,
    order: 0,
    createdBy: "agent",
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  };
}

function bundle(input: {
  plan: Plan;
  sections?: PlanSection[];
  sectionCounts?: Record<string, number>;
}): PlanBundle {
  const sections = (input.sections ?? []).map((item, order) => ({
    ...item,
    planId: input.plan.id,
    order,
  }));
  const sectionCounts =
    input.sectionCounts ??
    sections.reduce<Record<string, number>>((counts, item) => {
      counts[item.type] = (counts[item.type] ?? 0) + 1;
      return counts;
    }, {});

  return {
    plan: input.plan,
    sections,
    comments: [],
    events: [],
    summary: {
      sectionCounts,
      commentCount: 0,
      openCommentCount: 0,
    },
  };
}

const apiDocsTechnicalPlanText = `# API docs technical plan

## API reference and validation

Refresh docs for Provider API endpoints and keep the API names visible in the plan: ProviderApiCatalogAction, ProviderApiDocsAction, ProviderApiRequestAction, UploadStatusResponse.

- packages/core/src/provider-api/request.ts:88 - symbols: \`providerApiRequest\`, \`ProviderApiRequestArgs\`; enforce zod validation for POST /api/provider-api-request and preserve scoped integration grant errors.
- packages/core/src/provider-api/catalog.ts:31 - symbols: \`providerApiCatalog\`, \`ProviderApiCatalogAction\`; list GET /api/provider-api-catalog and GET /v1/uploads/{uploadId} examples.
- templates/docs/app/routes/api-docs.tsx:142 - symbols: \`ApiDocsPage\`, \`EndpointExample\`; render endpoint examples, response shape snippets, and review notes.

\`\`\`ts
const UploadStatusResponse = z.object({
  id: z.string(),
  status: z.enum(["pending", "ready", "failed"]),
  bytesUploaded: z.number().int(),
});
\`\`\`

## Review and risks

Validation review must cover missing workspace grants, stale provider docs, pagination drift, and retry risk when provider-api-request returns 429.`;

const architectureDataFlowPlanText = `# Architecture and data-flow diagram plan

## Architecture and data flow diagram

Preserve a two-dimensional diagram section for the technical topology: group the React route and useActionMutation in a client layer, provider-api-catalog/provider-api-docs/provider-api-request in an action layer, workspace integration grant and upstream provider in a provider boundary, and SQL application_state in the storage layer.

Keep these node labels visible for review: Drizzle, ownableColumns, accessFilter, ProviderApiRequestAction, ProviderApiDocsAction, and provider-api-request.

## Data contracts and files

- packages/core/src/provider-api/catalog.ts:31 - symbols: \`providerApiCatalog\`, \`ProviderApiCatalogAction\`; expose catalog shape without provider secrets.
- packages/core/src/provider-api/docs.ts:64 - symbols: \`providerApiDocs\`, \`ProviderApiDocsAction\`; normalize OpenAPI docs before display.
- templates/plan/server/plans.ts:334 - symbols: \`buildPlanHtml\`, \`deriveSectionsFromText\`; preserve diagram terms and file references.

## Validation and review

Validate scoped reads, review access-control risk, and check that application_state keeps the selected API endpoint visible to the agent.`;

const richTechnicalHandoff = bundle({
  plan: plan({
    id: "technical_handoff",
    title: "Provider API technical handoff",
    brief:
      "Render diagrams, file tabs, snippets, validation, risks, and review notes for a technical implementation plan.",
  }),
  sections: [
    section(
      "technical_summary",
      "summary",
      "Technical scope",
      "The handoff covers ProviderApiCatalogAction, ProviderApiDocsAction, ProviderApiRequestAction, POST /api/provider-api-request, GET /api/provider-api-catalog, and GET /v1/uploads/{uploadId}. Validation, risk, and review language must stay visible.",
    ),
    section(
      "technical_data_flow",
      "diagram",
      "Architecture and data-flow diagram",
      "Data-flow diagram: show the API docs UI/useActionMutation client layer, provider-api-request action layer, workspace integration grant/upstream provider boundary, and SQL application_state storage layer as grouped regions. Review the Drizzle accessFilter and ownableColumns boundary before implementation.",
    ),
    section(
      "technical_implementation",
      "implementation",
      "Implementation map",
      `- packages/core/src/provider-api/request.ts:88 - symbols: \`providerApiRequest\`, \`ProviderApiRequestArgs\`; wire POST /api/provider-api-request validation, scoped grant lookup, retry risk logging, and review output.

\`\`\`ts
export async function providerApiRequest(args: ProviderApiRequestArgs) {
  const parsed = providerApiRequestSchema.parse(args);
  await assertAccess(parsed.workspaceId);
  return requestProviderApi(parsed);
}
\`\`\`

- templates/plan/server/plans.ts:334 - symbols: \`buildPlanHtml\`, \`deriveSectionsFromText\`; keep implementation-map file tabs, diagram sections, and code snippets in review output.

\`\`\`ts
const sections = deriveSectionsFromText(markdown);
const html = buildPlanHtml({ ...bundle, sections });
\`\`\`

- templates/docs/app/routes/api-docs.tsx:142 - symbols: \`ApiDocsPage\`, \`EndpointExample\`; show GET /v1/uploads/{uploadId}, GET /api/provider-api-catalog, and response examples.

\`\`\`tsx
export function EndpointExample() {
  return <code>GET /v1/uploads/{uploadId}</code>;
}
\`\`\``,
    ),
    section(
      "technical_validation",
      "risks",
      "Validation, risks, and review",
      "Validation checks: missing grants, stale OpenAPI docs, 429 retries, schema drift, and reviewer confidence before merge.",
    ),
  ],
});

const completeTechnicalPlanHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Complete technical plan</title>
</head>
<body data-complete-technical-plan="true">
  <main>
    <section data-plan-section-id="api-docs">
      <h1>API docs technical plan</h1>
      <p>ProviderApiRequestAction documents POST /api/provider-api-request and GET /v1/uploads/{uploadId}.</p>
    </section>
    <section data-plan-diagram="architecture">
      <h2>Architecture/data-flow diagram</h2>
      <p>Client layer, action layer, provider boundary, and SQL application_state storage layer are shown as grouped regions.</p>
    </section>
    <section class="implementation-map" data-plan-implementation-map>
      <button class="implementation-file-tab" data-tab-target="core-request">packages/core/src/provider-api/request.ts</button>
      <article class="implementation-file-panel" data-tab-panel="core-request">
        <pre><code>await assertAccess(workspaceId);</code></pre>
      </article>
    </section>
    <section data-plan-review="true">
      <p>Validation, risk, and review terms stay present for evaluator checks.</p>
    </section>
  </main>
</body>
</html>`;

const completeHtml = bundle({
  plan: plan({
    id: "complete_technical_html",
    title: "Complete technical HTML",
    brief: "Stored complete HTML should be returned as-is.",
    html: completeTechnicalPlanHtml,
  }),
});

export const technicalPlanTextExamples = {
  apiDocsTechnicalPlanText,
  architectureDataFlowPlanText,
} as const;

export const technicalPlanBundles = {
  richTechnicalHandoff,
  completeHtml,
} as const;
