import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  analyzeProviderActionFactorySource,
  checkProviderActionFactories,
} from "./guard-provider-action-factories";

describe("provider action factory guard", () => {
  it("accepts a Core provider action factory", () => {
    const violations = analyzeProviderActionFactorySource(
      "templates/example/actions/provider-api-request.ts",
      `
        import { createProviderApiRequestAction } from "@agent-native/core/provider-api/actions/provider-api";
        export default createProviderApiRequestAction(runtime, { appId: "example" });
      `,
      "provider-api-request",
    );

    assert.deepEqual(violations, []);
  });

  it("rejects a local action implementation even when the factory is imported", () => {
    const violations = analyzeProviderActionFactorySource(
      "templates/example/actions/list-staged-datasets.ts",
      `
        import { createListStagedDatasetsAction } from "@agent-native/core/provider-api/actions/staged-datasets";
        export default defineAction({ run: () => [] });
      `,
      "list-staged-datasets",
    );

    assert.equal(violations.length, 2);
    assert.match(violations[0]?.message ?? "", /must create/);
    assert.match(violations[1]?.message ?? "", /must not define/);
  });

  it("does not treat documentation text as a local implementation", () => {
    const violations = analyzeProviderActionFactorySource(
      "templates/example/actions/provider-api-docs.ts",
      `
        import { createProviderApiDocsAction } from "@agent-native/core/provider-api/actions/provider-api";
        // defineAction({ ... }) is intentionally not used here.
        const guidance = "defineAction(";
        export default createProviderApiDocsAction(runtime);
      `,
      "provider-api-docs",
    );

    assert.deepEqual(violations, []);
  });

  it("scans optional templates and packages/dispatch for local duplicates", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "provider-factory-"));
    try {
      const actionDirectory = path.join(root, "templates", "extra", "actions");
      fs.mkdirSync(actionDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(actionDirectory, "provider-api-request.ts"),
        "export default defineAction({});",
      );
      const dispatchDirectory = path.join(
        root,
        "packages",
        "dispatch",
        "src",
        "actions",
      );
      fs.mkdirSync(dispatchDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(dispatchDirectory, "provider-api-docs.ts"),
        "export default defineAction({});",
      );

      const violations = checkProviderActionFactories(root);

      assert.ok(
        violations.some((violation) =>
          violation.file.endsWith(
            "templates/extra/actions/provider-api-request.ts",
          ),
        ),
      );
      assert.ok(
        violations.some((violation) =>
          violation.file.endsWith(
            "packages/dispatch/src/actions/provider-api-docs.ts",
          ),
        ),
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
