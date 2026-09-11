import { describe, expect, it } from "vitest";

import {
  technicalPlanBundles,
  technicalPlanTextExamples,
} from "./__fixtures__/technical-plan-examples.js";
import { buildPlanHtml, deriveSectionsFromText } from "./plans.js";

function expectTerms(value: string, terms: string[]) {
  for (const term of terms) {
    expect(value).toContain(term);
  }
}

function expectTermsIgnoringCase(value: string, terms: string[]) {
  const normalized = value.toLowerCase();
  for (const term of terms) {
    expect(normalized).toContain(term.toLowerCase());
  }
}

function countOccurrences(value: string, term: string) {
  return value.split(term).length - 1;
}

describe("technical plan HTML examples", () => {
  it("derives API docs plans without losing endpoints, validation, risks, or file refs", () => {
    const sections = deriveSectionsFromText(
      technicalPlanTextExamples.apiDocsTechnicalPlanText,
    );
    const combined = sections
      .map((item) => `${item.title}\n${item.body}\n${item.html ?? ""}`)
      .join("\n");

    expect(sections.some((item) => item.type === "implementation")).toBe(true);
    expect(sections.some((item) => item.type === "questions")).toBe(true);
    expectTerms(combined, [
      "ProviderApiCatalogAction",
      "ProviderApiDocsAction",
      "ProviderApiRequestAction",
      "UploadStatusResponse",
      "POST /api/provider-api-request",
      "GET /api/provider-api-catalog",
      "GET /v1/uploads/{uploadId}",
      "packages/core/src/provider-api/request.ts",
      "packages/core/src/provider-api/catalog.ts",
      "templates/docs/app/routes/api-docs.tsx",
      "validation",
      "risk",
      "review",
    ]);
  });

  it("derives architecture and data-flow examples as diagram-backed technical plans", () => {
    const sections = deriveSectionsFromText(
      technicalPlanTextExamples.architectureDataFlowPlanText,
    );
    const combined = sections
      .map((item) => `${item.title}\n${item.body}\n${item.html ?? ""}`)
      .join("\n");
    const diagram = sections.find((item) => item.type === "diagram");

    expect(diagram?.title).toMatch(/architecture|data flow/i);
    expect(sections.some((item) => item.type === "implementation")).toBe(true);
    expectTerms(combined, [
      "provider-api-catalog",
      "provider-api-docs",
      "provider-api-request",
      "application_state",
      "Drizzle",
      "ownableColumns",
      "accessFilter",
      "ProviderApiRequestAction",
      "packages/core/src/provider-api/catalog.ts",
      "packages/core/src/provider-api/docs.ts",
      "templates/plan/server/plans.ts",
    ]);
    expectTermsIgnoringCase(combined, ["validation", "risk", "review"]);
  });

  it("renders technical handoff HTML with diagrams, file tabs, snippets, and review terms", () => {
    const html = buildPlanHtml(technicalPlanBundles.richTechnicalHandoff);

    expectTerms(html, [
      "<!doctype html>",
      "Provider API technical handoff",
      "flow-diagram",
      "data-plan-implementation-map",
      "implementation-file-tabs",
      "implementation-file-tab",
      "implementation-file-panel tab-panel",
      "data-tab-target",
      "data-tab-panel",
      "inline-code-preview",
      "ProviderApiRequestAction",
      "ProviderApiDocsAction",
      "POST /api/provider-api-request",
      "GET /api/provider-api-catalog",
      "GET /v1/uploads/{uploadId}",
      "packages/core/src/provider-api/request.ts",
      "templates/plan/server/plans.ts",
      "templates/docs/app/routes/api-docs.tsx",
      "providerApiRequest",
      "buildPlanHtml",
      "deriveSectionsFromText",
      "EndpointExample",
      "assertAccess",
      'data-agent-native-open-line="88"',
      "validation",
      "risk",
      "review",
    ]);
    expect(
      countOccurrences(html, "implementation-file-tab"),
    ).toBeGreaterThanOrEqual(3);
    expect(
      countOccurrences(html, "inline-code-preview"),
    ).toBeGreaterThanOrEqual(3);
  });

  it("returns complete technical HTML examples without replacing the embedded plan", () => {
    const html = buildPlanHtml(technicalPlanBundles.completeHtml);

    expectTerms(html, [
      "<!doctype html>",
      'data-complete-technical-plan="true"',
      'data-plan-section-id="api-docs"',
      'data-plan-diagram="architecture"',
      "data-plan-implementation-map",
      'data-tab-target="core-request"',
      'data-tab-panel="core-request"',
      "ProviderApiRequestAction",
      "POST /api/provider-api-request",
      "GET /v1/uploads/{uploadId}",
      // The fixture diagram text was updated in fa107db92 from an explicit chain
      // (provider-api-catalog -> provider-api-docs -> ...) to grouped-layer
      // terminology; provider-api-catalog and provider-api-docs are no longer
      // present in completeTechnicalPlanHtml. provider-api-request still appears
      // as a substring of POST /api/provider-api-request.
      "provider-api-request",
      "packages/core/src/provider-api/request.ts",
      "assertAccess",
      "Validation",
      "risk",
      "review",
    ]);
    expect(html).not.toContain("Working plan");
    expect(html).not.toContain('class="hero"');
  });
});
