import { readdirSync } from "node:fs";
import { join, relative } from "node:path";

const roots = [
  "packages/dispatch/src/components/layout",
  "packages/desktop-app/src/renderer/components",
];

const violations = roots.flatMap((root) => {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch (error) {
    throw new Error(`[guard:chat-first-shared-ui] Unable to read ${root}`, {
      cause: error,
    });
  }
  return entries
    .filter(
      (entry) => /chat-first/i.test(entry) && /\.(tsx?|jsx?)$/.test(entry),
    )
    .map((entry) => relative(process.cwd(), join(root, entry)));
});

if (violations.length > 0) {
  console.error(
    `[guard:chat-first-shared-ui] duplicate host component file(s):\n${violations.map((file) => `- ${file}`).join("\n")}\nMove the React implementation into packages/core/src/client/chat-first/.`,
  );
  process.exitCode = 1;
} else {
  console.log("[guard:chat-first-shared-ui] clean");
}
