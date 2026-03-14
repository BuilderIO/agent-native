import sharp from "sharp";

export default async function main() {
  // Logo is at x:800-1200, y:169-569 in the hero
  const hero = await sharp("content/projects/steve/claude-code-for-designers/media/hero-v5-real-logo.png")
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { data, info } = hero;
  const ch = info.channels;

  console.log(`Hero: ${info.width}x${info.height}, ${ch} channels`);

  // Sample a grid across the logo area
  const points = [
    [810, 180], [900, 180], [1000, 180], [1100, 180], [1190, 180], // top row
    [810, 280], [900, 280], [1000, 280], [1100, 280], [1190, 280], // upper mid
    [810, 370], [900, 370], [1000, 370], [1100, 370], [1190, 370], // center
    [810, 460], [900, 460], [1000, 460], [1100, 460], [1190, 460], // lower mid
    [810, 550], [900, 550], [1000, 550], [1100, 550], [1190, 550], // bottom row
  ];

  for (const [x, y] of points) {
    const i = (y * info.width + x) * ch;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const a = ch === 4 ? data[i + 3] : 255;
    const isWhite = r > 200 && g > 200 && b > 200;
    const isBlack = r < 20 && g < 20 && b < 20;
    const label = isWhite ? "WHITE!" : isBlack ? "black" : `color`;
    console.log(`(${x},${y}): R=${r} G=${g} B=${b} A=${a} — ${label}`);
  }
}
