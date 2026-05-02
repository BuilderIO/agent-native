#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const trackedFiles = execFileSync("git", ["ls-files"], {
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean);

const forbidden = trackedFiles.filter(
  (file) =>
    /(^|\/)\.vercel\/output\//.test(file) ||
    /(^|\/)\.claude\/settings\.json$/.test(file),
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
