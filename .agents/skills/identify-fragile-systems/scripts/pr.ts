// Reads a PR's description and diff from GitHub instead of local git, because
// a blobless clone fetches every blob on `git show`/`git diff` and stalls.
// Output is bounded; truncation is always stated, never silent.
import {
  argNumber,
  argString,
  loadConfig,
  main,
  run,
  ScriptError,
} from "./lib.ts";

main((args) => {
  const number = argString(args, "pr");
  if (args.help || !number) {
    console.log(
      "pr --pr <number> [--file <path-substring>] [--max-lines 400] [--no-diff]",
    );
    if (!args.help) process.exitCode = 1;
    return;
  }
  if (!/^\d+$/.test(number)) throw new ScriptError("--pr must be a number");
  const { repo } = loadConfig();
  const meta = JSON.parse(
    run(
      "gh",
      [
        "pr",
        "view",
        number,
        "-R",
        repo,
        "--json",
        "number,title,author,mergedAt,additions,deletions,body,files",
      ],
      { timeoutMs: 60_000 },
    ),
  ) as {
    title: string;
    author: { login: string };
    mergedAt: string | null;
    additions: number;
    deletions: number;
    body: string;
    files: { path: string; additions: number; deletions: number }[];
  };
  console.log(`#${number} ${meta.title}`);
  console.log(
    `by ${meta.author.login}, merged ${meta.mergedAt ?? "not merged"}, +${meta.additions}/-${meta.deletions}`,
  );
  console.log("\n## Description\n");
  console.log(meta.body.trim().slice(0, 4000) || "(empty)");
  console.log("\n## Files\n");
  for (const f of meta.files)
    console.log(`+${f.additions}/-${f.deletions} ${f.path}`);
  if (args["no-diff"]) return;

  const filter = argString(args, "file");
  const maxLines = argNumber(args, "max-lines", 400);
  const diff = run("gh", ["pr", "diff", number, "-R", repo], {
    timeoutMs: 90_000,
  });
  const sections = diff
    .split(/^(?=diff --git )/m)
    .filter((s) => !filter || s.split("\n")[0].includes(filter));
  if (filter && sections.length === 0)
    throw new ScriptError(`no file in #${number} matches "${filter}"`);
  const lines = sections.join("").split("\n");
  console.log(`\n## Diff${filter ? ` (${filter})` : ""}\n`);
  console.log(lines.slice(0, maxLines).join("\n"));
  if (lines.length > maxLines) {
    console.log(
      `\n[truncated: showed ${maxLines} of ${lines.length} diff lines; narrow with --file or raise --max-lines]`,
    );
  }
});
