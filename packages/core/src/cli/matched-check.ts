import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  createPlaywrightCapturer,
  runMatchedCheck,
  type MatchedCheckInput,
} from "../ingestion/matched-capture.js";

type SpecFile = Omit<MatchedCheckInput, "capture" | "storeArtifact"> & {
  launchArgs?: string[] | undefined;
  executablePath?: string | undefined;
};

export async function runMatchedCheckCommand(argv: string[]): Promise<number> {
  let specPath: string | undefined;
  let outArg: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv.at(i);
    if (arg === undefined) continue;
    if (arg === "--out") {
      outArg = argv[++i];
      if (!outArg || outArg.startsWith("--"))
        throw new Error("--out requires a directory");
    } else if (arg.startsWith("--out=")) {
      outArg = arg.slice(6);
      if (!outArg) throw new Error("--out requires a directory");
    } else if (arg.startsWith("--") || specPath) {
      throw new Error(`Unexpected argument: ${arg}`);
    } else specPath = arg;
  }
  let outDir = path.resolve(outArg ?? ".tmp/matched-check");
  if (!specPath) {
    console.error(
      "Usage: agent-native design matched-check <spec.json> [--out dir]",
    );
    return 1;
  }
  const spec = JSON.parse(await fs.readFile(specPath, "utf8")) as SpecFile;
  await fs.mkdir(outDir, { recursive: true });
  outDir = await fs.realpath(outDir);
  const capturer = createPlaywrightCapturer({
    launchArgs: spec.launchArgs,
    executablePath: spec.executablePath,
  });
  try {
    const report = await runMatchedCheck({
      ...spec,
      capture: capturer.capture,
      storeArtifact: async (name, bytes) => {
        const file = path.resolve(outDir, name);
        if (path.dirname(file) !== outDir) {
          throw new Error(
            `Artifact name "${name}" escapes the output directory.`,
          );
        }
        const temporary = path.join(outDir, `.matched-check-${randomUUID()}`);
        let created = false;
        try {
          await fs.writeFile(temporary, bytes, { flag: "wx" });
          created = true;
          await fs.rename(temporary, file);
        } finally {
          if (created)
            await fs.unlink(temporary).catch((error: NodeJS.ErrnoException) => {
              if (error.code !== "ENOENT") throw error;
            });
        }
        return file;
      },
    });
    console.log(JSON.stringify(report, null, 2));
    const ok =
      report.totals.breakpoints > 0 &&
      report.totals.fail === 0 &&
      report.totals.couldNotRun === 0 &&
      report.results.every((r) => r.validity === "valid");
    return ok ? 0 : 2;
  } finally {
    await capturer.close();
  }
}
