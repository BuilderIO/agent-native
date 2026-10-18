import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DESIGN_E2E_REGRESSION_PINS,
  resolveDesignE2ERegressionPinsForShard,
} from "./design-e2e-regression-pins.ts";

export type DesignE2ERegressionPinIdentity = {
  readonly selector: string;
  readonly title: string;
};

export function resolveDesignE2ERegressionPinIdentitiesForShard(
  shard: string,
): DesignE2ERegressionPinIdentity[] {
  const pins = DESIGN_E2E_REGRESSION_PINS.filter((pin) => pin.shard === shard);
  const selectors = resolveDesignE2ERegressionPinsForShard(shard);
  if (pins.length !== selectors.length) {
    throw new Error(
      `Design regression pin identities did not align with selectors for shard ${shard}`,
    );
  }
  return pins.map((pin, index) => ({
    selector: selectors[index]!,
    title: pin.title,
  }));
}

function runCli(): void {
  const shard = process.argv[2];
  if (!shard || process.argv.length !== 3) {
    process.stderr.write(
      "Usage: node --experimental-strip-types scripts/design-e2e-regression-pin-identities.ts <shard>\n",
    );
    process.exitCode = 2;
    return;
  }

  try {
    process.stdout.write(
      JSON.stringify(resolveDesignE2ERegressionPinIdentitiesForShard(shard)),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `::error::Unable to resolve Design regression pin identities: ${message}\n`,
    );
    process.exitCode = 2;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  runCli();
}
