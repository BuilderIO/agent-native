
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("docs root ErrorBoundary", () => {
  const source = fs.readFileSync(
    path.join(import.meta.dirname, "root.tsx"),
    "utf8",
  );

  it("imports stale-chunk recovery", () => {
    expect(source).toContain(
      'import { recoverFromStaleChunkError } from "@agent-native/core/client/route-chunk-recovery";',
    );
  });

  it("attempts recovery before rendering the generic error screen", () => {
    expect(source).toMatch(/recoverFromStaleChunkError\(error\)/);
  });

  it("logs any error it does not recover from", () => {
    expect(source).toContain('console.error("[DocsErrorBoundary]", error)');
  });

  it("publishes complete organization contact metadata", () => {
    expect(source).toContain('"@type": "ContactPoint"');
    expect(source).toContain('email: "support@builder.io"');
    expect(source).toContain('"@type": "PostalAddress"');
    expect(source).toContain('postalCode: "94103"');
  });
});
