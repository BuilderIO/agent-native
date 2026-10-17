import { compareLayoutFiles } from "./compare-layout-lib.js";

const [anDir, googleFile] = process.argv.slice(2);
if (!anDir || !googleFile) {
  console.error(
    "Usage: pnpm exec tsx compare-layout.ts <anLayoutDir> <google.txt> [--slides <n>]",
  );
  process.exit(1);
}

const slidesFlag = process.argv.indexOf("--slides");
const slidesValue =
  slidesFlag === -1 ? undefined : Number(process.argv[slidesFlag + 1]);
if (slidesFlag === -1) {
  console.warn(
    "No --slides <n> given, so the layout dump is taken as the whole deck.",
  );
} else if (!(slidesValue && slidesValue > 0)) {
  console.error("--slides must be a positive integer");
  process.exit(1);
}

try {
  const result = compareLayoutFiles(anDir, googleFile, slidesValue);
  for (const line of result.output) console.log(line);
  if (!result.success) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
