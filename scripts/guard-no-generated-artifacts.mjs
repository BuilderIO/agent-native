#!/usr/bin/env node
import { execGuardCommand } from "./lib/changed-lines.mjs";

const trackedFiles = execGuardCommand("git", ["ls-files"], {
  encoding: "utf8",
  maxBuffer: 1 << 28,
})
  .split("\n")
  .filter(Boolean);
const deletedFiles = new Set(
  execGuardCommand("git", ["diff", "--name-only", "--diff-filter=D"], {
    encoding: "utf8",
    maxBuffer: 1 << 28,
  })
    .split("\n")
    .filter(Boolean),
);

// The repository-level Claude settings are source-controlled hook configuration,
// not generated workspace state.
const forbidden = trackedFiles.filter(
  (file) =>
    !deletedFiles.has(file) &&
    file !== ".claude/settings.json" &&
    (/(^|\/)\.vercel\/output\//.test(file) ||
      /(^|\/)\.claude\/settings\.json$/.test(file)),
);

if (forbidden.length > 0) {
  console.error(
    [
      "Generated/legacy artifacts are tracked in git:",
      "",
      ...forbidden.map((file) => `  - ${file}`),
      "",
      "Remove these files instead of committing them. Generated workspaces should stay minimal.",
    ].join("\n"),
  );
  process.exit(1);
}
