import { readFileSync } from "node:fs";

export type WorkflowGuardResult = {
  ok: boolean;
  issues: string[];
};

function section(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex === -1 || endIndex === -1) return "";
  return source.slice(startIndex, endIndex);
}

function count(source: string, pattern: RegExp): number {
  return source.match(pattern)?.length ?? 0;
}

export function validateTrustedAcceptanceWorkflow(
  source: string,
): WorkflowGuardResult {
  const issues: string[] = [];
  const build = section(source, "\n  build:\n", "\n  deploy:\n");
  const deploy = section(source, "\n  deploy:\n", "\n  receipt:\n");

  if (!source.includes("workflow_dispatch:")) {
    issues.push("workflow must be manually dispatched");
  }
  if (/\n  (?:pull_request|push|pull_request_target):/.test(source)) {
    issues.push("workflow must not run from candidate-controlled events");
  }
  if (!source.includes('RUN_REF" != "refs/heads/main"')) {
    issues.push("workflow must fail closed unless dispatched from main");
  }
  if (!source.includes("group: trusted-acceptance-${{ inputs.workspace }}")) {
    issues.push("workflow must serialize each declarative workspace");
  }
  if (!source.includes("cancel-in-progress: false")) {
    issues.push("workspace serialization must not cancel an active run");
  }

  if (!build) {
    issues.push("build job is missing");
  } else {
    if (!build.includes("persist-credentials: false")) {
      issues.push("candidate checkout must not persist GitHub credentials");
    }
    if (/\bsecrets\.|\bvars\[|\benvironment:|github\.token/.test(build)) {
      issues.push(
        "candidate build must not receive secrets or environment variables",
      );
    }
    if (!build.includes("needs.plan.outputs.effective_sha")) {
      issues.push("candidate build must use the provenance-verified exact SHA");
    }
    if (!build.includes("Upload inert candidate artifact")) {
      issues.push("candidate output must cross jobs as an inert artifact");
    }
  }

  if (!deploy) {
    issues.push("deploy job is missing");
  } else {
    if (!deploy.includes("environment: trusted-acceptance")) {
      issues.push("deploy job must use the protected acceptance environment");
    }
    if (!deploy.includes("Check out trusted controller")) {
      issues.push("deploy job must use default-branch controller code");
    }
    if (!deploy.includes("Verify artifact provenance before credentials")) {
      issues.push("artifact provenance must be checked before deployment");
    }
    if (
      !deploy.includes("scripts/netlify-sites.json") ||
      !deploy.includes("known production site ID")
    ) {
      issues.push(
        "resolved acceptance site must be rejected if it is a production site",
      );
    }
    if (!deploy.includes("netlify deploy --prod --no-build")) {
      issues.push("privileged deployment must never rebuild candidate code");
    }
    if (
      !deploy.includes(
        '--functions "$ARTIFACT_DIR/.netlify/functions-internal"',
      )
    ) {
      issues.push(
        "deployment must upload the prebuilt Netlify function bundle",
      );
    }
    if (
      !deploy.includes(
        "working-directory: ${{ runner.temp }}/trusted-acceptance-deploy",
      ) ||
      deploy.includes(
        "working-directory: ${{ runner.temp }}/acceptance-artifact",
      )
    ) {
      issues.push(
        "privileged upload must run from an empty trusted directory, not candidate files",
      );
    }
    const secretIndex = deploy.indexOf("secrets.ACCEPTANCE_NETLIFY_AUTH_TOKEN");
    const verifyIndex = deploy.indexOf(
      "Verify artifact provenance before credentials",
    );
    if (secretIndex === -1 || secretIndex < verifyIndex) {
      issues.push(
        "deployment credential must enter only after artifact verification",
      );
    }
    if (
      /pnpm\s+(?:run\s+)?(?:build|install)|npm\s+(?:run\s+)?build/.test(
        deploy.slice(secretIndex),
      )
    ) {
      issues.push(
        "candidate or dependency scripts must not run after credentials enter",
      );
    }
  }

  if (count(source, /secrets\.ACCEPTANCE_NETLIFY_AUTH_TOKEN/g) !== 1) {
    issues.push(
      "acceptance Netlify credential must appear in exactly one step",
    );
  }
  if (count(source, /vars\[matrix\.siteIdVariable\]/g) !== 1) {
    issues.push("acceptance site variable must appear in exactly one step");
  }
  if (count(source, /ref: \$\{\{ github\.sha \}\}/g) !== 3) {
    issues.push(
      "plan, deploy, and receipt must pin trusted code to the dispatch controller SHA",
    );
  }
  if (/ref: main/.test(source)) {
    issues.push("trusted checkouts must not follow a moving default branch");
  }
  if (
    !source.includes("rollback_run_id") ||
    !source.includes("currentKnownGoodSha") ||
    !source.includes("trusted-acceptance-receipt-$ROLLBACK_RUN_ID") ||
    !source.includes('--expected-assertions "$expected_assertions"') ||
    !source.includes(
      'run.path !== ".github/workflows/trusted-acceptance.yml"',
    ) ||
    !source.includes('run.conclusion !== "success"') ||
    !source.includes("receipt.controllerSha !== run.head_sha")
  ) {
    issues.push("rollback must be bound to a prior passing workspace receipt");
  }
  if (/cp .*netlify\.toml/.test(build)) {
    issues.push(
      "candidate Netlify configuration must not cross into deployment custody",
    );
  }
  if (/secrets\.NETLIFY_AUTH_TOKEN/.test(source)) {
    issues.push(
      "trusted acceptance must not depend on production Netlify custody",
    );
  }

  return { ok: issues.length === 0, issues };
}

function main(): void {
  const workflow = readFileSync(
    ".github/workflows/trusted-acceptance.yml",
    "utf8",
  );
  const result = validateTrustedAcceptanceWorkflow(workflow);
  if (!result.ok) {
    for (const issue of result.issues)
      console.error(`[trusted-acceptance] ${issue}`);
    process.exitCode = 1;
    return;
  }
  console.log("Trusted acceptance workflow boundary checks passed.");
}

if (process.argv[1]?.endsWith("guard-trusted-acceptance-workflow.ts")) main();
