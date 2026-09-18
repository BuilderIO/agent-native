/**
 * Loose validator for an RFC 2822 address-list header value (To/Cc/Bcc).
 * Accepts comma-separated addresses optionally wrapped in `Display Name <addr>`
 * form. Empty input is allowed (caller guards on required-vs-optional). Real
 * full-spec validation is intractable in regex; this catches common malformed
 * values and lets Gmail's server-side validation do the rest.
 */
export function isValidAddressList(value: unknown): boolean {
  if (value === undefined || value === "") return true;
  if (typeof value !== "string" || /[\r\n]/.test(value)) return false;
  const stripped = value.trim();
  if (!stripped) return true;
  const address = /^(?:[^,<>]*<\s*\S+@\S+\.\S+\s*>|\s*\S+@\S+\.\S+\s*)$/;
  return stripped.split(",").every((part) => address.test(part.trim()));
}
