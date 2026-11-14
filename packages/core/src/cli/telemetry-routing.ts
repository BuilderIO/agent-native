const REWIND_SKILL_TARGETS = new Set([
  "rewind",
  "screen-memory",
  "clips-rewind",
  "agent-native-rewind",
]);

function isRewindSkillTarget(value: string | undefined): boolean {
  return REWIND_SKILL_TARGETS.has(value?.trim().toLowerCase() ?? "");
}

const SKILLS_VALUE_FLAGS = new Set([
  "--client",
  "--agent",
  "-a",
  "--scope",
  "--cwd",
  "--mcp-url",
  "--mode",
]);

function explicitSkillTargets(args: string[]): string[] {
  const targets: string[] = [];
  const start = args[0] === "add" ? 1 : 0;
  for (let index = start; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--skill" || arg === "-s") {
      if (args[index + 1]) targets.push(args[++index]);
      continue;
    }
    if (arg.startsWith("--skill=")) {
      targets.push(arg.slice("--skill=".length));
      continue;
    }
    if (SKILLS_VALUE_FLAGS.has(arg)) {
      index++;
      continue;
    }
    if (arg.startsWith("-")) continue;
    targets.push(arg);
  }
  return targets;
}

// Every case in the command switch in index.ts. Anything else is a typo or a
// prompt for Agent-Native Code ("fix tests"), which never leaves the machine.
const KNOWN_CLI_COMMANDS: ReadonlySet<string> = new Set([
  "--help",
  "--version",
  "-h",
  "-v",
  "action",
  "add",
  "add-app",
  "agent",
  "agents",
  "amplify-stream",
  "app-skill",
  "audit-agent-web",
  "build",
  "changelog",
  "clean",
  "code",
  "connect",
  "content",
  "create",
  "create-workspace",
  "db-migrate",
  "deploy",
  "design",
  "dev",
  "doctor",
  "eject",
  "eval",
  "identity",
  "info",
  "invoke",
  "mcp",
  "migrate",
  "netlify-deploy",
  "package",
  "plan",
  "plugin",
  "reauth",
  "recap",
  "reconnect",
  "script",
  "setup-agents",
  "skills",
  "start",
  "telemetry",
  "template",
  "typecheck",
  "upgrade",
  "visualize-repo",
  "workspace-dev",
]);

export function telemetryCommandName(command: string | undefined): string {
  if (!command) return "none";
  return KNOWN_CLI_COMMANDS.has(command) ? command : "unknown";
}

export function shouldTrackCliRun(command: string | undefined, args: string[]) {
  if (command === "telemetry") return false;
  if (command !== "skills") return true;
  if (
    ["list", "status", "update", "help", "--help", "-h"].includes(args[0] ?? "")
  )
    return true;

  const targets = explicitSkillTargets(args);
  if (targets.length === 0) return false;

  const explicitlyTargetsRewind = targets.some(isRewindSkillTarget);
  return !explicitlyTargetsRewind;
}
