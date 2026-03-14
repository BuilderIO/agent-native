const scriptName = process.argv[2];

if (!scriptName) {
  console.error("Usage: pnpm script <script-name> [--args]");
  process.exit(1);
}

const scripts: Record<
  string,
  () => Promise<{ default: (args: string[]) => Promise<void> }>
> = {
  "analyze-brand": () => import("./analyze-brand.js"),
  "generate-images": () => import("./generate-images.js"),
};

const loader = scripts[scriptName];
if (!loader) {
  console.error(`Unknown script: ${scriptName}`);
  console.error(`Available: ${Object.keys(scripts).join(", ")}`);
  process.exit(1);
}

loader()
  .then((mod) => mod.default(process.argv.slice(3)))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
