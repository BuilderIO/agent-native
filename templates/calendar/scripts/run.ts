/**
 * Script runner - dispatches to individual scripts
 * Usage: pnpm script <script-name> [--args]
 */

const scriptName = process.argv[2];
if (!scriptName) {
  console.error("Usage: pnpm script <script-name> [--args]");
  console.error(
    "Available scripts: sync-google-calendar, create-event, list-events, check-availability",
  );
  process.exit(1);
}

const scripts: Record<
  string,
  () => Promise<{ default: (args: string[]) => Promise<void> }>
> = {
  "sync-google-calendar": () => import("./sync-google-calendar.js"),
  "create-event": () => import("./create-event.js"),
  "list-events": () => import("./list-events.js"),
  "check-availability": () => import("./check-availability.js"),
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
