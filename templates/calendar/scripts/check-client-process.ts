import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const assetsDirectory = path.resolve(".output/public/assets");
const assets = (await readdir(assetsDirectory)).filter((name) =>
  /\.(?:m?js|cjs)$/.test(name),
);

if (assets.length === 0) {
  throw new Error(`No browser JavaScript assets found in ${assetsDirectory}`);
}

const offenders = (
  await Promise.all(
    assets.map(async (name) =>
      (await readFile(path.join(assetsDirectory, name), "utf8")).includes(
        "process.env",
      )
        ? name
        : null,
    ),
  )
).filter((name): name is string => name !== null);

if (offenders.length > 0) {
  throw new Error(
    `Node process.env leaked into browser assets: ${offenders.join(", ")}`,
  );
}
