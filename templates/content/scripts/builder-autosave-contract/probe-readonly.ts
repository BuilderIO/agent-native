/**
 * READ-ONLY delivery-API probe.
 *
 * This script makes ONLY GET requests to the public Builder delivery CDN. It
 * never authenticates with the private key and never mutates anything, so it
 * is safe to run against a real space to characterize the delivery/response
 * envelope (the shape of evidence the live write harness produces).
 *
 * USAGE
 *   node --env-file=<env-with-BUILDER_API_KEY> --experimental-strip-types \
 *     scripts/builder-autosave-contract/probe-readonly.ts --model page
 *
 * Requires only BUILDER_API_KEY (public delivery key). No write key is read.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BuilderContractClient, resolveConfig } from "./builder-client.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = join(HERE, "evidence");

function valueOf(argv: string[], flag: string, fallback: string): string {
  const eq = argv.find((a) => a.startsWith(`${flag}=`));
  if (eq) return eq.slice(flag.length + 1);
  const idx = argv.indexOf(flag);
  if (idx >= 0 && idx + 1 < argv.length) return argv[idx + 1];
  return fallback;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const model = valueOf(argv, "--model", "page");
  const config = resolveConfig();
  // Hard guarantee: never even hold the private key in this probe.
  const client = new BuilderContractClient({
    ...config,
    privateKey: undefined,
  });

  if (!client.hasReadCredentials()) {
    process.stdout.write(
      "BLOCKED: no BUILDER_API_KEY (public delivery key) in env. " +
        "Provide it via --env-file and re-run.\n",
    );
    process.exitCode = 2;
    return;
  }

  process.stdout.write(
    `Read-only Builder delivery probe — model "${model}" @ ${config.cdnHost}\n`,
  );

  // Published-only listing (what visitors see).
  await client.queryEntries({
    label: "readonly-published-listing",
    model,
    limit: 3,
  });
  // includeUnpublished listing (surfaces drafts/staged).
  await client.queryEntries({
    label: "readonly-include-unpublished-listing",
    model,
    includeUnpublished: true,
    limit: 3,
  });

  for (const ex of client.exchanges) {
    const body = ex.response.body as Record<string, unknown> | string | null;
    const count =
      body && typeof body === "object" && Array.isArray(body.results)
        ? `${body.results.length} result(s)`
        : "n/a";
    process.stdout.write(
      `\n>>> ${ex.label}  ${ex.request.method} ${ex.request.url}` +
        `\n    -> HTTP ${ex.response.status} ${ex.response.statusText} — ${count}\n`,
    );
  }

  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = join(EVIDENCE_DIR, `readonly-probe-${stamp}.json`);
  writeFileSync(
    file,
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        model,
        exchanges: client.exchanges,
      },
      null,
      2,
    ),
  );
  process.stdout.write(`\nEvidence written to ${file}\n`);
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
});
