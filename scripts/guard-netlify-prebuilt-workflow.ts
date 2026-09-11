import { readdirSync, readFileSync } from "node:fs";

import { parse } from "yaml";

const reusablePath = ".github/workflows/deploy-netlify-prebuilt.yml";
const clipsNetlifyPath = "templates/clips/netlify.toml";
const crmNetlifyPath = "templates/crm/netlify.toml";
const chatNetlifyPath = "templates/chat/netlify.toml";
const productionPath = ".github/workflows/deploy-production-sites-prebuilt.yml";
const betaPath = ".github/workflows/deploy-beta-sites-prebuilt.yml";
const pullRequestPath = ".github/workflows/deploy-netlify-pr-previews.yml";
const docsProductionPath = ".github/workflows/deploy-docs-production.yml";
const manageProductionPath = ".github/workflows/manage-production-sites.yml";
const promotePath = ".github/workflows/promote-netlify-deploy.yml";

// promote /restore locks the site, and prebuilt unlock/upload is not atomic;
// all three production lanes must therefore share one per-site queue.
export const PRODUCTION_SITE_GROUP =
  "agent-native-production-site-${{ matrix.site }}";
export const PUBLISHED_CACHE_PURGE_CONDITION =
  "(inputs.target == 'production' || inputs.target == 'beta') && inputs.deploy && inputs.deploy_mode == 'production' && (inputs.target != 'beta' || steps.beta_freshness.outputs.current == 'true') && success()";

const reusable = readFileSync(reusablePath, "utf8");
const clipsNetlify = readFileSync(clipsNetlifyPath, "utf8");
const crmNetlify = readFileSync(crmNetlifyPath, "utf8");
const chatNetlify = readFileSync(chatNetlifyPath, "utf8");
const production = readFileSync(productionPath, "utf8");
const beta = readFileSync(betaPath, "utf8");
const pullRequest = readFileSync(pullRequestPath, "utf8");
const docsProduction = readFileSync(docsProductionPath, "utf8");
const manageProduction = readFileSync(manageProductionPath, "utf8");
const promote = readFileSync(promotePath, "utf8");

const issues: string[] = [];
const parsedWorkflows = new Map<string, Record<string, unknown>>();

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const githubScript = (job: Record<string, unknown>): string => {
  const step = (Array.isArray(job.steps) ? job.steps : [])
    .map(asRecord)
    .find((candidate) => {
      const script = asRecord(candidate?.with)?.script;
      return (
        typeof script === "string" &&
        script.includes("github.rest.repos.createDeployment")
      );
    });
  return String(asRecord(step?.with)?.script ?? "");
};

const callOptions = (script: string, call: string): string => {
  const start = script.indexOf(`github.rest.repos.${call}({`);
  if (start < 0) return "";
  const bodyStart = start + `github.rest.repos.${call}({`.length;
  let depth = 1;
  for (let index = bodyStart; index < script.length; index += 1) {
    if (script[index] === "{") depth += 1;
    if (script[index] === "}") depth -= 1;
    if (depth === 0) return script.slice(bodyStart, index);
  }
  return "";
};

export function validateReusableWorkflowConcurrency(
  workflow: Record<string, unknown>,
): string[] {
  const group = asRecord(workflow.concurrency)?.group;
  if (
    typeof group !== "string" ||
    !group.includes("inputs.caller") ||
    !group.includes("netlify-prebuilt-child") ||
    !group.includes("netlify-prebuilt-preview-{0}-{1}") ||
    !group.includes("netlify-prebuilt-beta-{0}") ||
    !group.includes("netlify-prebuilt-beta-direct") ||
    !group.includes("agent-native-release-migrations") ||
    !group.includes("inputs.target") ||
    !group.includes("inputs.site") ||
    !group.includes("agent-native-production-site") ||
    !group.includes("github.event_name")
  ) {
    return [
      "reusable Netlify workflow must serialize beta publishers per site and isolate direct beta dispatches",
    ];
  }
  return [];
}

export function validateReusableWorkflowPermissions(
  workflow: Record<string, unknown>,
): string[] {
  const permissions = asRecord(workflow.permissions);
  if (
    permissions?.contents !== "read" ||
    Object.keys(permissions ?? {}).some(
      (permission) => permission !== "contents",
    )
  ) {
    return [
      `${reusablePath} must declare only the read permissions used by the reusable deploy job`,
    ];
  }
  return [];
}

export function validateReusableCallerPermissions(
  workflow: Record<string, unknown>,
  path: string,
): string[] {
  const issues: string[] = [];
  const workflowPermissions = asRecord(workflow.permissions);
  for (const [jobName, value] of Object.entries(
    asRecord(workflow.jobs) ?? {},
  )) {
    const job = asRecord(value);
    if (job?.uses !== `./${reusablePath}`) continue;
    const permissions = asRecord(job.permissions) ?? workflowPermissions;
    if (
      !permissions ||
      (permissions.contents !== "read" && permissions.contents !== "write")
    ) {
      issues.push(
        `${path} ${jobName} reusable deploy job must explicitly retain contents access`,
      );
    }
  }
  return issues;
}

export function validateReusablePreviewRecordPlacement(
  workflow: Record<string, unknown>,
): string[] {
  const deploy = asRecord(asRecord(workflow.jobs)?.deploy);
  const steps = Array.isArray(deploy?.steps) ? deploy.steps.map(asRecord) : [];
  const stepIndex = (name: string) =>
    steps.findIndex((step) => step?.name === name);
  const recordIndex = stepIndex("Prepare the trusted PR preview deploy record");
  const previewSmokeIndex = stepIndex("Smoke-test the uploaded PR preview");
  const docsSmokeIndex = stepIndex("Smoke-test the static docs deploy");
  if (
    recordIndex < 0 ||
    previewSmokeIndex < 0 ||
    docsSmokeIndex < 0 ||
    recordIndex <= Math.max(previewSmokeIndex, docsSmokeIndex)
  ) {
    return [
      `${reusablePath} must publish PR preview records only after every preview smoke check`,
    ];
  }
  return [];
}

export function validatePublishedCachePurgeCondition(
  ifValue: unknown,
): string[] {
  const normalized =
    typeof ifValue === "string" ? ifValue.trim().replace(/\s+/g, " ") : "";
  if (normalized !== PUBLISHED_CACHE_PURGE_CONDITION) {
    return [
      `${reusablePath} published cache purge must run only after a successful beta or production deploy`,
    ];
  }
  return [];
}

export function validateProductionSiteConcurrency(workflows: {
  production: Record<string, unknown>;
  manage: Record<string, unknown>;
  promote: Record<string, unknown>;
}): string[] {
  const issues: string[] = [];
  const jobs = (workflow: Record<string, unknown>) => asRecord(workflow.jobs);
  const jobConcurrency = (workflow: Record<string, unknown>, jobName: string) =>
    asRecord(asRecord(jobs(workflow)?.[jobName])?.concurrency);

  for (const [path, workflow, jobName] of [
    [productionPath, workflows.production, "deploy"],
    [manageProductionPath, workflows.manage, "manage"],
    [promotePath, workflows.promote, "promote"],
  ] as const) {
    const concurrency = jobConcurrency(workflow, jobName);
    const group = concurrency?.group;
    if (group !== PRODUCTION_SITE_GROUP) {
      issues.push(
        `${path} ${jobName} job concurrency.group must equal ${PRODUCTION_SITE_GROUP}`,
      );
    }
    if (concurrency?.["cancel-in-progress"] !== false) {
      issues.push(
        `${path} ${jobName} job concurrency.cancel-in-progress must be false`,
      );
    }
  }

  return issues;
}

export function validateNetlifyPrPreviewWorkflow(
  workflow: Record<string, unknown>,
  source: string,
): string[] {
  const issues: string[] = [];
  const triggers = asRecord(workflow.on);
  const jobs = asRecord(workflow.jobs);
  const build = asRecord(jobs?.build);
  const buildWith = asRecord(build?.with);
  const buildPermissions = asRecord(build?.permissions);
  const discover = asRecord(jobs?.discover);
  const discoverCheckout = (
    (discover?.steps as Array<Record<string, unknown>> | undefined) ?? []
  ).find(
    (step) =>
      typeof step.uses === "string" &&
      step.uses.startsWith("actions/checkout@"),
  );
  const discoverCheckoutWith = asRecord(discoverCheckout?.with);
  const deploy = asRecord(jobs?.deploy);
  const deployWith = asRecord(deploy?.with);
  const deployment = asRecord(jobs?.deployment);
  const deploymentPermissions = asRecord(deployment?.permissions);
  const deploymentScript = githubScript(deployment ?? {});
  const createDeploymentOptions = callOptions(
    deploymentScript,
    "createDeployment",
  );
  const createDeploymentStatusOptions = callOptions(
    deploymentScript,
    "createDeploymentStatus",
  );

  if (!asRecord(triggers?.pull_request_target)) {
    issues.push(`${pullRequestPath} must be triggered by pull_request_target`);
  }
  if (asRecord(triggers?.pull_request) || source.includes("pull_request:")) {
    issues.push(`${pullRequestPath} must not use pull_request for previews`);
  }
  if (
    !source.includes(
      "github.event.pull_request.head.repo.full_name == github.repository",
    )
  ) {
    issues.push(
      `${pullRequestPath} must restrict deployment jobs to same-repository PRs`,
    );
  }
  if (deploy?.uses !== "./.github/workflows/deploy-netlify-prebuilt.yml") {
    issues.push(
      `${pullRequestPath} deploy job must call the reusable Netlify workflow`,
    );
  }
  if (build?.uses !== "./.github/workflows/deploy-netlify-prebuilt.yml") {
    issues.push(
      `${pullRequestPath} build job must call the reusable Netlify workflow`,
    );
  }
  if (
    discoverCheckoutWith?.ref !== "${{ github.event.pull_request.base.sha }}"
  ) {
    issues.push(
      `${pullRequestPath} discover job must load its helper from the trusted pull request base`,
    );
  }
  if (!source.includes('git fetch --no-tags origin "$HEAD_SHA"')) {
    issues.push(
      `${pullRequestPath} discover job must fetch the pull request head for its path diff`,
    );
  }
  if (buildWith?.target !== "preview" || buildWith?.deploy !== false) {
    issues.push(
      `${pullRequestPath} build job must build previews without deploying`,
    );
  }
  if (buildWith?.artifact_upload !== true || !buildWith?.artifact_name) {
    issues.push(
      `${pullRequestPath} build job must upload a named prebuilt artifact`,
    );
  }
  if (
    asRecord(build?.secrets) ||
    buildPermissions?.contents !== "read" ||
    Object.keys(buildPermissions ?? {}).some(
      (permission) => permission !== "contents",
    )
  ) {
    issues.push(
      `${pullRequestPath} PR build job must not receive deployment secrets`,
    );
  }
  if (
    !deployment ||
    deployment["runs-on"] !== "ubuntu-latest" ||
    !Array.isArray(deployment.needs) ||
    !deployment.needs.includes("deploy") ||
    deploymentPermissions?.actions !== "read" ||
    deploymentPermissions?.contents !== "read" ||
    deploymentPermissions?.deployments !== "write" ||
    Object.keys(deploymentPermissions ?? {}).some(
      (permission) =>
        !["actions", "contents", "deployments"].includes(permission),
    ) ||
    asRecord(jobs?.comment) ||
    !source.includes("actions/download-artifact@") ||
    !source.includes("actions/github-script@") ||
    !source.includes("listJobsForWorkflowRun") ||
    !source.includes("listWorkflowRunArtifacts") ||
    !source.includes("artifact-ids:") ||
    !source.includes("started_at") ||
    !source.includes("created_at") ||
    !source.includes("needs.deploy.result != 'cancelled'") ||
    !source.includes("continue-on-error: true") ||
    !source.includes("No successful deploy record") ||
    !createDeploymentOptions.includes("ref: process.env.SOURCE_REF") ||
    !createDeploymentOptions.includes("environment,") ||
    !createDeploymentOptions.includes("auto_merge: false") ||
    !createDeploymentOptions.includes("required_contexts: []") ||
    !createDeploymentOptions.includes("transient_environment: true") ||
    !createDeploymentStatusOptions.includes(
      "deployment_id: deployment.data.id",
    ) ||
    !createDeploymentStatusOptions.includes("state: 'success'") ||
    !createDeploymentStatusOptions.includes(
      "environment_url: record.deployUrl",
    ) ||
    !createDeploymentStatusOptions.includes("log_url:") ||
    !deploymentScript.includes(
      "const environment = `pr-${context.issue.number}-${record.siteName}`",
    ) ||
    source.includes("issues: write") ||
    source.includes("pull-requests: write") ||
    source.includes("createComment") ||
    source.includes("updateComment")
  ) {
    issues.push(
      `${pullRequestPath} deployment job must own deployment permissions and publish the trusted deploy record`,
    );
  }
  if (deployWith?.target !== "preview") {
    issues.push(`${pullRequestPath} deploy job must pass target=preview`);
  }
  if (deployWith?.build_context !== "deploy-preview") {
    issues.push(
      `${pullRequestPath} deploy job must pass build_context=deploy-preview`,
    );
  }
  if (deployWith?.deploy !== true || deployWith?.deploy_mode !== "draft") {
    issues.push(
      `${pullRequestPath} deploy job must upload draft prebuilt artifacts`,
    );
  }
  if (deployWith?.artifact_download !== true || !deployWith?.artifact_name) {
    issues.push(
      `${pullRequestPath} deploy job must download the prebuilt artifact`,
    );
  }
  if (
    deployWith?.checkout_ref !== "${{ github.event.pull_request.base.sha }}"
  ) {
    issues.push(
      `${pullRequestPath} deploy job must use the trusted pull request base checkout`,
    );
  }
  if (
    !Array.isArray(deploy?.needs) ||
    !deploy.needs.includes("discover") ||
    !deploy.needs.includes("build")
  ) {
    issues.push(
      `${pullRequestPath} deploy job must wait for discovery and the secret-free build`,
    );
  }
  if (
    !source.includes("needs.discover.outputs.has_targets == 'true'") ||
    !source.includes("has_targets: ${{ steps.targets.outputs.has_targets }}")
  ) {
    issues.push(
      `${pullRequestPath} must skip preview matrices with no buildable targets`,
    );
  }
  if (
    !source.includes("pull_request_number") ||
    !source.includes("preview_alias")
  ) {
    issues.push(
      `${pullRequestPath} must pass a PR number and stable preview alias`,
    );
  }
  if (!asRecord(jobs?.cleanup)) {
    issues.push(`${pullRequestPath} must define closed-PR preview cleanup`);
  }
  return issues;
}

export function validateGoogleCallbackVerificationWorkflow(
  workflow: string,
): string[] {
  const issues: string[] = [];
  const verifyStart = workflow.indexOf(
    "name: Verify Google OAuth redirect registration",
  );
  const rollbackStart = workflow.indexOf(
    "name: Roll back after Google callback verification failure",
    verifyStart,
  );
  const failStart = workflow.indexOf(
    "name: Fail after Google callback verification",
    rollbackStart,
  );
  const verify =
    verifyStart >= 0 && rollbackStart > verifyStart
      ? workflow.slice(verifyStart, rollbackStart)
      : "";
  const rollback =
    rollbackStart >= 0 && failStart > rollbackStart
      ? workflow.slice(rollbackStart, failStart)
      : "";

  if (!verify) {
    issues.push(
      `${reusablePath} must verify Google OAuth after publishing a deploy`,
    );
  } else {
    if (
      !verify.includes(
        "node --experimental-strip-types scripts/check-google-redirect-uris.ts",
      )
    ) {
      issues.push(
        `${reusablePath} Google OAuth verification must run the probe directly with the supported Node loader`,
      );
    }
    if (verify.includes("pnpm check:google-redirect-uris")) {
      issues.push(
        `${reusablePath} Google OAuth verification must not depend on a package-script indirection`,
      );
    }
    if (verify.includes("source_template != 'macros'")) {
      issues.push(
        `${reusablePath} Google OAuth verification must use the deployed capability contract instead of a template allowlist`,
      );
    }
  }

  if (
    !rollback ||
    !rollback.includes("steps.google_redirect.outcome == 'failure'") ||
    !rollback.includes("steps.google_redirect.outputs.exit_code == '1'")
  ) {
    issues.push(
      `${reusablePath} must roll back only definitive Google OAuth mismatches (exit code 1); inconclusive checks must not roll back`,
    );
  }
  return issues;
}

export function validateNetlifyApiRateLimitHandling(
  workflow: string,
): string[] {
  const issues: string[] = [];
  if (!workflow.includes("scripts/netlify-api-request.ts")) {
    issues.push(
      `${reusablePath} Netlify API calls must use the bounded rate-limit helper`,
    );
  }
  if (workflow.includes("fetch(")) {
    issues.push(
      `${reusablePath} must not make raw Netlify fetch calls outside the rate-limit helper`,
    );
  }
  return issues;
}

try {
  for (const [path, source] of [
    [reusablePath, reusable],
    [productionPath, production],
    [betaPath, beta],
    [pullRequestPath, pullRequest],
    [docsProductionPath, docsProduction],
    [manageProductionPath, manageProduction],
    [promotePath, promote],
  ] as const) {
    const document = asRecord(parse(source));
    if (!document) {
      throw new Error(`${path} must contain a YAML mapping at the root`);
    }
    parsedWorkflows.set(path, document);
  }
  for (const fileName of readdirSync(".github/workflows")) {
    if (!/\.ya?ml$/.test(fileName)) continue;
    const path = `.github/workflows/${fileName}`;
    if (parsedWorkflows.has(path)) continue;
    const source = readFileSync(path, "utf8");
    const document = asRecord(parse(source));
    if (!document) {
      throw new Error(`${path} must contain a YAML mapping at the root`);
    }
    const hasReusableCaller = Object.values(asRecord(document.jobs) ?? {}).some(
      (value) => asRecord(value)?.uses === `./${reusablePath}`,
    );
    if (!hasReusableCaller) continue;
    parsedWorkflows.set(path, document);
  }
  if (!reusable.includes("workflow_call:")) {
    issues.push(`${reusablePath} must remain a reusable workflow`);
  }
} catch (error) {
  issues.push(
    `Netlify prebuilt workflows must be valid YAML: ${String(error)}`,
  );
}

const reusableDocument = parsedWorkflows.get(reusablePath);
issues.push(...validateReusableWorkflowConcurrency(reusableDocument ?? {}));
issues.push(...validateReusableWorkflowPermissions(reusableDocument ?? {}));
issues.push(...validateReusablePreviewRecordPlacement(reusableDocument ?? {}));
for (const [path, workflow] of parsedWorkflows) {
  if (path === reusablePath) continue;
  issues.push(...validateReusableCallerPermissions(workflow, path));
}
issues.push(
  ...validateNetlifyPrPreviewWorkflow(
    parsedWorkflows.get(pullRequestPath) ?? {},
    pullRequest,
  ),
);

if (asRecord(reusableDocument?.concurrency)?.["cancel-in-progress"] !== false) {
  issues.push(
    `${reusablePath} beta child deploys must keep accepted publishers alive and coalesce pending sources`,
  );
}
const betaWorkflowConcurrency = asRecord(
  parsedWorkflows.get(betaPath)?.concurrency,
);
const betaWorkflowConcurrencyGroup = String(
  betaWorkflowConcurrency?.group ?? "",
);
if (
  !betaWorkflowConcurrencyGroup.includes(
    "github.event_name == 'workflow_dispatch'",
  ) ||
  !betaWorkflowConcurrencyGroup.includes(
    "format('deploy-agent-native-beta-manual-{0}', github.run_id)",
  ) ||
  !betaWorkflowConcurrencyGroup.includes(
    "'deploy-agent-native-beta-sites-prebuilt'",
  ) ||
  betaWorkflowConcurrency?.["cancel-in-progress"] !== false
) {
  issues.push(
    `${betaPath} must isolate manual validation from the automatic beta publisher queue`,
  );
}
const reusableDeployJobConfig = asRecord(
  asRecord(reusableDocument?.jobs)?.deploy,
);
if (reusableDeployJobConfig?.["timeout-minutes"] !== 150) {
  issues.push(
    `${reusablePath} must reserve cleanup time after the Netlify publish wait`,
  );
}
const reusableConcurrencyGroup = String(
  asRecord(reusableDocument?.concurrency)?.group ?? "",
);
const normalizedReusableConcurrencyGroup = reusableConcurrencyGroup.replace(
  /\s+/g,
  " ",
);
if (
  !normalizedReusableConcurrencyGroup.includes(
    "inputs.target == 'beta' && format('netlify-prebuilt-beta-{0}', inputs.site)",
  ) ||
  !normalizedReusableConcurrencyGroup.includes(
    "github.event_name == 'workflow_dispatch'",
  ) ||
  !normalizedReusableConcurrencyGroup.includes("!inputs.caller") ||
  !normalizedReusableConcurrencyGroup.includes(
    "format('netlify-prebuilt-beta-direct-{0}-{1}', inputs.site, github.run_id)",
  )
) {
  issues.push(
    `${reusablePath} beta publishes must share one latest-wins child queue per site`,
  );
}

const productionConcurrency = asRecord(
  parsedWorkflows.get(productionPath)?.concurrency,
);
if (
  typeof productionConcurrency?.group !== "string" ||
  !productionConcurrency.group.includes("agent-native-production-fleet")
) {
  issues.push(
    `${productionPath} must keep fleet runs in a dedicated production queue`,
  );
}
const docsProductionDocument = parsedWorkflows.get(docsProductionPath);
const docsProductionConcurrency = asRecord(docsProductionDocument?.concurrency);
if (
  docsProductionConcurrency?.group !== "agent-native-docs-production" ||
  docsProductionConcurrency["cancel-in-progress"] !== false
) {
  issues.push(
    `${docsProductionPath} must keep its path-filtered production queue independent`,
  );
}
const docsProductionJobs = asRecord(docsProductionDocument?.jobs);
for (const jobName of ["pause-netlify-builds", "restore-netlify-builds"]) {
  const concurrency = asRecord(
    asRecord(docsProductionJobs?.[jobName])?.concurrency,
  );
  if (
    concurrency?.group !== "agent-native-production-site-fw" ||
    concurrency?.["cancel-in-progress"] !== false
  ) {
    issues.push(
      `${docsProductionPath} ${jobName} must share the fw production site queue without cancellation`,
    );
  }
}
const docsPauseJob = asRecord(docsProductionJobs?.["pause-netlify-builds"]);
const docsRestoreJob = asRecord(docsProductionJobs?.["restore-netlify-builds"]);
if (
  !asRecord(docsPauseJob?.outputs)?.cutover_acquired ||
  !asRecord(docsPauseJob?.outputs)?.was_stopped ||
  typeof docsRestoreJob?.if !== "string" ||
  !docsRestoreJob.if.includes("always()") ||
  !String(docsRestoreJob.needs).includes("pause-netlify-builds") ||
  !docsProduction.includes("stop_builds: false") ||
  !docsProduction.includes(
    "needs.pause-netlify-builds.outputs.cutover_acquired",
  )
) {
  issues.push(
    `${docsProductionPath} must restore the prior Git-connected build setting after every pause attempt`,
  );
}

const buildStepStart = reusable.indexOf(
  "name: Build with the Netlify project configuration",
);
const buildStepEnd = reusable.indexOf(
  "name: Verify deploy directories",
  buildStepStart,
);
const clipsBuild =
  buildStepStart >= 0 && buildStepEnd > buildStepStart
    ? reusable.slice(buildStepStart, buildStepEnd)
    : "";
const hasOfflineSecretFreePreviewBuild =
  clipsBuild.includes(
    'if [[ "$TARGET" == "preview" && "$DEPLOY" != "true" ]]; then',
  ) &&
  clipsBuild.includes("build_args+=(--offline)") &&
  clipsBuild.includes('netlify "${build_args[@]}"');
if (!hasOfflineSecretFreePreviewBuild) {
  issues.push(
    `${reusablePath} must use Netlify offline mode for the secret-free PR build`,
  );
}
if (reusable.includes("--allow-missing-health")) {
  issues.push(
    `${reusablePath} must require strict database health for every PR preview`,
  );
}
const hasChatBuildOverride =
  clipsBuild.includes(
    'if [[ ( "$TARGET" == "beta" || "$TARGET" == "production" || "$TARGET" == "preview" ) && "$SOURCE_TEMPLATE" == "chat" ]];',
  ) &&
  chatNetlify.includes("agentNativePrebuiltBuild") &&
  chatNetlify.includes("agentNativePrebuiltDatabaseUrl") &&
  chatNetlify.includes("agentNativePrebuiltAuthSecret");
if (!hasChatBuildOverride) {
  issues.push(
    `${reusablePath} and ${chatNetlifyPath} must provide beta, production, and PR preview Chat build-only overrides for masked Netlify secrets`,
  );
}
const hasClipsAndPlanBuildOverride = clipsBuild.includes(
  '[[ "$SOURCE_TEMPLATE" == "clips" || "$SOURCE_TEMPLATE" == "plan" ]]',
);
const hasCrmBuildOverride = clipsBuild.includes(
  '[[ "$SOURCE_TEMPLATE" == "crm" ]]',
);
if (
  !hasClipsAndPlanBuildOverride ||
  !hasCrmBuildOverride ||
  !clipsBuild.includes("agentNativePrebuiltBuild=true") ||
  !clipsBuild.includes("agentNativePrebuiltDatabaseUrl=") ||
  !clipsBuild.includes("agentNativePrebuiltAuthSecret=") ||
  !clipsNetlify.includes("agentNativePrebuiltBuild") ||
  !clipsNetlify.includes("agentNativePrebuiltDatabaseUrl") ||
  !clipsNetlify.includes("agentNativePrebuiltAuthSecret") ||
  !/agentNativePrebuiltBuild:-\}.*!= \\"true\\".*migrate:production/.test(
    clipsNetlify,
  ) ||
  !crmNetlify.includes("agentNativePrebuiltBuild") ||
  !crmNetlify.includes("agentNativePrebuiltDatabaseUrl") ||
  !crmNetlify.includes("agentNativePrebuiltAuthSecret") ||
  !/agentNativePrebuiltBuild:-\}.*!= \\"true\\".*migrate:production/.test(
    crmNetlify,
  )
) {
  issues.push(
    `${reusablePath} must provide Clips, Plan, and CRM build-only env overrides without running production migrations`,
  );
}
const manageConcurrency = asRecord(
  parsedWorkflows.get(manageProductionPath)?.concurrency,
);
if (
  typeof manageConcurrency?.group !== "string" ||
  !manageConcurrency.group.includes("agent-native-production-manager")
) {
  issues.push(
    `${manageProductionPath} must use a manager-specific production queue`,
  );
}
const promoteConcurrency = asRecord(
  parsedWorkflows.get(promotePath)?.concurrency,
);
if (
  typeof promoteConcurrency?.group !== "string" ||
  !promoteConcurrency.group.includes("agent-native-production-promote")
) {
  issues.push(`${promotePath} must use a promotion-specific production queue`);
}
issues.push(
  ...validateProductionSiteConcurrency({
    production: parsedWorkflows.get(productionPath) ?? {},
    manage: parsedWorkflows.get(manageProductionPath) ?? {},
    promote: parsedWorkflows.get(promotePath) ?? {},
  }),
);

const reusableOn = asRecord(reusableDocument?.on);
const workflowCall = asRecord(reusableOn?.workflow_call);
const workflowCallInputs = asRecord(workflowCall?.inputs);
for (const input of [
  "target",
  "site",
  "build_context",
  "deploy",
  "deploy_mode",
  "smoke",
  "caller",
  "migration_only",
  "skip_build_migrations",
]) {
  if (!asRecord(workflowCallInputs?.[input])) {
    issues.push(`${reusablePath} workflow_call must define the ${input} input`);
  }
}

const reusableDeployJob = asRecord(asRecord(reusableDocument?.jobs)?.deploy);
const reusableSteps = Array.isArray(reusableDeployJob?.steps)
  ? reusableDeployJob.steps.map(asRecord)
  : [];
const parsedStepIndex = (name: string) =>
  reusableSteps.findIndex((step) => step?.name === name);
const parsedPauseIndex = parsedStepIndex(
  "Pause automatic Netlify builds for production cutover",
);
const parsedClipsMigrationIndex = parsedStepIndex(
  "Run Clips release migrations",
);
const parsedCrmMigrationIndex = parsedStepIndex("Run CRM release migrations");
const parsedUnlockIndex = parsedStepIndex(
  "Unlock the published production deploy",
);
const parsedUploadIndex = parsedStepIndex("Upload the prebuilt deploy");
const parsedPublishWaitIndex = parsedStepIndex(
  "Wait for the Netlify deploy to publish",
);
const parsedPurgeIndex = parsedStepIndex("Purge the published Netlify cache");
const parsedLockIndex = parsedStepIndex("Lock the published production deploy");
const parsedResumeIndex = parsedStepIndex(
  "Resume automatic Netlify builds after production cutover",
);
const parsedCleanupIndex = parsedStepIndex(
  "Restore the production deploy lock after a failed cutover",
);
issues.push(...validateGoogleCallbackVerificationWorkflow(reusable));
issues.push(...validateNetlifyApiRateLimitHandling(reusable));
const parsedClipsMigrationIf = reusableSteps[parsedClipsMigrationIndex]?.if;
if (
  parsedClipsMigrationIndex < 0 ||
  typeof parsedClipsMigrationIf !== "string" ||
  !parsedClipsMigrationIf.includes("inputs.target == 'production'") ||
  !parsedClipsMigrationIf.includes("inputs.deploy") ||
  !parsedClipsMigrationIf.includes("inputs.deploy_mode == 'production'") ||
  !parsedClipsMigrationIf.includes("source_template == 'clips'") ||
  !reusable.includes("CLIPS_DATABASE_URL")
) {
  issues.push(
    `${reusablePath} must run Clips release migrations against CLIPS_DATABASE_URL before a production prebuilt deploy`,
  );
}
if (
  parsedCrmMigrationIndex < 0 ||
  parsedCrmMigrationIndex <= parsedPauseIndex ||
  parsedCrmMigrationIndex >= parsedUnlockIndex
) {
  issues.push(
    `${reusablePath} must pause automatic Netlify builds before running CRM release migrations`,
  );
}
if (
  parsedPauseIndex < 0 ||
  parsedUnlockIndex < 0 ||
  parsedUploadIndex < 0 ||
  parsedPublishWaitIndex < 0 ||
  parsedPurgeIndex < 0 ||
  parsedLockIndex < 0 ||
  parsedResumeIndex < 0 ||
  parsedCleanupIndex < 0
) {
  issues.push(
    `${reusablePath} must define pause, unlock, upload, publish-wait, lock, resume, and failure-cleanup steps in parsed YAML`,
  );
} else if (
  parsedPauseIndex >= parsedUnlockIndex ||
  parsedUnlockIndex >= parsedUploadIndex ||
  parsedUploadIndex >= parsedPublishWaitIndex ||
  parsedPublishWaitIndex >= parsedPurgeIndex ||
  parsedPurgeIndex >= parsedLockIndex ||
  parsedLockIndex >= parsedResumeIndex ||
  parsedResumeIndex >= parsedCleanupIndex
) {
  issues.push(
    `${reusablePath} parsed YAML steps must order unlock before upload before publish-wait before purge before lock before resume before cleanup`,
  );
}
const parsedUnlockIf = reusableSteps[parsedUnlockIndex]?.if;
if (
  typeof parsedUnlockIf !== "string" ||
  !parsedUnlockIf.includes("inputs.target == 'production'") ||
  !parsedUnlockIf.includes("inputs.deploy") ||
  !parsedUnlockIf.includes("inputs.deploy_mode == 'production'")
) {
  issues.push(
    `${reusablePath} must restrict the production unlock step to production uploads`,
  );
}
const parsedResumeIf = reusableSteps[parsedResumeIndex]?.if;
if (
  typeof parsedResumeIf !== "string" ||
  !parsedResumeIf.includes("inputs.target == 'production'") ||
  !parsedResumeIf.includes("inputs.deploy") ||
  !parsedResumeIf.includes("inputs.deploy_mode == 'production'") ||
  !parsedResumeIf.includes("always()")
) {
  issues.push(
    `${reusablePath} must always attempt automatic-build restoration after a production cutover`,
  );
}
issues.push(
  ...validatePublishedCachePurgeCondition(reusableSteps[parsedPurgeIndex]?.if),
);

const uploadStart = reusable.indexOf("name: Upload the prebuilt deploy");
const uploadEnd = reusable.indexOf(
  "name: Wait for the Netlify deploy to publish",
  uploadStart,
);
const purgeStart = reusable.indexOf("name: Purge the published Netlify cache");
const purgeEnd = reusable.indexOf(
  "name: Lock the published production deploy",
  purgeStart,
);
const unlockStart = reusable.indexOf(
  "name: Unlock the published production deploy",
);
if (unlockStart < 0 || (uploadStart >= 0 && unlockStart >= uploadStart)) {
  issues.push(
    `${reusablePath} must unlock the published deploy before a production upload`,
  );
} else {
  const unlock = reusable.slice(unlockStart, uploadStart);
  if (
    !unlock.includes("/unlock") ||
    !unlock.includes("locked !== false") ||
    !unlock.includes("/deploys?per_page=100&production=true&state=") ||
    !unlock.includes("nextPageUrl") ||
    !unlock.includes("ACTIVE_PRODUCTION_DEPLOY_STATES") ||
    !unlock.includes('"pending"') ||
    !unlock.includes('"uploaded"') ||
    !unlock.includes('"prepared"') ||
    !unlock.includes('"processed"') ||
    !unlock.includes('"pending_review"') ||
    !unlock.includes('"accepted"') ||
    !unlock.includes('"retrying"') ||
    !unlock.includes("encodeURIComponent(state)") ||
    !unlock.includes("production=true") ||
    !unlock.includes("Promise.all(states.map") ||
    !unlock.includes(
      '["error", "canceled", "rejected"].includes(candidate.state)',
    ) ||
    !unlock.includes("const preexistingDeployIds = new Set") ||
    !unlock.includes("preexistingDeployIds.has(candidate.id)") ||
    !unlock.includes('candidate.state !== "ready"') ||
    (
      unlock.match(/drainPendingDeploys\(deployId, preexistingDeployIds\)/g) ??
      []
    ).length < 2 ||
    !unlock.includes("candidate.published_at") ||
    !unlock.includes("Netlify pre-existing production ready deploy lookup") ||
    !unlock.includes('["ready"]') ||
    !unlock.includes("finalBeforeUnlock") ||
    (
      unlock.match(
        /pendingProductionDeploys\([\s\S]*?publishedId,\s*preexistingDeployIds/g,
      ) ?? []
    ).length < 2
  ) {
    issues.push(
      `${reusablePath} production unlock must ignore pre-existing ready deploys and block ready deploys created during this run`,
    );
  }
  const baselineIndex = unlock.indexOf("const preexistingDeployIds = new Set");
  const siteLookupIndex = unlock.indexOf("const site = await readJson(");
  if (
    baselineIndex < 0 ||
    siteLookupIndex < 0 ||
    baselineIndex > siteLookupIndex
  ) {
    issues.push(
      `${reusablePath} must capture the ready production baseline before reading site/deploy state`,
    );
  }
}
if (purgeStart < 0 || purgeEnd <= purgeStart) {
  issues.push(
    `${reusablePath} must purge the published cache before locking the published deploy`,
  );
} else {
  const purge = reusable.slice(purgeStart, purgeEnd);
  if (
    !purge.includes('const api = "https://api.netlify.com/api/v1"') ||
    !purge.includes("requestNetlifyApi(`${api}/purge`") ||
    !purge.includes('method: "POST"') ||
    !purge.includes(
      "JSON.stringify({ site_id: process.env.NETLIFY_SITE_ID })",
    ) ||
    !purge.includes("response.ok")
  ) {
    issues.push(
      `${reusablePath} published cache purge must POST the site_id to Netlify and fail on a non-success response`,
    );
  }
}
const lockStart = reusable.indexOf(
  "name: Lock the published production deploy",
);
const pauseStart = reusable.indexOf(
  "name: Pause automatic Netlify builds for production cutover",
);
const cleanupStart = reusable.indexOf(
  "name: Restore the production deploy lock after a failed cutover",
);
if (
  pauseStart < 0 ||
  lockStart < 0 ||
  cleanupStart < 0 ||
  pauseStart >= unlockStart ||
  lockStart >= cleanupStart ||
  !reusable.slice(lockStart, cleanupStart).includes("/lock") ||
  !reusable.slice(lockStart, cleanupStart).includes("published_deploy") ||
  !reusable.slice(cleanupStart).includes("failure()") ||
  !reusable.slice(cleanupStart).includes("cutoverPublishedDeployId") ||
  !reusable.slice(cleanupStart).includes("cutoverNewDeployId") ||
  !reusable.slice(cleanupStart).includes("cutoverWasLocked") ||
  !reusable.slice(cleanupStart).includes("/lock") ||
  !reusable.slice(cleanupStart).includes("currentDeployId === newDeployId") ||
  !reusable.slice(cleanupStart).includes("newly published deploy")
) {
  issues.push(
    `${reusablePath} must pause automatic builds before cutover, lock the new published deploy, and fail-safe the production lock after cutover errors`,
  );
}
const pause = reusable.slice(pauseStart, unlockStart);
const cutoverAcquiredIndex = pause.indexOf("cutover_acquired=true");
const pauseVerificationIndex = pause.indexOf("await waitForBuildSetting");
if (
  !pause.includes("stop_builds") ||
  !pause.includes('method: "PATCH"') ||
  !pause.includes("was_stopped") ||
  cutoverAcquiredIndex < 0 ||
  pauseVerificationIndex <= cutoverAcquiredIndex
) {
  issues.push(
    `${reusablePath} production cutovers must record acquisition before fallible pause verification and preserve the prior stop_builds setting`,
  );
}
const cleanup = reusable.slice(cleanupStart);
if (!cleanup.includes("cutoverWasPaused") || cleanup.includes("stop_builds")) {
  issues.push(
    `${reusablePath} production cleanup must restore the prior automatic-build setting`,
  );
}
if (!cleanup.includes("!process.env.cutoverPublishedDeployId")) {
  issues.push(
    `${reusablePath} production cleanup must leave lock state unchanged without a recorded unlock state`,
  );
}
const resumeStart = reusable.indexOf(
  "name: Resume automatic Netlify builds after production cutover",
);
const noCutoverStateCheck = 'process.env.cutoverWasPaused !== "true"';
if (
  resumeStart < 0 ||
  !reusable.slice(resumeStart, cleanupStart).includes(noCutoverStateCheck)
) {
  issues.push(
    `${reusablePath} production resume must leave automatic builds unchanged when pause state was not acquired`,
  );
}
if (
  !cleanup.includes(noCutoverStateCheck) ||
  !cleanup.includes("!process.env.cutoverPublishedDeployId")
) {
  issues.push(
    `${reusablePath} production cleanup must leave lock state unchanged without a recorded unlock state`,
  );
}
if (uploadStart < 0 || uploadEnd <= uploadStart) {
  issues.push(
    `${reusablePath} must retain an ordered prebuilt upload step and publish-wait step`,
  );
} else {
  const upload = reusable.slice(uploadStart, uploadEnd);
  if (
    !/\bnetlify\s+deploy\b/.test(upload) ||
    !/(^|\s)--no-build(?:\s|$)/m.test(upload)
  ) {
    issues.push(
      `${reusablePath} upload step must invoke netlify deploy with --no-build`,
    );
  }
  if (/--context(?:\s|=|\)|$)/m.test(upload)) {
    issues.push(
      "prebuilt uploads must not pass --context with --no-build; the Netlify CLI rejects that combination",
    );
  }
}

for (const [path, target, buildContext] of [
  [productionPath, "production", "production"],
  [betaPath, "beta", "branch-deploy"],
] as const) {
  const document = parsedWorkflows.get(path);
  const deployJob = asRecord(asRecord(document?.jobs)?.deploy);
  const deployWith = asRecord(deployJob?.with);
  if (deployJob?.uses !== "./.github/workflows/deploy-netlify-prebuilt.yml") {
    issues.push(`${path} deploy job must call the reusable Netlify workflow`);
  }
  if (deployWith?.target !== target) {
    issues.push(`${path} deploy job must pass target=${target}`);
  }
  if (deployWith?.build_context !== buildContext) {
    issues.push(`${path} deploy job must pass build_context=${buildContext}`);
  }
  const expectedCaller =
    path === betaPath
      ? "${{ github.event_name == 'workflow_dispatch' && 'manual' || 'automatic' }}"
      : "fleet";
  if (deployWith?.caller !== expectedCaller) {
    issues.push(
      `${path} deploy job must explicitly select the reusable workflow child queue`,
    );
  }
  if (
    path === betaPath &&
    asRecord(deployJob?.strategy)?.["max-parallel"] !== 8
  ) {
    issues.push(`${path} must allow beta artifact builds to run concurrently`);
  }
}

const betaMigrateJob = asRecord(
  asRecord(parsedWorkflows.get(betaPath)?.jobs)?.migrate,
);
const betaResolveSourceJob = asRecord(
  asRecord(parsedWorkflows.get(betaPath)?.jobs)?.["resolve-source"],
);
const betaResolveSourceStep = (
  (betaResolveSourceJob?.steps as Array<Record<string, unknown>> | undefined) ??
  []
).find((step) => step.id === "source");
const betaResolveSourceScript = String(
  asRecord(betaResolveSourceStep?.with)?.script ?? "",
);
const betaDeployJob = asRecord(
  asRecord(parsedWorkflows.get(betaPath)?.jobs)?.deploy,
);
const betaSchemaGateJob = asRecord(
  asRecord(parsedWorkflows.get(betaPath)?.jobs)?.["schema-gate"],
);
const betaSchemaGateStep = (
  (betaSchemaGateJob?.steps as Array<Record<string, unknown>> | undefined) ?? []
).find(
  (step) =>
    step.name ===
    "Detect schema-dependent beta code without production migration",
);
const betaSchemaGateBlockStep = (
  (betaSchemaGateJob?.steps as Array<Record<string, unknown>> | undefined) ?? []
).find(
  (step) =>
    step.name === "Block schema-dependent beta code until production migration",
);
const betaMigrationMarkerStep = (
  (betaSchemaGateJob?.steps as Array<Record<string, unknown>> | undefined) ?? []
).find((step) => step.name === "Record pending beta migration marker");
const betaSchemaGateCheckoutStep = (
  (betaSchemaGateJob?.steps as Array<Record<string, unknown>> | undefined) ?? []
).find(
  (step) =>
    typeof step.uses === "string" && step.uses.startsWith("actions/checkout@"),
);
const betaDeployNeeds = Array.isArray(betaDeployJob?.needs)
  ? betaDeployJob.needs
  : [];
const productionMigrationMarkerJob = asRecord(
  asRecord(parsedWorkflows.get(productionPath)?.jobs)?.[
    "record-beta-migration"
  ],
);
const productionDiscoverJob = asRecord(
  asRecord(parsedWorkflows.get(productionPath)?.jobs)?.["discover-sites"],
);
const productionDiscoverOutputs = asRecord(productionDiscoverJob?.outputs);
const productionMigrationMarkerSteps =
  (productionMigrationMarkerJob?.steps as
    | Array<Record<string, unknown>>
    | undefined) ?? [];
if (betaMigrateJob || betaDeployNeeds.includes("migrate")) {
  issues.push(
    `${betaPath} must not run release migrations against masked beta site secrets`,
  );
}
if (
  asRecord(parsedWorkflows.get(betaPath)?.permissions)?.contents !== "write"
) {
  issues.push(`${betaPath} must write immutable migration markers`);
}
if (
  betaSchemaGateJob?.needs !== "resolve-source" ||
  typeof betaSchemaGateStep?.run !== "string" ||
  !betaSchemaGateStep.run.includes("migrated_source_sha") ||
  !betaSchemaGateStep.run.includes("base_sha_input") ||
  asRecord(betaSchemaGateStep.env)?.base_sha_input !==
    "${{ github.event.before }}" ||
  !betaSchemaGateStep.run.includes("git hash-object -t tree /dev/null") ||
  !betaSchemaGateStep.run.includes("git diff --name-only") ||
  !betaSchemaGateStep.run.includes(
    "git tag --list 'agent-native-beta-pending/*'",
  ) ||
  !betaSchemaGateStep.run.includes("agent-native-beta-migrated/*") ||
  !betaSchemaGateStep.run.includes("unresolved_pending_sha") ||
  !betaSchemaGateStep.run.includes("required_source_sha") ||
  !betaSchemaGateStep.run.includes("schema_files") ||
  !betaSchemaGateStep.run.includes("schema_files_between") ||
  !betaSchemaGateStep.run.includes("Ignoring obsolete beta migration marker") ||
  !betaSchemaGateStep.run.includes("local changed_files") ||
  !betaSchemaGateStep.run.includes('[[ "$status" -eq 0 ]]') ||
  !betaSchemaGateStep.run.includes("pending_schema_files=") ||
  !betaSchemaGateStep.run.includes('latest_migrated_sha" "$pending_sha') ||
  betaSchemaGateStep.run.includes("packages/core/src/db/|") ||
  asRecord(betaSchemaGateCheckoutStep?.with)?.["fetch-depth"] !== 0 ||
  typeof betaSchemaGateBlockStep?.run !== "string" ||
  !betaSchemaGateBlockStep.run.includes("required_source_sha") ||
  typeof betaMigrationMarkerStep?.with !== "object" ||
  !String(betaSchemaGateStep.run).includes(
    "No production-owned migration marker exists",
  ) ||
  !String(betaMigrationMarkerStep.if).includes("record_pending") ||
  !String(asRecord(betaMigrationMarkerStep.with)?.script).includes(
    "Concurrent beta pending marker",
  ) ||
  !String(asRecord(betaMigrationMarkerStep.with)?.script).includes(
    "createRef",
  ) ||
  !betaDeployNeeds.includes("schema-gate")
) {
  issues.push(
    `${betaPath} must block schema-dependent beta code until production migration is confirmed`,
  );
}

const reusableBetaFreshness = reusable;
const firstBetaPublishStart = reusableBetaFreshness.indexOf(
  "name: Publish first beta deploy after freshness verification",
);
const firstBetaPublishEnd = reusableBetaFreshness.indexOf(
  "name: Verify beta source is current after publish",
  firstBetaPublishStart,
);
const firstBetaPublish =
  firstBetaPublishStart >= 0 && firstBetaPublishEnd > firstBetaPublishStart
    ? reusableBetaFreshness.slice(firstBetaPublishStart, firstBetaPublishEnd)
    : "";
if (
  reusableBetaFreshness.includes("allowPinnedRecovery") ||
  !reusableBetaFreshness.includes(
    "Beta source_ref must be a full 40-character commit SHA.",
  ) ||
  !reusableBetaFreshness.includes("Beta source_ref must equal current main") ||
  !reusableBetaFreshness.includes(
    "Direct beta dispatch is unsupported; use deploy-beta-sites-prebuilt.yml.",
  ) ||
  !reusableBetaFreshness.includes(
    "Netlify beta site has no published deploy",
  ) ||
  !reusableBetaFreshness.includes(
    "Uploading the first beta deploy as a draft until its source is revalidated.",
  ) ||
  !reusableBetaFreshness.includes(
    "Verify first beta deploy source immediately before publish",
  ) ||
  !reusableBetaFreshness.includes(
    "Publish first beta deploy after freshness verification",
  ) ||
  !firstBetaPublish.includes("id: beta_first_publish") ||
  !firstBetaPublish.includes("--prod") ||
  firstBetaPublish.includes("/restore") ||
  !firstBetaPublish.includes(
    "Wait for first beta production deploy to publish",
  ) ||
  !firstBetaPublish.includes("id: beta_first_publish_wait") ||
  !firstBetaPublish.includes("Netlify first beta production deploy status") ||
  !firstBetaPublish.includes(
    "did not become ready and published within 30 minutes",
  ) ||
  !firstBetaPublish.includes("main_sha,,}") ||
  !firstBetaPublish.includes("SOURCE_REF,,}") ||
  !reusableBetaFreshness.includes("id: beta_first_publish_reconcile") ||
  !reusableBetaFreshness.includes(
    "steps.beta_first_publish.outputs.deploy_id || steps.beta_first_publish_reconcile.outputs.deploy_id",
  ) ||
  !reusableBetaFreshness.includes("Recovered first beta production deploy") ||
  !reusableBetaFreshness.includes("Netlify published unrelated deploy") ||
  reusableBetaFreshness.includes(
    "DEPLOY_ID: ${{ steps.beta_first_publish.outputs.deploy_id || steps.deploy.outputs.deploy_id }}",
  ) ||
  !reusableBetaFreshness.includes("Delete staged first beta draft") ||
  !reusableBetaFreshness.includes("id: beta_draft_cleanup") ||
  !reusableBetaFreshness.includes("DRAFT_DEPLOY_ID") ||
  !reusableBetaFreshness.includes(
    "Netlify staged beta draft ${draftId} deletion",
  ) ||
  !reusableBetaFreshness.includes(
    "Refusing to delete staged beta draft ${draftId} because Netlify published it.",
  ) ||
  !reusableBetaFreshness.includes("cancellationDeadline") ||
  !reusableBetaFreshness.includes(
    "staged beta draft ${draftId} cancellation status",
  ) ||
  !reusableBetaFreshness.includes(
    "Canceled and deleted staged beta draft ${draftId}.",
  ) ||
  !reusableBetaFreshness.includes(
    "did not become terminal after cancellation",
  ) ||
  !reusableBetaFreshness.includes(
    "DEPLOY_URL: ${{ steps.beta_first_publish.outputs.deploy_url || steps.beta_first_publish_reconcile.outputs.deploy_url || (steps.previous.outputs.published_deploy_id != '' && steps.deploy.outputs.deploy_url) }}",
  ) ||
  !reusableBetaFreshness.includes(
    "First publishes are staged as drafts and only published after a current-main check",
  ) ||
  reusableBetaFreshness.includes("requested || 'beta'") ||
  !reusableBetaFreshness.includes(
    "Verify beta source is current immediately before upload",
  ) ||
  !reusableBetaFreshness.includes(
    "core.setOutput('current', String(current))",
  ) ||
  !reusableBetaFreshness.includes(
    "Verify beta source is current after publish",
  ) ||
  !reusableBetaFreshness.includes(
    "always() && inputs.target == 'beta' && inputs.deploy",
  ) ||
  !reusableBetaFreshness.includes("steps.deploy.outputs.deploy_id != ''") ||
  !reusableBetaFreshness.includes(
    "steps.beta_post_freshness.outputs.current == 'false'",
  ) ||
  !reusableBetaFreshness.includes(
    "steps.beta_post_freshness.outcome == 'failure'",
  ) ||
  !reusableBetaFreshness.includes(
    "steps.beta_first_publish_freshness.outcome == 'failure'",
  ) ||
  !reusableBetaFreshness.includes(
    "steps.beta_first_publish_freshness.outputs.current == 'false'",
  ) ||
  !reusableBetaFreshness.includes(
    "steps.beta_first_publish_wait.outcome == 'failure'",
  ) ||
  !reusableBetaFreshness.includes("id: deploy_wait") ||
  !reusableBetaFreshness.includes(
    "Netlify beta deploy ${process.env.DEPLOY_ID} was superseded by unrelated published deploy",
  ) ||
  !reusableBetaFreshness.includes("steps.deploy_wait.outcome == 'failure'") ||
  !reusableBetaFreshness.includes("Revert stale beta deploy") ||
  !reusableBetaFreshness.includes(
    "/sites/${siteId}/deploys/${previousId}/restore",
  ) ||
  !reusableBetaFreshness.includes("/deploys/${deployId}/cancel") ||
  !reusableBetaFreshness.includes("cancellationRequested") ||
  !reusableBetaFreshness.includes(
    "Netlify beta freshness restore precondition",
  ) ||
  !reusableBetaFreshness.includes("const restoredDeployId = restored?.id") ||
  !reusableBetaFreshness.includes(
    "current.published_deploy?.id === restoredDeployId",
  ) ||
  !reusableBetaFreshness.includes(
    "Keep this job in the per-site concurrency group until Netlify",
  ) ||
  !reusableBetaFreshness.includes("cancellationRejected") ||
  !reusableBetaFreshness.includes("deletionRequested") ||
  !reusableBetaFreshness.includes('method: "DELETE"') ||
  !reusableBetaFreshness.includes(
    "Netlify stale beta deploy ${deployId} deletion",
  ) ||
  !reusableBetaFreshness.includes("Fail after beta freshness verification") ||
  reusableBetaFreshness.includes(
    "did not settle before the five-minute cleanup deadline",
  ) ||
  !reusableBetaFreshness.includes("PREVIOUS_DEPLOY_ID") ||
  !reusableBetaFreshness.includes("const publishedDeployId") ||
  !reusableBetaFreshness.includes(
    "keeping the beta queue occupied until the stale deploy is non-publishable",
  ) ||
  !reusableBetaFreshness.includes(
    "steps.previous.outputs.published_deploy_id != ''",
  ) ||
  !reusableBetaFreshness.includes("TARGET: ${{ inputs.target }}") ||
  !reusableBetaFreshness.includes("PUBLISH_STARTED_AT") ||
  !reusableBetaFreshness.includes("DEPLOY_MESSAGE") ||
  !reusableBetaFreshness.includes(
    "first beta production deploy reconciliation",
  ) ||
  !reusableBetaFreshness.includes("Could not parse Netlify CLI output") ||
  !reusableBetaFreshness.includes("deploy.commit_ref")
) {
  issues.push(
    `${reusablePath} must reject stale beta sources before upload and revert accepted stale deploys`,
  );
}
if (
  !betaResolveSourceScript.includes(
    "context.eventName === 'workflow_dispatch'",
  ) ||
  !betaResolveSourceScript.includes(
    "sourceSha.toLowerCase() !== mainSha.toLowerCase()",
  ) ||
  !betaResolveSourceScript.includes(
    "Manual beta source_ref must equal current main",
  )
) {
  issues.push(`${betaPath} must reject stale manual source_ref values`);
}

if (
  productionDiscoverOutputs?.complete_fleet !==
    "${{ steps.matrix.outputs.complete_fleet }}" ||
  !(
    (productionDiscoverJob?.steps as
      | Array<Record<string, unknown>>
      | undefined) ?? []
  ).some(
    (step) =>
      typeof step.run === "string" &&
      step.run.includes("completeFleet") &&
      step.run.includes("productionNames") &&
      step.run.includes("productionNames.every") &&
      step.run.includes("names.includes(name)") &&
      step.run.includes("buildable.some") &&
      !step.run.includes("unsupported.length === 0"),
  ) ||
  !productionMigrationMarkerJob ||
  !String(productionMigrationMarkerJob.if).includes(
    "needs.discover-sites.outputs.complete_fleet == 'true'",
  ) ||
  !String(productionMigrationMarkerJob.if).includes(
    "needs.deploy.result == 'success'",
  ) ||
  !Array.isArray(productionMigrationMarkerJob.needs) ||
  !productionMigrationMarkerJob.needs.includes("resolve-source") ||
  !productionMigrationMarkerJob.needs.includes("discover-sites") ||
  !productionMigrationMarkerJob.needs.includes("deploy") ||
  asRecord(productionMigrationMarkerJob.permissions)?.contents !== "write" ||
  !productionMigrationMarkerSteps.some(
    (step) =>
      typeof step.with === "object" &&
      String(asRecord(step.with)?.script).includes(
        "agent-native-beta-migrated",
      ) &&
      String(asRecord(step.with)?.script).includes(
        "Concurrent production migration marker",
      ) &&
      String(asRecord(step.with)?.script).includes("createRef"),
  )
) {
  issues.push(
    `${productionPath} must create the beta migration marker only after a successful all-sites cutover`,
  );
}

if (issues.length) {
  for (const issue of issues) console.error(`::error::${issue}`);
  process.exit(1);
}

console.log(
  "Netlify prebuilt workflows preserve context and publish serialization.",
);
