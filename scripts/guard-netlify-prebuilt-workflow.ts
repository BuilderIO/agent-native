import { readFileSync } from "node:fs";

import { parse } from "yaml";

const reusablePath = ".github/workflows/deploy-netlify-prebuilt.yml";
const productionPath = ".github/workflows/deploy-production-sites-prebuilt.yml";
const betaPath = ".github/workflows/deploy-beta-sites-prebuilt.yml";

const reusable = readFileSync(reusablePath, "utf8");
const production = readFileSync(productionPath, "utf8");
const beta = readFileSync(betaPath, "utf8");

const issues: string[] = [];
const parsedWorkflows = new Map<string, Record<string, unknown>>();

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

try {
  for (const [path, source] of [
    [reusablePath, reusable],
    [productionPath, production],
    [betaPath, beta],
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

if (
  !reusable.includes(
    "group: ${{ inputs.target == 'production' && 'agent-native-production-publish'",
  )
) {
  issues.push(
    "production prebuilt deploys must share the fleet-wide production publish lock",
  );
}

const reusableDocument = parsedWorkflows.get(reusablePath);
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
if (
  parsedUnlockIndex < 0 ||
  parsedUploadIndex < 0 ||
  parsedPublishWaitIndex < 0
) {
  issues.push(
    `${reusablePath} must define unlock, upload, and publish-wait steps in parsed YAML`,
  );
} else if (
  parsedUnlockIndex >= parsedUploadIndex ||
  parsedUploadIndex >= parsedPublishWaitIndex
) {
  issues.push(
    `${reusablePath} parsed YAML steps must order unlock before upload before publish-wait`,
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
  if (!unlock.includes("/unlock") || !unlock.includes("locked !== false")) {
    issues.push(
      `${reusablePath} production unlock must call Netlify unlock and verify locked=false`,
    );
  }
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
