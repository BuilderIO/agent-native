export function isValidAddressList(value: unknown): boolean {
  if (value === undefined || value === "") return true;
  if (typeof value !== "string" || /[\r\n]/.test(value)) return false;
  const stripped = value.trim();
  if (!stripped) return true;
  const address = /^(?:[^,<>]*<\s*\S+@\S+\.\S+\s*>|\s*\S+@\S+\.\S+\s*)$/;
  return stripped.split(",").every((part) => address.test(part.trim()));
}
