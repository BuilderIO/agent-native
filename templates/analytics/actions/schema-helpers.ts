import { z } from "zod";

// z.coerce.boolean() treats any non-empty string as true, including "false".
// Analytics actions are often called from GET query params and CLI args, so use
// this helper for boolean inputs.
export const cliBoolean = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return value;
}, z.boolean());
