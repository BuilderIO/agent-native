import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(
  resolve(root, "assets/agent-native-icon-dark.svg"),
  "utf8",
);
const outputDirectory = resolve(root, "public/icons");

await mkdir(outputDirectory, { recursive: true });

for (const size of [16, 32, 48, 128]) {
  const padding = Math.max(1, Math.round(size * 0.16));
  const mark = await sharp(Buffer.from(source))
    .resize({
      width: size - padding * 2,
      height: size - padding * 2,
      fit: "contain",
    })
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 9, g: 12, b: 18, alpha: 1 },
    },
  })
    .composite([{ input: mark, gravity: "center" }])
    .png()
    .toFile(resolve(outputDirectory, `icon-${size}.png`));
}
