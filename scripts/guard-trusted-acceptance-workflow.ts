import { readFileSync } from "node:fs";

import { parse } from "yaml";

export type WorkflowGuardResult = {
  ok: boolean;
  issues: string[];
};

export type GuardedRuntimeWorkspace = {
  enabled?: boolean;
  runtimeAuthority?: {
    lifecycle?: string;
    provisioner?: { kind?: string; profileMapVariable?: string };
  };
};

export function validateRuntimeAuthorityConfiguration(
  workspaces: readonly GuardedRuntimeWorkspace[] | undefined,
): WorkflowGuardResult {
  const issues: string[] = [];
  if (!workspaces?.length) {
    issues.push("trusted acceptance must declare at least one workspace");
    return { ok: false, issues };
  }
  for (const [index, workspace] of workspaces.entries()) {
    const authority = workspace.runtimeAuthority;
    if (authority?.lifecycle !== "ephemeral-per-run") {
      issues.push(
        `workspace ${index} must require ephemeral per-run authority`,
      );
    }
    const kind = authority?.provisioner?.kind;
    if (kind !== "unconfigured" && kind !== "trusted-lease-v1") {
      issues.push(
        `workspace ${index} must use an approved authority provisioner`,
      );
    }
    if (workspace.enabled && kind === "unconfigured") {
      issues.push(
        `workspace ${index} must remain disabled without a configured authority provisioner`,
      );
    }
    if (
      kind === "trusted-lease-v1" &&
      authority?.provisioner?.profileMapVariable !==
        "ACCEPTANCE_AUTHORITY_PROFILES_JSON"
    )
      issues.push(
        `workspace ${index} must use the generic protected profile map`,
      );
  }
  return { ok: issues.length === 0, issues };
}

function section(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex === -1 || endIndex === -1) return "";
  return source.slice(startIndex, endIndex);
}

function count(source: string, pattern: RegExp): number {
  return source.match(pattern)?.length ?? 0;
}

type GuardedWorkflowStep = {
  uses?: string;
  with: Record<string, string>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseWorkflowSteps(source: string): GuardedWorkflowStep[] {
  const workflow: unknown = parse(source);
  if (!isRecord(workflow) || !isRecord(workflow.jobs)) return [];
  const build = workflow.jobs.build;
  if (!isRecord(build) || !Array.isArray(build.steps)) return [];

  return build.steps.filter(isRecord).map((step) => ({
    uses: typeof step.uses === "string" ? step.uses : undefined,
    with: isRecord(step.with)
      ? Object.fromEntries(
          Object.entries(step.with).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        )
      : {},
  }));
}

export function validateTrustedAcceptanceWorkflow(
  source: string,
): WorkflowGuardResult {
  const issues: string[] = [];
  const workflowEnvironment = section(source, "\nenv:\n", "\njobs:\n");
  const build = section(source, "\n  build:\n", "\n  deploy:\n");
  const deploy = section(source, "\n  deploy:\n", "\n  receipt:\n");
  let workflowSteps: GuardedWorkflowStep[] = [];
  try {
    workflowSteps = parseWorkflowSteps(source);
  } catch {
    issues.push("workflow must be valid YAML");
  }

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
  if (
    /\bsecrets\.|\bvars\[|github\.token/.test(workflowEnvironment) ||
    /^\s+(?:[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY|DATABASE_URL)[A-Z0-9_]*):/m.test(
      workflowEnvironment,
    )
  ) {
    issues.push(
      "workflow-level environment must not expose inherited credentials to candidate jobs",
    );
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
    const pnpmSetupSteps = workflowSteps.filter((step) =>
      step.uses?.startsWith("pnpm/action-setup@"),
    );
    if (pnpmSetupSteps.length !== 1) {
      issues.push("candidate build must contain exactly one pnpm setup step");
    } else if (
      pnpmSetupSteps[0]!.with.package_json_file !== "candidate/package.json"
    ) {
      issues.push(
        "candidate pnpm setup must read package-manager metadata from the nested checkout",
      );
    }
    if (!build.includes("Upload inert candidate artifact")) {
      issues.push("candidate output must cross jobs as an inert artifact");
    }
    if (!build.includes("include-hidden-files: true")) {
      issues.push("candidate artifact must include the hidden Netlify bundle");
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
    if (
      !deploy.includes("Verify every artifact provenance before credentials")
    ) {
      issues.push("artifact provenance must be checked before deployment");
    }
    if (
      !deploy.includes("lstatSync") ||
      !deploy.includes("Candidate artifact contains a symlink")
    )
      issues.push(
        "candidate artifacts must reject symlinks and non-regular files before privileged custody",
      );
    if (
      !deploy.includes('readFileSync("scripts/netlify-sites.json"') ||
      !deploy.includes("known production site ID")
    ) {
      issues.push(
        "resolved acceptance site must be rejected if it is a production site",
      );
    }
    if (
      !deploy.includes("run-hosted-acceptance.ts") ||
      !deploy.includes(
        '--deploy-manifest "$RUNNER_TEMP/trusted-deploy-manifest.json"',
      )
    )
      issues.push(
        "protected deployment must use the generic trusted hosted runner",
      );
    if (!deploy.includes("playwright install --with-deps chromium"))
      issues.push("Playwright must be installed before credentials enter");
    if (
      !deploy.includes("directory-fixture.ts") ||
      !deploy.includes("artifactSha256") ||
      !deploy.includes('hash.update(relative).update("\\0")')
    )
      issues.push(
        "trusted directory artifact must be staged and digest-bound before credentials enter",
      );
    if (
      !deploy.includes("declaredPlan.isolation.otherAcceptanceMemberId") ||
      !deploy.includes(
        "Configured isolation member is missing from the trusted plan",
      )
    )
      issues.push(
        "hosted isolation must resolve its member independently of harness kind",
      );
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
    if (deploy.includes("strategy:") || deploy.includes("matrix.")) {
      issues.push("privileged authority must operate on one whole workspace");
    }
    if (
      !deploy.includes(
        "Run trusted hosted OAuth, harness, deployment, and cleanup",
      ) ||
      !deploy.includes(
        "Revoke one whole-workspace disposable lease after interruption",
      ) ||
      !deploy.includes("if: ${{ always() }}")
    ) {
      issues.push("whole-workspace cleanup must run unconditionally");
    }
    if (
      !deploy.includes("vars.ACCEPTANCE_AUTHORITY_PROFILES_JSON") ||
      deploy.includes("ACCEPTANCE_CALENDAR_CONTENT_AUTHORITY_PROFILE")
    ) {
      issues.push("authority profiles must use the generic protected mapping");
    }
    const secretIndex = deploy.indexOf("secrets.ACCEPTANCE_NEON_API_KEY");
    const verifyIndex = deploy.indexOf(
      "Verify every artifact provenance before credentials",
    );
    if (secretIndex === -1 || secretIndex < verifyIndex) {
      issues.push(
        "deployment credential must enter only after artifact verification",
      );
    }
    if (
      /working-directory:\s+candidate|pnpm\s+(?:run\s+)?(?:build|install)|npm\s+(?:run\s+)?build/.test(
        deploy.slice(secretIndex),
      )
    ) {
      issues.push(
        "candidate or dependency scripts must not run after credentials enter",
      );
    }
  }

  if (count(source, /secrets\.ACCEPTANCE_NETLIFY_AUTH_TOKEN/g) !== 2) {
    issues.push(
      "acceptance Netlify credential must appear only in hosted-runner and interruption-cleanup steps",
    );
  }
  if (
    count(source, /secrets\.ACCEPTANCE_NEON_API_KEY/g) !== 2 ||
    count(source, /secrets\.ACCEPTANCE_OPENROUTER_API_KEY/g) !== 2
  ) {
    issues.push(
      "provider authority credentials must appear only in acquire and revoke",
    );
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
  if (
    !source.includes("DEPLOY_REQUESTED: ${{ inputs.deploy }}") ||
    !source.includes('if [[ "$DEPLOY_REQUESTED" != "true" ]]')
  ) {
    issues.push(
      "rollback may allow disabled planning only when no deployment is requested",
    );
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
  if (
    !source.includes("CONFIG_FILE: scripts/trusted-acceptance-workspaces.json")
  ) {
    issues.push(
      "workflow must use the guarded runtime-authority configuration",
    );
  }

  return { ok: issues.length === 0, issues };
}

export function validateTrustedAcceptanceReaper(
  source: string,
): WorkflowGuardResult {
  const issues: string[] = [];
  if (!source.includes("workflow_dispatch:") || !source.includes("schedule:"))
    issues.push("reaper must support manual and scheduled recovery");
  if (/pull_request:|path:\s+candidate/.test(source))
    issues.push("reaper must never execute candidate-controlled code");
  if (!source.includes('RUN_REF" != "refs/heads/main"'))
    issues.push("reaper must fail closed unless dispatched from main");
  if (!source.includes("ref: ${{ github.sha }}"))
    issues.push("reaper must pin trusted code to the dispatch SHA");
  if (!source.includes("environment: trusted-acceptance"))
    issues.push("reaper must use the protected acceptance environment");
  if (
    !source.includes("matrix: ${{ fromJSON(needs.plan.outputs.matrix) }}") ||
    !source.includes("group: trusted-acceptance-${{ matrix.workspace }}") ||
    !source.includes("cancel-in-progress: false")
  )
    issues.push("reaper must serialize against each acceptance workspace");
  if (
    !source.includes("vars.ACCEPTANCE_AUTHORITY_PROFILES_JSON") ||
    source.includes("ACCEPTANCE_CALENDAR_CONTENT_AUTHORITY_PROFILE")
  )
    issues.push("reaper must use the generic protected profile mapping");
  if (!source.includes("controller.ts reap"))
    issues.push("reaper must invoke the trusted runtime-authority controller");
  return { ok: issues.length === 0, issues };
}

function main(): void {
  const workflow = readFileSync(
    ".github/workflows/trusted-acceptance.yml",
    "utf8",
  );
  const result = validateTrustedAcceptanceWorkflow(workflow);
  const reaper = validateTrustedAcceptanceReaper(
    readFileSync(".github/workflows/trusted-acceptance-reaper.yml", "utf8"),
  );
  if (!reaper.ok) {
    result.ok = false;
    result.issues.push(...reaper.issues);
  }
  const config = JSON.parse(
    readFileSync("scripts/trusted-acceptance-workspaces.json", "utf8"),
  ) as {
    workspaces?: Array<{
      enabled?: boolean;
      runtimeAuthority?: {
        lifecycle?: string;
        provisioner?: { kind?: string; profileMapVariable?: string };
      };
    }>;
  };
  const authority = validateRuntimeAuthorityConfiguration(config.workspaces);
  if (!authority.ok) {
    result.ok = false;
    result.issues.push(...authority.issues);
  }
  if (!result.ok) {
    for (const issue of result.issues)
      console.error(`[trusted-acceptance] ${issue}`);
    process.exitCode = 1;
    return;
  }
  console.log("Trusted acceptance workflow boundary checks passed.");
}

if (process.argv[1]?.endsWith("guard-trusted-acceptance-workflow.ts")) main();
