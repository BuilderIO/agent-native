import { describe, expect, it } from "vitest";

import {
  buildProviderApiAuditSummary,
  sanitizeProviderApiAuditPath,
} from "./provider-api-audit.js";

describe("provider API audit summaries", () => {
  it("redacts every query value from relative and absolute request paths", () => {
    expect(
      sanitizeProviderApiAuditPath(
        "/v1/resources?api_key=secret-example&cursor=page-example",
      ),
    ).toBe("/v1/resources?api_key=[redacted]&cursor=[redacted]");
    expect(
      sanitizeProviderApiAuditPath(
        "https://api.example.test/download?X-Amz-Signature=signed-example&part=1",
      ),
    ).toBe(
      "https://api.example.test/download?X-Amz-Signature=[redacted]&part=[redacted]",
    );
  });

  it("redacts credential-named and opaque path segments", () => {
    expect(
      sanitizeProviderApiAuditPath(
        "/hooks/token/secret-example-value/callback/api_key=another-example",
      ),
    ).toBe("/hooks/token/[redacted]/callback/api_key=[redacted]");
    expect(
      sanitizeProviderApiAuditPath(
        "/download/0123456789abcdef0123456789abcdef/file",
      ),
    ).toBe("/download/[redacted]/file");
  });

  it("drops fragments and keeps explicit query arguments out of summaries", () => {
    const summary = buildProviderApiAuditSummary({
      method: "get",
      provider: "example",
      path: "/records?filter=customer-example#secret-example-fragment",
      query: { api_key: "query-secret-example" },
    } as Parameters<typeof buildProviderApiAuditSummary>[0] & {
      query: unknown;
    });

    expect(summary).toBe("GET example /records?filter=[redacted]");
    expect(summary).not.toContain("customer-example");
    expect(summary).not.toContain("secret-example");
    expect(summary).not.toContain("query-secret-example");
  });
});
