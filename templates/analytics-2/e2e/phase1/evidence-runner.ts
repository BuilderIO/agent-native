import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { request, type Browser } from "@playwright/test";

import { FULL_BUILD_SHA, observeBuild } from "../build-boundary.js";
import { readDescriptor } from "../daily/descriptor.js";
import { openQaBrowser } from "../qa-browser.js";
import { flows01To05 } from "./flows-01-05.js";
import { flows06To10 } from "./flows-06-10.js";
import { flows11To15 } from "./flows-11-15.js";
import { validateExpectedKernelDigest } from "./kernel-attestation.js";
import { FlowContext, newFlowContext, type ActorStates } from "./runtime.js";
import {
  Evidence,
  EvidenceFailure,
  evaluateFlow,
  UnavailableFixture,
} from "./verdict.js";

const flows = [...flows01To05, ...flows06To10, ...flows11To15];
const usage = `node --import tsx templates/analytics-2/e2e/core-flows.ts phase1 \\
  --base-url <mounted-app-url> --expected-sha <40-hex-sha> --flows all \\
  --evidence-dir <directory> [--storage-state <path>] [--bq-key-file <path>] \\
  [--colleague-storage-state <path>] [--denied-storage-state <path>] \\
  [--provider-fixture-url <loopback-url>] [--worker-fixture-url <loopback-url>] \\
  [--model-fixture-url <loopback-url>] \\
  [--expected-kernel-digest <sha256:digest|development>] \\

--flows accepts all or comma-separated two-digit or full flow IDs.
Signed-in browser storage state files and the BigQuery key file stay outside evidence.`;

function options(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      "base-url": { type: "string" },
      "expected-sha": { type: "string" },
      flows: { type: "string" },
      "evidence-dir": { type: "string" },
      "storage-state": { type: "string" },
      "bq-key-file": { type: "string" },
      "provider-fixture-url": { type: "string" },
      "worker-fixture-url": { type: "string" },
      "model-fixture-url": { type: "string" },
      "colleague-storage-state": { type: "string" },
      "denied-storage-state": { type: "string" },
      "expected-kernel-digest": { type: "string" },
      "browser-executable": { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (values.help) return;
  if (values["browser-executable"])
    throw new Error(
      "Browser executable override is unsupported; use the QA browser",
    );
  const base = values["base-url"];
  const expectedSha = values["expected-sha"];
  const evidenceDir = values["evidence-dir"];
  const expectedKernelDigest = values["expected-kernel-digest"];
  const providerFixtureUrl = values["provider-fixture-url"];
  const workerFixtureUrl = values["worker-fixture-url"];
  const modelFixtureUrl = values["model-fixture-url"];
  if (
    !base ||
    !expectedSha ||
    !FULL_BUILD_SHA.test(expectedSha) ||
    !evidenceDir ||
    !values.flows
  )
    throw new Error("Required flags are missing or the SHA is invalid");
  const url = new URL(base);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("Expected an HTTPS app URL or a loopback HTTP app URL");
  if (expectedKernelDigest)
    validateExpectedKernelDigest(expectedKernelDigest, url);
  for (const value of [providerFixtureUrl, workerFixtureUrl, modelFixtureUrl]) {
    if (!value) continue;
    const provider = new URL(value);
    if (
      !local ||
      provider.protocol !== "http:" ||
      provider.hostname !== "127.0.0.1" ||
      !provider.port ||
      provider.username ||
      provider.password ||
      provider.pathname !== "/" ||
      provider.search ||
      provider.hash
    )
      throw new Error(
        "Fixture control must be an explicit loopback HTTP origin for a local app",
      );
  }
  const selected =
    values.flows === "all"
      ? flows
      : values.flows.split(",").map((key) => {
          const flow = flows.find(
            (entry) =>
              entry.id === key.trim() || entry.id.slice(0, 2) === key.trim(),
          );
          if (!flow) throw new Error("Unknown flow ID");
          return flow;
        });
  const states: ActorStates = {};
  if (values["storage-state"]) states.owner = values["storage-state"];
  if (values["colleague-storage-state"])
    states.colleague = values["colleague-storage-state"];
  if (values["denied-storage-state"])
    states.denied = values["denied-storage-state"];
  return {
    baseUrl: url.href.replace(/\/+$/, ""),
    evidenceRoot: resolve(evidenceDir),
    expectedSha,
    local,
    states,
    ...(expectedKernelDigest && { expectedKernelDigest }),
    ...(providerFixtureUrl && {
      providerFixtureUrl: new URL(providerFixtureUrl).href,
    }),
    ...(workerFixtureUrl && {
      workerFixtureUrl: new URL(workerFixtureUrl).href,
    }),
    ...(modelFixtureUrl && {
      modelFixtureUrl: new URL(modelFixtureUrl).href,
    }),
    ...(values["bq-key-file"] && { bqKeyFile: values["bq-key-file"] }),
    selected: [...new Set(selected)],
  };
}

async function dailySession(baseUrl: string) {
  if (baseUrl !== "http://127.0.0.1:8105") return;
  try {
    const descriptor = readDescriptor();
    if (descriptor.base !== baseUrl) return;
    const cookieHeader = await readFile(descriptor.cookiePath, "utf8");
    const cookies = cookieHeader
      .split("; ")
      .filter(Boolean)
      .map((pair) => {
        const split = pair.indexOf("=");
        if (split <= 0) throw new Error("Invalid daily session cookie");
        return {
          name: pair.slice(0, split),
          value: pair.slice(split + 1),
          url: baseUrl,
        };
      });
    return { cookies, providerFixtureUrl: descriptor.fake };
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    )
      return;
    throw new UnavailableFixture("local daily session fixture is unreadable");
  }
}

export async function runEvidence(args: string[]) {
  let config: ReturnType<typeof options>;
  try {
    config = options(args);
  } catch (error) {
    const safe =
      error instanceof Error &&
      (error.message.startsWith("Required flags") ||
        error.message ===
          "Browser executable override is unsupported; use the QA browser")
        ? error.message
        : "Invalid Phase 1 evidence options";
    console.error(`${safe}\n${usage}`);
    return 2;
  }
  if (!config) {
    console.log(usage);
    return 0;
  }
  const { baseUrl, expectedSha, evidenceRoot, selected, states, local } =
    config;
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const evidenceDir = resolve(evidenceRoot, runId);
  await mkdir(evidenceDir, { recursive: true });
  const resultPath = resolve(evidenceDir, "evidence.jsonl");
  const buildRequest = await request.newContext();
  let browser: Browser | undefined;
  const verdicts: string[] = [];
  try {
    for (const definition of selected) {
      const evidence = new Evidence();
      let context: Awaited<ReturnType<typeof newFlowContext>> | undefined;
      let flow: FlowContext | undefined;
      const row = await evaluateFlow({
        expectedSha,
        evidence,
        observe: () => observeBuild(buildRequest, baseUrl),
        run: async () => {
          try {
            browser ??= await openQaBrowser();
          } catch {
            throw new UnavailableFixture("QA browser is unavailable");
          }
          try {
            context = await newFlowContext(browser, states.owner);
          } catch {
            throw new UnavailableFixture("owner storage state is unreadable");
          }
          const daily =
            local && !states.owner ? await dailySession(baseUrl) : undefined;
          if (daily) await context.addCookies(daily.cookies);
          const ownerInitialState = await context.storageState();
          const page = await context.newPage();
          page.setDefaultTimeout(15_000);
          const providerFixtureUrl =
            config.providerFixtureUrl ?? daily?.providerFixtureUrl;
          flow = new FlowContext({
            ...config,
            ...(providerFixtureUrl && { providerFixtureUrl }),
            page,
            browser,
            evidence,
            evidenceDir,
            flowId: definition.id,
            ownerInitialState,
          });
          await flow.step("confirm signed-in workspace", () =>
            flow!.identity(),
          );
          await definition.run(flow);
          await flow.screenshot("mounted result");
          if (!(await flow.releaseOwnedDraftKernels()))
            throw new EvidenceFailure("Could not release the QA draft kernels");
        },
        onFailure: async () => {
          if (!flow) return;
          try {
            if (
              definition.id === "01-connect-warehouse" ||
              flow.page.url() === "about:blank"
            )
              return;
            await flow.screenshot("failure");
          } catch {
            await evidence.step(
              "failure screenshot unavailable",
              async () => undefined,
            );
          } finally {
            await flow.releaseOwnedDraftKernels();
          }
        },
      });
      await appendFile(
        resultPath,
        `${JSON.stringify({ flowId: definition.id, baseUrl, runId, ...row })}\n`,
        { mode: 0o600 },
      );
      verdicts.push(row.verdict);
      console.log(
        `${row.verdict} ${definition.id} ${row.reason}${row.observed.capability ? ` (${row.observed.capability})` : ""}`,
      );
      await context?.close();
    }
  } finally {
    try {
      await browser?.close();
    } finally {
      await buildRequest.dispose();
    }
  }
  console.log(`Evidence ${resultPath}`);
  if (verdicts.includes("FAIL")) return 1;
  return verdicts.includes("COULD-NOT-RUN") ? 2 : 0;
}
