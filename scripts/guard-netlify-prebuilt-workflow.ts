import { readFileSync } from "node:fs";

import { parse } from "yaml";

const reusablePath = ".github/workflows/deploy-netlify-prebuilt.yml";
const productionPath = ".github/workflows/deploy-production-sites-prebuilt.yml";
const betaPath = ".github/workflows/deploy-beta-sites-prebuilt.yml";

const reusable = readFileSync(reusablePath, "utf8");
const production = readFileSync(productionPath, "utf8");
const beta = readFileSync(betaPath, "utf8");

const issues: string[] = [];

try {
  for (const [path, source] of [
    [reusablePath, reusable],
    [productionPath, production],
    [betaPath, beta],
  ] as const) {
    parse(source);
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

const uploadStart = reusable.indexOf("name: Upload the prebuilt deploy");
const uploadEnd = reusable.indexOf(
  "name: Wait for the Netlify deploy to publish",
  uploadStart,
);
const upload =
  uploadStart >= 0 && uploadEnd > uploadStart
    ? reusable.slice(uploadStart, uploadEnd)
    : "";
if (upload.includes('--context "$BUILD_CONTEXT"')) {
  issues.push(
    "prebuilt uploads must not pass --context with --no-build; the Netlify CLI rejects that combination",
  );
}

for (const [path, expected] of [
  [productionPath, ["target: production", "build_context: production"]],
  [betaPath, ["target: beta", "build_context: branch-deploy"]],
] as const) {
  for (const value of expected) {
    if (!readFileSync(path, "utf8").includes(value)) {
      issues.push(`${path} must retain ${value}`);
    }
  }
}

if (issues.length) {
  for (const issue of issues) console.error(`::error::${issue}`);
  process.exit(1);
}

console.log(
  "Netlify prebuilt workflows preserve context and publish serialization.",
);
