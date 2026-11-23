import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { vi } from "vitest";

import { kernelEventSchema } from "../../shared/kernel-contract.js";
import { getDb, schema } from "../db/index.js";
import type { KernelPort } from "./notebook-kernel.js";

const exec = promisify(execFile);
const kernelDirectory = fileURLToPath(
  new URL("../../../../services/analytics-kernel/", import.meta.url),
);
const kernelPython = existsSync(join(kernelDirectory, ".venv/bin/python"))
  ? join(kernelDirectory, ".venv/bin/python")
  : "python3";
const duckdbProgram = [
  "import json, sys",
  "from pathlib import Path",
  "from analytics_kernel.kernel_runtime import arrow_display, dataframe_sql",
  "import base64",
  "command, inputs, output = json.loads(sys.argv[1])",
  "table = dataframe_sql(command['source'], inputs, command['params'])",
  "Path(output).write_bytes(base64.b64decode(arrow_display(table)))",
].join("\n");

export function localDuckDb() {
  const execute = vi.fn<KernelPort["execute"]>(
    async (_claim, envelope, readArrow, receive) => {
      const command = envelope.command;
      if (command.operation !== "execute-dataframe-sql")
        throw new Error("Expected Dataframes SQL");
      const directory = await mkdtemp(join(tmpdir(), "analytics2-duckdb-"));
      try {
        const inputFiles: Record<string, string> = {};
        for (const [index, input] of command.inputs.entries()) {
          const path = join(directory, `input-${index}.arrow`);
          await writeFile(path, await readArrow(input.manifest.result));
          inputFiles[input.name] = path;
        }
        const path = join(directory, "result.arrow");
        await exec(
          kernelPython,
          ["-c", duckdbProgram, JSON.stringify([command, inputFiles, path])],
          {
            cwd: kernelDirectory,
            env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
          },
        );
        const artifact = {
          contentType: "application/vnd.apache.arrow.stream",
          bytes: await readFile(path),
        };
        await receive(
          kernelEventSchema.shape.event.parse({
            type: "result",
            artifactId: "test-result",
          }),
          artifact,
        );
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
  return {
    execute,
    async generation(claim) {
      const { ref, namespace } = claim.run.receipt.request.snapshot;
      await getDb()
        .insert(schema.kernelNamespaces)
        .values({
          id: namespace.namespaceId,
          orgId: claim.run.orgId,
          principalId: claim.run.ownerEmail,
          projectId: ref.projectId,
          scopeKind: namespace.kind,
          scopeId: namespace.namespaceId,
          lineageId: ref.head.versionId,
          generation: 1n,
          status: "ready",
          heartbeatAt: new Date(),
          hostId: "local-test",
          serviceSha: "test",
          imageDigest: "test",
        })
        .onConflictDoNothing();
      return "1";
    },
  } satisfies KernelPort;
}
