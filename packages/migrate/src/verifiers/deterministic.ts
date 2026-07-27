import fs from "fs/promises";
import path from "path";

import type { Verifier, VerifierResult } from "../types.js";

export const outputFileVerifier: Verifier = {
  id: "output-file-smoke",
  label: "Output file smoke test",
  async run(context) {
    const required = ["package.json", "app/root.tsx", "actions/run.ts"];
    const missing: string[] = [];
    for (const file of required) {
      try {
        await fs.access(path.join(context.run.outputRoot, file));
      } catch {
        missing.push(file);
      }
    }
    return {
      id: "output-file-smoke",
      ok: missing.length === 0,
      severity: missing.length === 0 ? "info" : "error",
      summary:
        missing.length === 0
          ? "Generated output contains the minimum expected agent-native files."
          : `Generated output is missing ${missing.join(", ")}.`,
      artifactPaths: [],
      suggestedNextTask:
        missing.length > 0 ? "Run the approved scaffold step." : undefined,
    };
  },
};

export const routeParityVerifier: Verifier = {
  id: "route-parity",
  label: "Route parity inventory",
  async run(context): Promise<VerifierResult> {
    const expected = context.ir.site.routes.filter(
      (route) => route.kind !== "api",
    );
    const artifactPath = path.join(
      context.artifacts.runDir,
      "route-parity.json",
    );
    const payload = {
      expectedRoutes: expected.map((route) => ({
        path: route.path,
        sourceFile: route.filePath,
        public: route.public,
      })),
      note: "V1 verifies route inventory and generated placeholders. Full Playwright visual parity belongs to the verifier harness once the target app is runnable.",
    };
    await fs.writeFile(artifactPath, JSON.stringify(payload, null, 2) + "\n");
    return {
      id: "route-parity",
      ok: true,
      severity: "info",
      summary: `Recorded ${expected.length} source route(s) for deterministic route parity checks.`,
      artifactPaths: [artifactPath],
    };
  },
};

export const agentNativeConformanceVerifier: Verifier = {
  id: "agent-native-conformance-summary",
  label: "Agent-native conformance summary",
  async run(context): Promise<VerifierResult> {
    const checks = [
      {
        name: "api-routes-to-actions",
        ok:
          context.tasks.some(
            (task) => task.recipeName === "api-routes-to-actions",
          ) || context.ir.behavior.apiEndpoints.length === 0,
      },
      {
        name: "public-pages-to-ssr",
        ok:
          context.tasks.some(
            (task) => task.recipeName === "public-pages-to-ssr",
          ) || context.ir.site.routes.every((route) => !route.public),
      },
      {
        name: "application-state",
        ok:
          context.tasks.some(
            (task) =>
              task.recipeName === "important-client-state-to-application-state",
          ) || context.ir.behavior.clientState.length === 0,
      },
    ];
    const failed = checks.filter((check) => !check.ok);
    return {
      id: "agent-native-conformance-summary",
      ok: failed.length === 0,
      severity: failed.length === 0 ? "info" : "warning",
      summary:
        failed.length === 0
          ? "Migration plan covers the detected agent-native contract areas."
          : `Migration plan is missing coverage for ${failed.map((f) => f.name).join(", ")}.`,
      artifactPaths: [],
    };
  },
};

export function createDefaultVerifiers(): Verifier[] {
  return [
    outputFileVerifier,
    routeParityVerifier,
    agentNativeConformanceVerifier,
  ];
}
