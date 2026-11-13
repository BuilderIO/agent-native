import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { parse } from "yaml";

const ACTION = ".github/actions/build-agent-native-desktop/action.yml";

function packageScript(): string {
  const action = parse(readFileSync(ACTION, "utf8")) as {
    runs: { steps: Array<{ name?: string; run?: string }> };
  };
  const step = action.runs.steps.find((s) => s.name === "Package");
  assert.ok(step?.run, `${ACTION} has no Package step`);
  return step.run
    .replaceAll("${{ inputs.platform }}", "mac")
    .replaceAll("${{ inputs.sign }}", "true")
    .replaceAll("${{ inputs.channel }}", "production")
    .replaceAll("${{ inputs.publish }}", "always");
}

/**
 * Runs the Package step with electron-builder answering as `outcomes` says,
 * one entry per run: "ok", "server-error" (GitHub answered 500) or
 * "build-error".
 */
function runPackage(outcomes: string[]) {
  const root = mkdtempSync(path.join(tmpdir(), "desktop-package-"));
  const bin = path.join(root, "bin");
  const work = path.join(root, "work");
  mkdirSync(bin);
  mkdirSync(work);
  const calls = path.join(root, "calls");
  writeFileSync(
    path.join(bin, "pnpm"),
    `#!/usr/bin/env bash
n=$(( $(grep -c '^run' "${calls}" 2>/dev/null || true) + 1 ))
echo "run $n dist=$( [ -e dist ] && echo left || echo clean )" >> "${calls}"
mkdir -p dist && touch "dist/run-$n"
outcomes=(${outcomes.join(" ")})
case "\${outcomes[$((n - 1))]}" in
  ok) echo "  • publishing done"; exit 0 ;;
  server-error) echo "HttpError: 500 Internal Server Error"; exit 1 ;;
  *) echo "  ⨯ notarization failed"; exit 1 ;;
esac
`,
  );
  writeFileSync(
    path.join(bin, "sleep"),
    `#!/usr/bin/env bash\necho "sleep $1" >> "${calls}"\n`,
  );
  chmodSync(path.join(bin, "pnpm"), 0o755);
  chmodSync(path.join(bin, "sleep"), 0o755);
  const result = spawnSync(
    "bash",
    ["--noprofile", "--norc", "-eo", "pipefail", "-c", packageScript()],
    {
      cwd: work,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        RUNNER_TEMP: root,
      },
    },
  );
  const log = existsSync(calls)
    ? readFileSync(calls, "utf8").trim().split("\n")
    : [];
  rmSync(root, { recursive: true, force: true });
  return { status: result.status, stdout: result.stdout, log };
}

describe("build-agent-native-desktop Package step", () => {
  it("packages once when electron-builder succeeds", () => {
    const { status, log } = runPackage(["ok"]);
    assert.equal(status, 0);
    assert.deepEqual(log, ["run 1 dist=clean"]);
  });

  it("packages again from a clean dist after a GitHub server error", () => {
    const { status, stdout, log } = runPackage(["server-error", "ok"]);
    assert.equal(status, 0);
    assert.deepEqual(log, [
      "run 1 dist=clean",
      "sleep 120",
      "run 2 dist=clean",
    ]);
    assert.match(stdout, /::warning::GitHub answered electron-builder/);
  });

  it("fails after a second GitHub server error", () => {
    const { status, log } = runPackage(["server-error", "server-error"]);
    assert.equal(status, 1);
    assert.deepEqual(log, [
      "run 1 dist=clean",
      "sleep 120",
      "run 2 dist=clean",
    ]);
  });

  it("fails at once on any other error", () => {
    const { status, log } = runPackage(["build-error", "ok"]);
    assert.equal(status, 1);
    assert.deepEqual(log, ["run 1 dist=clean"]);
  });
});
