import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const packagedApp = path.resolve(
  process.argv[2] ??
    path.join(process.cwd(), "dist", "mac-arm64", "Agent Native.app"),
);
if (!fs.existsSync(packagedApp)) {
  throw new Error(`Packaged app not found: ${packagedApp}`);
}

const proofRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "agent-native-packaged-multi-frontier-proof-"),
);
const isolatedApp = path.join(proofRoot, "Agent Native.app");
const storeRoot = path.join(proofRoot, "store");
const fakeHome = path.join(proofRoot, "home");
const fakeBin = path.join(proofRoot, "bin");
fs.cpSync(packagedApp, isolatedApp, { recursive: true });
fs.mkdirSync(fakeHome, { recursive: true });
fs.mkdirSync(fakeBin, { recursive: true });
writeFakeSubscriptionClis(fakeBin);

async function main(): Promise<void> {
  const result = await runPackagedSmoke();
  if (
    result.result !==
    "packaged-multi-frontier-start-go-checkpoint-cancel-recovery-ok"
  ) {
    throw new Error(
      "The packaged Multi-Frontier smoke did not report success.",
    );
  }
  process.stdout.write(
    `${JSON.stringify({ app: isolatedApp, ...result }, null, 2)}\n`,
  );
}

function writeFakeSubscriptionClis(bin: string): void {
  const program = `#!/bin/sh
log="$HOME/fake-cli.log"
name="$(basename "$0")"
if [ "$name" = "codex" ] && [ "$1" = "login" ] && [ "$2" = "status" ]; then
  printf '%s-status\\n' "$name" >> "$log"
  printf 'Logged in using ChatGPT\\n'
  exit 0
fi
if [ "$name" = "claude" ] && [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  printf '%s-status\\n' "$name" >> "$log"
  printf '{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","subscriptionType":"pro"}\\n'
  exit 0
fi
input="$(cat)"
printf '%s-turn\\n' "$name" >> "$log"
case "$input" in
  *Cancellation*)
    trap 'exit 143' TERM INT
    while :; do sleep 1; done
    ;;
esac
if [ "$name" = "codex" ]; then
  printf '{"type":"thread.started","thread_id":"smoke-codex-session"}\\n'
fi
printf '{"type":"command_execution","command":"pnpm test packaged-multi-frontier","exit_code":0,"aggregated_output":"Tests 1 passed."}\\n'
printf '%s\\n' '{"result":"{\\"text\\":\\"Hermetic fake participant completed its bounded turn.\\",\\"agreed\\":true,\\"requiresRevision\\":false,\\"findings\\":[]}"}'
`;
  for (const name of ["codex", "claude"]) {
    const target = path.join(bin, name);
    fs.writeFileSync(target, program, { mode: 0o755 });
  }
}

function runPackagedSmoke(): Promise<Record<string, unknown>> {
  const executable = path.join(
    isolatedApp,
    "Contents",
    "MacOS",
    "Agent Native",
  );
  const resources = path.join(isolatedApp, "Contents", "Resources");
  const entry = path.join(
    resources,
    "app.asar",
    "out",
    "main",
    "packaged-multi-frontier-smoke-entry.js",
  );
  const child = spawn(executable, [entry], {
    cwd: resources,
    env: {
      PATH: `${fakeBin}:/usr/bin:/bin`,
      HOME: fakeHome,
      AGENT_NATIVE_CODE_AGENTS_HOME: storeRoot,
      ELECTRON_RUN_AS_NODE: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code !== 0) {
        reject(
          new Error(
            `Packaged Multi-Frontier smoke exited ${signal ?? code}: ${output}`,
          ),
        );
        return;
      }
      try {
        resolve(JSON.parse(output) as Record<string, unknown>);
      } catch (error) {
        reject(
          new Error(
            `Packaged Multi-Frontier smoke returned invalid JSON: ${String(error)}\n${output}`,
          ),
        );
      }
    });
  });
}

void main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
});
