// Copies Tabler outline icons into a prototype's icons.json, which the build merges over kit/icons.json.
// Run: node prototypes/kit/add-icons.ts <name> <icon> [<icon>…]   (Tabler names, e.g. player-record)
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const kit = dirname(fileURLToPath(import.meta.url));
const [name, ...wanted] = process.argv.slice(2);
if (!name || !wanted.length)
  throw new Error(
    "Usage: node prototypes/kit/add-icons.ts <name> <icon> [<icon>…]",
  );

// Worktrees often have no node_modules of their own, so fall back to the main checkout's.
function tablerDir(): string {
  const common = execFileSync(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    { cwd: kit, encoding: "utf8" },
  ).trim();
  for (const root of [join(kit, "../.."), dirname(common)]) {
    const pnpm = join(root, "node_modules/.pnpm");
    if (!existsSync(pnpm)) continue;
    const pkg = readdirSync(pnpm)
      .filter((d) => d.startsWith("@tabler+icons@"))
      .sort()
      .pop();
    if (pkg) return join(pnpm, pkg, "node_modules/@tabler/icons/icons/outline");
  }
  throw new Error(
    "No @tabler/icons package found; run pnpm install in the main checkout",
  );
}

const dir = tablerDir();
const file = join(kit, "..", name, "icons.json");
const icons: Record<string, string> = existsSync(file)
  ? JSON.parse(readFileSync(file, "utf8"))
  : {};
const missing: string[] = [];
for (const icon of wanted) {
  const svg = join(dir, `${icon}.svg`);
  if (!existsSync(svg)) {
    missing.push(icon);
    continue;
  }
  icons[icon] = readFileSync(svg, "utf8")
    .replace(/^[\s\S]*?<svg[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "")
    .replace(/<path stroke="none" d="M0 0h24v24H0z" fill="none"\s*\/>/, "")
    .replace(/\s+/g, " ")
    .trim();
}
writeFileSync(file, JSON.stringify(icons, null, 0) + "\n");
console.log(`${name}/icons.json: ${Object.keys(icons).length} icons.`);
if (missing.length) throw new Error(`Not in Tabler: ${missing.join(", ")}`);
