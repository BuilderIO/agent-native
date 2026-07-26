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

  const skillArgs =
    args[0] === "add"
      ? args.slice(1)
      : isRewindSkillTarget(args[0])
        ? args
        : [];

  const explicitlyTargetsRewind = skillArgs.some(
    (arg, index) =>
      isRewindSkillTarget(arg) ||
      (arg.startsWith("--skill=") &&
        isRewindSkillTarget(arg.slice("--skill=".length))) ||
      (arg === "--skill" && isRewindSkillTarget(skillArgs[index + 1])),
  );
  return !explicitlyTargetsRewind;
}
