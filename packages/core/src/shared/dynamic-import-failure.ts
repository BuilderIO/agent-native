export function isDynamicImportFailureMessage(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const message = value.toLowerCase();
  return (
    message.includes("failed to fetch dynamically imported module") ||
    message.includes("error loading dynamically imported module") ||
    message.includes("importing a module script failed") ||
    message.includes("failed to fetch dynamically imported")
  );
}
