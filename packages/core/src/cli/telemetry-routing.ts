export function shouldTrackCliRun(command: string | undefined, args: string[]) {
  if (command !== "skills" || args[0] !== "add") return true;

  const explicitlyTargetsRewind = args.some(
    (arg, index) =>
      arg === "rewind" ||
      arg === "--skill=rewind" ||
      (arg === "--skill" && args[index + 1] === "rewind"),
  );
  return !explicitlyTargetsRewind;
}
