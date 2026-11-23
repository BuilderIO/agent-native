export function includeReferenceSkin(
  command: "serve" | "build",
  value: string | undefined,
  entryExists: boolean,
): boolean {
  return (
    entryExists && (value === "1" || (value !== "0" && command === "serve"))
  );
}
