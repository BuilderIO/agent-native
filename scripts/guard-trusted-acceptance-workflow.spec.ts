import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { parse, stringify } from "yaml";

import {
  validateRuntimeAuthorityConfiguration,
  validateTrustedAcceptanceReaper,
  validateTrustedAcceptanceWorkflow,
} from "./guard-trusted-acceptance-workflow.ts";

const workflow = readFileSync(
  ".github/workflows/trusted-acceptance.yml",
  "utf8",
);
const reaper = readFileSync(
  ".github/workflows/trusted-acceptance-reaper.yml",
  "utf8",
);

function extractStepRunScript(source: string, stepName: string): string {
  const stepMarker = `      - name: ${stepName}\n`;
  const stepStart = source.indexOf(stepMarker);
  assert.notEqual(stepStart, -1, `Missing workflow step: ${stepName}`);

  const runMarker = "        run: |\n";
  const runStart = source.indexOf(runMarker, stepStart);
  assert.notEqual(
    runStart,
    -1,
    `Missing run block for workflow step: ${stepName}`,
  );

  const scriptStart = runStart + runMarker.length;
  const nextStep = source.indexOf("\n      - name:", scriptStart);
  const scriptEnd = nextStep === -1 ? source.length : nextStep;
  return source
    .slice(scriptStart, scriptEnd)
    .split("\n")
    .map((line) => (line.startsWith("          ") ? line.slice(10) : line))
    .join("\n");
}

describe("trusted acceptance workflow boundary", () => {
  it("keeps candidate builds separate from protected deployment custody", () => {
    assert.deepEqual(validateTrustedAcceptanceWorkflow(workflow), {
      ok: true,
      issues: [],
    });
  });

  it("keeps the rendered candidate and rollback provenance shell parseable", () => {
    const script = extractStepRunScript(
      workflow,
      "Verify candidate or known-good rollback provenance",
    );
    const result = spawnSync("bash", ["-n"], {
      input: script,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
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

  it("requires candidate artifacts to reject symlinks before credentials", () => {
    const unsafe = workflow.replace(
      "                if (stat.isSymbolicLink()) throw new Error(`Candidate artifact contains a symlink: ${file}`);\n",
      "",
    );
    const result = validateTrustedAcceptanceWorkflow(unsafe);
    assert.equal(result.ok, false);
    assert(result.issues.some((issue) => issue.includes("symlinks")));
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

  it("requires pnpm metadata to follow the nested candidate checkout", () => {
    const unsafe = workflow.replace(
      "        with:\n          package_json_file: candidate/package.json\n",
      "",
    );
    const result = validateTrustedAcceptanceWorkflow(unsafe);
    assert.equal(result.ok, false);
    assert(
      result.issues.some((issue) =>
        issue.includes("package-manager metadata from the nested checkout"),
      ),
    );
  });

  it("requires nested candidate metadata on the pnpm setup step", () => {
    const unsafe = workflow
      .replace(
        "        with:\n          package_json_file: candidate/package.json\n\n      - uses: actions/setup-node@",
        "\n      - uses: actions/setup-node@",
      )
      .replace(
        "        with:\n          node-version-file: candidate/.nvmrc",
        "        with:\n          package_json_file: candidate/package.json\n          node-version-file: candidate/.nvmrc",
      );
    const result = validateTrustedAcceptanceWorkflow(unsafe);
    assert.equal(result.ok, false);
    assert(
      result.issues.some((issue) =>
        issue.includes("package-manager metadata from the nested checkout"),
      ),
    );
  });

  it("rejects duplicate pnpm setup steps", () => {
    const unsafe = workflow.replace(
      "          package_json_file: candidate/package.json\n\n      - uses: actions/setup-node@",
      "          package_json_file: candidate/package.json\n\n      - uses: pnpm/action-setup@duplicate\n\n      - uses: actions/setup-node@",
    );
    const result = validateTrustedAcceptanceWorkflow(unsafe);
    assert.equal(result.ok, false);
    assert(
      result.issues.some((issue) =>
        issue.includes("exactly one pnpm setup step"),
      ),
    );
  });

  it("ignores pnpm setup lookalikes inside run blocks", () => {
    const unsafe = workflow
      .replace(
        "        with:\n          package_json_file: candidate/package.json\n",
        "",
      )
      .replace(
        "      - name: Install candidate dependencies without runtime credentials",
        "      - name: Lookalike is not an action step\n        run: |\n          uses: pnpm/action-setup@lookalike\n          with:\n            package_json_file: candidate/package.json\n\n      - name: Install candidate dependencies without runtime credentials",
      );
    const result = validateTrustedAcceptanceWorkflow(unsafe);
    assert.equal(result.ok, false);
    assert(
      result.issues.some((issue) =>
        issue.includes("package-manager metadata from the nested checkout"),
      ),
    );
  });

  it("accepts equivalent quoted candidate metadata", () => {
    const equivalent = workflow.replace(
      "        with:\n          package_json_file: candidate/package.json",
      '        # Candidate metadata remains bound to pnpm setup.\n\n        with:\n          package_json_file: "candidate/package.json" # repository-root-relative',
    );
    const result = validateTrustedAcceptanceWorkflow(equivalent);
    assert.equal(result.ok, true, result.issues.join("\n"));
  });

  it("accepts equivalent workflow step indentation", () => {
    const stepsStart = workflow.indexOf(
      "\n    steps:\n",
      workflow.indexOf("\n  build:\n"),
    );
    const deployStart = workflow.indexOf("\n  deploy:\n", stepsStart);
    const parsed = parse(workflow) as {
      jobs: { build: { steps: unknown[] } };
    };
    const reindentedSteps = stringify(parsed.jobs.build.steps, { indent: 4 })
      .trimEnd()
      .split("\n")
      .map((line) => `        ${line}`)
      .join("\n");
    const equivalent = `${workflow.slice(0, stepsStart)}\n    steps:\n${reindentedSteps}${workflow.slice(deployStart)}`;
    const result = validateTrustedAcceptanceWorkflow(equivalent);
    assert.equal(result.ok, true, result.issues.join("\n"));
  });

  it("accepts flow-style pnpm setup inputs", () => {
    const equivalent = workflow.replace(
      "        with:\n          package_json_file: candidate/package.json",
      "        with: { package_json_file: candidate/package.json }",
    );
    const result = validateTrustedAcceptanceWorkflow(equivalent);
    assert.equal(result.ok, true, result.issues.join("\n"));
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

  it("requires the generic hosted runner and trusted directory digest", () => {
    const unsafe = workflow
      .replace("run-hosted-acceptance.ts", "controller.ts")
      .replace("artifactSha256", "uncheckedDigest");
    const result = validateTrustedAcceptanceWorkflow(unsafe);
    assert.equal(result.ok, false);
    assert(
      result.issues.some(
        (issue) =>
          issue.includes("hosted runner") ||
          issue.includes("directory artifact"),
      ),
    );
  });

  it("requires isolation targets to resolve independently of A2A harnesses", () => {
    const unsafe = workflow.replace(
      "declaredPlan.isolation.otherAcceptanceMemberId",
      "declaredPlan.harness.targetMemberId",
    );
    const result = validateTrustedAcceptanceWorkflow(unsafe);
    assert.equal(result.ok, false);
    assert(
      result.issues.some((issue) =>
        issue.includes("independently of harness kind"),
      ),
    );
  });

  it("requires Playwright installation before protected credentials enter", () => {
    const unsafe = workflow.replace(
      "          pnpm exec playwright install --with-deps chromium\n",
      "",
    );
    const result = validateTrustedAcceptanceWorkflow(unsafe);
    assert.equal(result.ok, false);
    assert(result.issues.some((issue) => issue.includes("Playwright")));
  });
});

describe("trusted acceptance reaper boundary", () => {
  it("uses generic profiles and serializes against each workspace", () => {
    assert.deepEqual(validateTrustedAcceptanceReaper(reaper), {
      ok: true,
      issues: [],
    });
  });

  it("rejects a reaper that does not share workspace custody", () => {
    const unsafe = reaper.replace(
      "group: trusted-acceptance-${{ matrix.workspace }}",
      "group: trusted-acceptance-reaper",
    );
    const result = validateTrustedAcceptanceReaper(unsafe);
    assert.equal(result.ok, false);
    assert(result.issues.some((issue) => issue.includes("serialize")));
  });
});

describe("trusted acceptance runtime authority boundary", () => {
  it("permits a disabled workspace to declare the implemented lease contract", () => {
    assert.deepEqual(
      validateRuntimeAuthorityConfiguration([
        {
          enabled: false,
          runtimeAuthority: {
            lifecycle: "ephemeral-per-run",
            provisioner: {
              kind: "trusted-lease-v1",
              profileMapVariable: "ACCEPTANCE_AUTHORITY_PROFILES_JSON",
            },
          },
        },
      ]),
      { ok: true, issues: [] },
    );
  });

  it("fails closed if an enabled workspace has no configured provisioner", () => {
    const result = validateRuntimeAuthorityConfiguration([
      {
        enabled: true,
        runtimeAuthority: {
          lifecycle: "ephemeral-per-run",
          provisioner: { kind: "unconfigured" },
        },
      },
    ]);
    assert.equal(result.ok, false);
    assert(result.issues.some((issue) => issue.includes("remain disabled")));
  });
});
