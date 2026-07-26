const REWIND_SKILL_TARGETS = new Set([
  "rewind",
  "screen-memory",
  "clips-rewind",
  "agent-native-rewind",
]);

function isRewindSkillTarget(value: string | undefined): boolean {
  return REWIND_SKILL_TARGETS.has(value?.trim().toLowerCase() ?? "");
}

export function shouldTrackCliRun(command: string | undefined, args: string[]) {
  if (command !== "skills") return true;
  if (
    ["list", "status", "update", "help", "--help", "-h"].includes(args[0] ?? "")
  )
    return true;

  const skillArgs =
    args[0] === "add"
      ? args.slice(1)
      : isRewindSkillTarget(args[0])
        ? args
        : [];

  if (args[0] === "add" && skillArgs.length === 0) return false;

  const flagSkillTargets = args.flatMap((arg, index) => {
    if (arg === "--skill" || arg === "-s") return [args[index + 1]];
    if (arg.startsWith("--skill=")) return [arg.slice("--skill=".length)];
    return [];
  });
  const positionalTarget = skillArgs[0]?.startsWith("-")
    ? undefined
    : skillArgs[0];
  const explicitSkillTargets = [positionalTarget, ...flagSkillTargets].filter(
    (target): target is string => Boolean(target),
  );

  if (explicitSkillTargets.length === 0) return false;

  const explicitlyTargetsRewind =
    explicitSkillTargets.some(isRewindSkillTarget);
  return !explicitlyTargetsRewind;
}
