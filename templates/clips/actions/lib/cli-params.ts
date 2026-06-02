import { z } from "zod";

// Coerce string form/CLI values ("true"/"false"/"1"/"0"/"yes"/"no"/"on"/"off")
// to booleans
export const booleanParam = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  return value;
}, z.boolean());
