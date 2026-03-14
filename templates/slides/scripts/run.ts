/**
 * Script runner - dispatches to individual scripts
 * Usage: pnpm script <script-name> [--args]
 */

const scriptName = process.argv[2];
if (!scriptName) {
  console.error("Usage: pnpm script <script-name> [--args]");
  console.error(
    "Available scripts: generate-image, image-gen-status, image-search",
  );
  process.exit(1);
}

const scripts: Record<
  string,
  () => Promise<{ default: (args: string[]) => Promise<void> }>
> = {
  "generate-image": () => import("./generate-image.js"),
  "image-gen-status": () => import("./image-gen-status.js"),
  "image-search": () => import("./image-search.js"),
  "logo-lookup": () => import("./logo-lookup.js"),
  "edit-image": () => import("./edit-image.js"),
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
    console.error(`Error running ${scriptName}:`, err.message || err);
    process.exit(1);
  });
