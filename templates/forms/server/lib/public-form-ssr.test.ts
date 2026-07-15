import { describe, expect, it, vi } from "vitest";

const mockGetAppBasePath = vi.hoisted(() => vi.fn(() => ""));
const mockGetDb = vi.hoisted(() => vi.fn());
const mockGetMethod = vi.hoisted(() => vi.fn(() => "GET"));
const mockGetRequestURL = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/server", () => ({
  getAppBasePath: () => mockGetAppBasePath(),
}));

vi.mock("h3", () => ({
  getMethod: () => mockGetMethod(),
  getRequestURL: () => mockGetRequestURL(),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
}));

vi.mock("../db/index.js", () => ({
  getDb: () => mockGetDb(),
  schema: {
    forms: {
      id: "forms.id",
      slug: "forms.slug",
    },
  },
}));

import { renderPublicForm } from "./public-form-ssr";

function createDbWithRows(rows: unknown[]) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve(rows)),
      })),
    })),
  };
}

describe("public form SSR", () => {
  it("does not emit CSP headers on direct public form HTML responses", async () => {
    mockGetRequestURL.mockReturnValue(
      new URL("https://forms.example.test/f/nope"),
    );
    mockGetDb.mockReturnValue(createDbWithRows([]));

    const response = await renderPublicForm({} as any);

    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("content-security-policy")).toBeNull();
    expect(
      response.headers.get("content-security-policy-report-only"),
    ).toBeNull();
  });

  it("emits form-specific social metadata and a versioned OG image URL", async () => {
    mockGetRequestURL.mockReturnValue(
      new URL("https://forms.example.test/f/customer-intake-123"),
    );
    mockGetDb.mockReturnValue(
      createDbWithRows([
        {
          id: "form-123",
          slug: "customer-intake-123",
          title: "Customer intake",
          description: "Tell us what you need.",
          ownerEmail: "owner@example.test",
          updatedAt: "2026-07-14T12:00:00.000Z",
          fields: "[]",
          settings: "{}",
          status: "published",
          deletedAt: null,
        },
      ]),
    );

    const response = await renderPublicForm({} as any);
    const html = await response.text();

    expect(html).toContain(
      '<meta property="og:title" content="Customer intake">',
    );
    expect(html).toContain(
      '<meta property="og:description" content="Tell us what you need.">',
    );
    expect(html).toContain(
      "/api/forms/og/customer-intake-123/og.png?v=2026-07-14T12%3A00%3A00.000Z",
    );
  });
});
