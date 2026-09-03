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

export function shouldTrackCliRun(command: string | undefined, args: string[]) {
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
