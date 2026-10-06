export function readValueOption(args: readonly string[], flag: string) {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  if (args.indexOf(flag, index + 1) >= 0) {
    throw new Error(`${flag} may be provided only once`);
  }
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}
