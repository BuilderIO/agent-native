import { readFileSync } from "node:fs";

import { parse } from "yaml";

const reusablePath = ".github/workflows/deploy-netlify-prebuilt.yml";
const productionPath = ".github/workflows/deploy-production-sites-prebuilt.yml";
const betaPath = ".github/workflows/deploy-beta-sites-prebuilt.yml";
const manageProductionPath = ".github/workflows/manage-production-sites.yml";
const promotePath = ".github/workflows/promote-netlify-deploy.yml";

// promote /restore locks the site, and prebuilt unlock/upload is not atomic;
// all three production lanes must therefore share one per-site queue.
export const PRODUCTION_SITE_GROUP =
  "agent-native-production-site-${{ matrix.site }}";

const reusable = readFileSync(reusablePath, "utf8");
const production = readFileSync(productionPath, "utf8");
const beta = readFileSync(betaPath, "utf8");
const manageProduction = readFileSync(manageProductionPath, "utf8");
const promote = readFileSync(promotePath, "utf8");

const issues: string[] = [];
const parsedWorkflows = new Map<string, Record<string, unknown>>();

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

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

try {
  for (const [path, source] of [
    [reusablePath, reusable],
    [productionPath, production],
    [betaPath, beta],
    [manageProductionPath, manageProduction],
    [promotePath, promote],
  ] as const) {
    const document = asRecord(parse(source));
    if (!document) {
      throw new Error(`${path} must contain a YAML mapping at the root`);
    }
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
const reusableConcurrency = asRecord(reusableDocument?.concurrency);
const reusableGroup = reusableConcurrency?.group;
if (
  typeof reusableGroup !== "string" ||
  !reusableGroup.includes("inputs.target") ||
  !reusableGroup.includes("inputs.site") ||
  !reusableGroup.includes("agent-native-production-site")
) {
  issues.push(
    `${reusablePath} must serialize each target/site child without a dropping fleet-wide matrix queue`,
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
const parsedUnlockIndex = parsedStepIndex(
  "Unlock the published production deploy",
);
const parsedUploadIndex = parsedStepIndex("Upload the prebuilt deploy");
const parsedPublishWaitIndex = parsedStepIndex(
  "Wait for the Netlify deploy to publish",
);
const parsedLockIndex = parsedStepIndex("Lock the published production deploy");
const parsedCleanupIndex = parsedStepIndex(
  "Restore the production deploy lock after a failed cutover",
);
if (
  parsedUnlockIndex < 0 ||
  parsedUploadIndex < 0 ||
  parsedPublishWaitIndex < 0 ||
  parsedLockIndex < 0 ||
  parsedCleanupIndex < 0
) {
  issues.push(
    `${reusablePath} must define unlock, upload, publish-wait, lock, and failure-cleanup steps in parsed YAML`,
  );
} else if (
  parsedUnlockIndex >= parsedUploadIndex ||
  parsedUploadIndex >= parsedPublishWaitIndex ||
  parsedPublishWaitIndex >= parsedLockIndex
) {
  issues.push(
    `${reusablePath} parsed YAML steps must order unlock before upload before publish-wait before lock`,
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

const uploadStart = reusable.indexOf("name: Upload the prebuilt deploy");
const uploadEnd = reusable.indexOf(
  "name: Wait for the Netlify deploy to publish",
  uploadStart,
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
    !unlock.includes("/deploys?per_page=100") ||
    !unlock.includes('candidate.state === "ready"') ||
    !unlock.includes("candidate.published_at")
  ) {
    issues.push(
      `${reusablePath} production unlock must reject pending ready deploys and verify locked=false`,
    );
  }
}
const lockStart = reusable.indexOf(
  "name: Lock the published production deploy",
);
const cleanupStart = reusable.indexOf(
  "name: Restore the production deploy lock after a failed cutover",
);
if (
  lockStart < 0 ||
  cleanupStart < 0 ||
  lockStart >= cleanupStart ||
  !reusable.slice(lockStart, cleanupStart).includes("/lock") ||
  !reusable.slice(lockStart, cleanupStart).includes("published_deploy") ||
  !reusable.slice(cleanupStart).includes("failure()") ||
  !reusable.slice(cleanupStart).includes("/lock")
) {
  issues.push(
    `${reusablePath} must lock the new published deploy and fail-safe the production lock after cutover errors`,
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
}

if (issues.length) {
  for (const issue of issues) console.error(`::error::${issue}`);
  process.exit(1);
}

console.log(
  "Netlify prebuilt workflows preserve context and publish serialization.",
);
