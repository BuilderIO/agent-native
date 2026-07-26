import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { validateTrustedAcceptanceWorkflow } from "./guard-trusted-acceptance-workflow.ts";

const workflow = readFileSync(
  ".github/workflows/trusted-acceptance.yml",
  "utf8",
);

describe("trusted acceptance workflow boundary", () => {
  it("keeps candidate builds separate from protected deployment custody", () => {
    assert.deepEqual(validateTrustedAcceptanceWorkflow(workflow), {
      ok: true,
      issues: [],
    });
  });

  it("rejects a secret exposed to candidate build steps", () => {
    const unsafe = workflow.replace(
      "\n  deploy:\n",
      "\n    env:\n      LEAK: ${{ secrets.ACCEPTANCE_NETLIFY_AUTH_TOKEN }}\n\n  deploy:\n",
    );
    const result = validateTrustedAcceptanceWorkflow(unsafe);
    assert.equal(result.ok, false);
    assert(result.issues.some((issue) => issue.includes("candidate build")));
  });

  it("rejects a secret inherited from the workflow environment", () => {
    const unsafe = workflow.replace(
      "  CONFIG_FILE: scripts/trusted-acceptance-workspaces.json",
      "  CONFIG_FILE: scripts/trusted-acceptance-workspaces.json\n  LEAKED_DATABASE_URL: ${{ secrets.ACCEPTANCE_DATABASE_URL }}",
    );
    const result = validateTrustedAcceptanceWorkflow(unsafe);
    assert.equal(result.ok, false);
    assert(
      result.issues.some((issue) =>
        issue.includes("workflow-level environment"),
      ),
    );
  });

  it("requires the hidden Netlify function bundle in candidate artifacts", () => {
    const unsafe = workflow.replace(
      "          include-hidden-files: true\n",
      "",
    );
    const result = validateTrustedAcceptanceWorkflow(unsafe);
    assert.equal(result.ok, false);
    assert(result.issues.some((issue) => issue.includes("hidden Netlify")));
  });

  it("rejects rollback planning that always bypasses activation gates", () => {
    const unsafe = workflow.replace(
      '            if [[ "$DEPLOY_REQUESTED" != "true" ]]; then\n              rollback_plan_args+=(--allow-disabled)\n            fi',
      "            rollback_plan_args+=(--allow-disabled)",
    );
    const result = validateTrustedAcceptanceWorkflow(unsafe);
    assert.equal(result.ok, false);
    assert(
      result.issues.some((issue) =>
        issue.includes("only when no deployment is requested"),
      ),
    );
  });

  it("rejects candidate checkouts that persist GitHub credentials", () => {
    const unsafe = workflow.replace(
      "path: candidate\n          persist-credentials: false",
      "path: candidate\n          persist-credentials: true",
    );
    const result = validateTrustedAcceptanceWorkflow(unsafe);
    assert.equal(result.ok, false);
    assert(result.issues.some((issue) => issue.includes("candidate checkout")));
  });

  it("rejects candidate-controlled workflow triggers", () => {
    const unsafe = workflow.replace(
      "on:\n  workflow_dispatch:",
      "on:\n  pull_request:\n  workflow_dispatch:",
    );
    const result = validateTrustedAcceptanceWorkflow(unsafe);
    assert.equal(result.ok, false);
    assert(
      result.issues.some((issue) => issue.includes("candidate-controlled")),
    );
  });

  it("rejects candidate Netlify configuration crossing into privileged custody", () => {
    const unsafe = workflow.replace(
      '          node -e \'require("node:fs")',
      '          cp "templates/$TEMPLATE/netlify.toml" "$RUNNER_TEMP/acceptance-artifact/$TEMPLATE/netlify.toml"\n          node -e \'require("node:fs")',
    );
    const result = validateTrustedAcceptanceWorkflow(unsafe);
    assert.equal(result.ok, false);
    assert(
      result.issues.some((issue) => issue.includes("Netlify configuration")),
    );
  });

  it("rejects moving trusted-controller checkouts", () => {
    const unsafe = workflow.replace("ref: ${{ github.sha }}", "ref: main");
    const result = validateTrustedAcceptanceWorkflow(unsafe);
    assert.equal(result.ok, false);
    assert(result.issues.some((issue) => issue.includes("controller SHA")));
  });
});
