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
});
