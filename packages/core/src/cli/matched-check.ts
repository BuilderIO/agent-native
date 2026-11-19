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
  const specPath = argv.find((a) => !a.startsWith("--"));
  const outArg = argv[argv.indexOf("--out") + 1];
  const outDir = path.resolve(
    outArg && argv.includes("--out") ? outArg : ".tmp/matched-check",
  );
  if (!specPath) {
    console.error(
      "Usage: agent-native design matched-check <spec.json> [--out dir]",
    );
    return 1;
  }
  const spec = JSON.parse(await fs.readFile(specPath, "utf8")) as SpecFile;
  await fs.mkdir(outDir, { recursive: true });
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
          throw new Error(`Artifact name "${name}" escapes the output directory.`);
        }
        await fs.writeFile(file, bytes);
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
