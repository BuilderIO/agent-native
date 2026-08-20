import { readFileSync } from "node:fs";

import { parse } from "yaml";

/**
 * Keep the beta E2E suite honest about the two things it cannot check itself.
 *
 * 1. It must only ever point at beta hosts. Pointed at production it would
 *    sign in as a real identity, spend tokens, and write to live data — and the
 *    run would still report green, which is the worst possible outcome.
 * 2. It must stay budgeted on luna. The model id lives in one helper; a change
 *    there silently multiplies the cost of every run, and nothing else in CI
 *    would notice.
 *
 * Also checks the fleet list is not duplicated: the suite reads
 * `scripts/netlify-beta-sites.json`, so a newly deployed beta site is covered
 * automatically. A second hardcoded host list would quietly stop being updated.
 */

const workflowPath = ".github/workflows/beta-e2e.yml";
const fleetPath = "e2e/beta/lib/fleet.ts";
const chatPath = "e2e/beta/lib/chat.ts";
const sitesPath = "scripts/netlify-beta-sites.json";
const configPath = "e2e/beta/playwright.config.ts";
const globalSetupPath = "e2e/beta/global-setup.ts";

const issues: string[] = [];

function read(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    issues.push(
      `${path} could not be read: ${error instanceof Error ? error.message : String(error)}`,
    );
    return "";
  }
}

const workflow = read(workflowPath);
const fleet = read(fleetPath);
const chat = read(chatPath);
const config = read(configPath);
const globalSetup = read(globalSetupPath);
const sitesRaw = read(sitesPath);

// 1. The fleet is derived, not duplicated.
if (fleet && !fleet.includes("netlify-beta-sites.json")) {
  issues.push(
    `${fleetPath} no longer reads ${sitesPath}. The suite must derive its host list from the deploy list so a new beta site is covered without a second edit.`,
  );
}

// 2. Non-beta hosts are refused at the boundary.
if (fleet && !fleet.includes('startsWith("beta.")')) {
  issues.push(
    `${fleetPath} dropped its beta-host check. Without it this suite can be pointed at production, where it would sign in as a real user and write to live data.`,
  );
}

// 3. Every host in the deploy list really is a beta host.
if (sitesRaw) {
  try {
    const sites = JSON.parse(sitesRaw) as { id?: string; host?: string }[];
    const nonBeta = sites.filter((site) => !site.host?.startsWith("beta."));
    if (nonBeta.length > 0) {
      issues.push(
        `${sitesPath} lists non-beta host(s): ${nonBeta.map((site) => site.host).join(", ")}. The beta E2E suite reads this file and would target them.`,
      );
    }
  } catch (error) {
    issues.push(
      `${sitesPath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// 4. The budget model stays luna.
if (chat) {
  const lunaIds = [...chat.matchAll(/gpt-5[.-]6-luna/g)];
  if (lunaIds.length === 0) {
    issues.push(
      `${chatPath} no longer names a luna model id. This suite is budgeted for luna; changing the model changes what every run costs.`,
    );
  }
  if (!chat.includes("assertOnlyLuna")) {
    issues.push(
      `${chatPath} dropped assertOnlyLuna. Seeding a model without reading it back off the wire means a run can silently bill a different model.`,
    );
  }
}

// 5. Missing credentials must fail, never skip.
if (globalSetup && !/throw new Error/.test(globalSetup)) {
  issues.push(
    `${globalSetupPath} no longer throws. An authenticated run that degrades to an anonymous one reports green while testing nothing.`,
  );
}

/** Drop comments so prose explaining a rule cannot trip the rule. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

// 6. Certificate errors stay observable.
if (config && /ignoreHTTPSErrors/.test(stripComments(config))) {
  issues.push(
    `${configPath} sets ignoreHTTPSErrors. "The connection isn't private" was a real beta report; only a browser that still validates certificates can catch it.`,
  );
}

// 7. The workflow stays a manual gate and keeps the lanes separated.
if (workflow) {
  try {
    const parsed = parse(workflow) as Record<string, unknown>;
    const on = parsed.on as Record<string, unknown> | undefined;
    if (!on || !("workflow_dispatch" in on)) {
      issues.push(
        `${workflowPath} must offer workflow_dispatch — it is the manual promotion gate.`,
      );
    }
    const automaticTriggers = Object.keys(on ?? {}).filter(
      (key) => key !== "workflow_dispatch",
    );
    if (automaticTriggers.length > 0) {
      issues.push(
        `${workflowPath} added automatic trigger(s): ${automaticTriggers.join(", ")}. This suite spends model tokens and runs against hosts sharing production data, so it stays manual until that changes deliberately.`,
      );
    }
  } catch (error) {
    issues.push(
      `${workflowPath} is not valid YAML: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!workflow.includes("--project=advisory")) {
    issues.push(
      `${workflowPath} no longer runs the advisory lane. Non-blocking findings that stop being reported stop being fixed.`,
    );
  }
  if (!/continue-on-error:\s*true/.test(workflow)) {
    issues.push(
      `${workflowPath} no longer marks the advisory lane non-gating. Gating on advisory findings trains people to ignore a red run.`,
    );
  }
  if (!workflow.includes("pnpm typecheck:e2e")) {
    issues.push(
      `${workflowPath} dropped the typecheck step. e2e/ is outside the workspace typecheck sweep, so a type error would only surface after tokens were spent.`,
    );
  }
}

if (issues.length > 0) {
  console.error("guard:beta-e2e-suite found problems:\n");
  for (const issue of issues) console.error(`  - ${issue}`);
  process.exit(1);
}

console.log("guard:beta-e2e-suite passed");
