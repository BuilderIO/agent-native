import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { validateContentProductImpactWorkflow } from "./validate-content-product-impact-workflow.ts";

const workflow = readFileSync(
  ".github/workflows/content-product-conformance.yml",
  "utf8",
);

describe("Content product conformance workflow boundary", () => {
  it("keeps the pilot read-only, exact-revision, and broadly observable", () => {
    assert.deepEqual(validateContentProductImpactWorkflow(workflow), {
      ok: true,
      issues: [],
    });
  });

  it("rejects pull_request_target and write permissions", () => {
    const unsafe = workflow
      .replace("  pull_request:", "  pull_request_target:")
      .replace("contents: read", "contents: write");
    const result = validateContentProductImpactWorkflow(unsafe);
    assert.equal(result.ok, false);
    assert(
      result.issues.some((issue) => issue.includes("pull_request_target")),
    );
    assert(result.issues.some((issue) => issue.includes("permissions")));
  });

  it("rejects path filtering or a candidate checkout with credentials", () => {
    const unsafe = workflow
      .replace("    types:", '    paths: ["templates/content/**"]\n    types:')
      .replace("persist-credentials: false", "persist-credentials: true");
    const result = validateContentProductImpactWorkflow(unsafe);
    assert.equal(result.ok, false);
    assert(result.issues.some((issue) => issue.includes("path filters")));
    assert(result.issues.some((issue) => issue.includes("credentials")));
  });

  it("requires declaration and label edits to rerun the pilot", () => {
    const unsafe = workflow.replace("        edited,\n", "");
    const result = validateContentProductImpactWorkflow(unsafe);
    assert.equal(result.ok, false);
    assert(result.issues.some((issue) => issue.includes("recalibration")));
  });

  it("does not hide checker infrastructure failures", () => {
    for (const value of ["true", "${{ true }}"]) {
      const unsafe = workflow.replace(
        "        run: pnpm content-product-impact",
        `        continue-on-error: ${value}\n        run: pnpm content-product-impact`,
      );
      const result = validateContentProductImpactWorkflow(unsafe);
      assert.equal(result.ok, false);
      assert(result.issues.some((issue) => issue.includes("infrastructure")));
    }
  });

  it("rejects dot and bracket references to the secrets context", () => {
    for (const expression of [
      "${{ secrets.DEPLOY_KEY }}",
      "${{ secrets['DEPLOY_KEY'] }}",
      "${{ toJSON(secrets) }}",
    ]) {
      const unsafe = workflow.replace(
        "    timeout-minutes:",
        `    env:\n      LEAK: "${expression}"\n    timeout-minutes:`,
      );
      const result = validateContentProductImpactWorkflow(unsafe);
      assert.equal(result.ok, false);
      assert(result.issues.some((issue) => issue.includes("secrets")));
    }
  });

  it("rejects job-level permission overrides and explicit GitHub tokens", () => {
    const unsafe = workflow
      .replace(
        "    name: Advisory Content product impact",
        "    name: Advisory Content product impact\n    permissions:\n      contents: write",
      )
      .replace(
        "    timeout-minutes:",
        `    env:\n      GH_TOKEN: "\${{ github['token'] }}"\n    timeout-minutes:`,
      );
    const result = validateContentProductImpactWorkflow(unsafe);
    assert.equal(result.ok, false);
    assert(result.issues.some((issue) => issue.includes("permissions")));
    assert(result.issues.some((issue) => issue.includes("credentials")));
  });

  it("rejects serialization of the full GitHub context", () => {
    for (const expression of [
      "${{ toJSON(github) }}",
      "${{ TOJSON( GITHUB ) }}",
    ]) {
      const unsafe = workflow.replace(
        "    timeout-minutes:",
        `    env:\n      GITHUB_CONTEXT: "${expression}"\n    timeout-minutes:`,
      );
      const result = validateContentProductImpactWorkflow(unsafe);
      assert.equal(result.ok, false);
      assert(result.issues.some((issue) => issue.includes("credentials")));
    }
  });

  it("requires the check job and impact checker step to be unconditional", () => {
    const unsafe = workflow
      .replace(
        "    name: Advisory Content product impact",
        "    name: Advisory Content product impact\n    if: false",
      )
      .replace(
        "      - name: Check Content product impact",
        "      - name: Check Content product impact\n        if: false",
      );
    const result = validateContentProductImpactWorkflow(unsafe);
    assert.equal(result.ok, false);
    assert.equal(
      result.issues.filter((issue) => issue.includes("unconditionally")).length,
      2,
    );
  });

  it("rejects extra jobs and additional checkout steps", () => {
    const unsafe = workflow
      .replace(
        "jobs:\n",
        "jobs:\n  leak:\n    runs-on: ubuntu-latest\n    environment: production\n    steps: []\n",
      )
      .replace(
        "      - uses: pnpm/action-setup@",
        "      - uses: actions/checkout@unsafe\n\n      - uses: pnpm/action-setup@",
      );
    const result = validateContentProductImpactWorkflow(unsafe);
    assert.equal(result.ok, false);
    assert(result.issues.some((issue) => issue.includes("only")));
    assert(result.issues.some((issue) => issue.includes("one checkout")));
  });
});
