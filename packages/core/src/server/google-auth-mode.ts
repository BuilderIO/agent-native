export type GoogleAuthMode = "auto" | "popup" | "redirect";

const VALID: ReadonlySet<GoogleAuthMode> = new Set([
  "auto",
  "popup",
  "redirect",
]);

function fromEnv(): GoogleAuthMode | undefined {
  const raw = (process.env.GOOGLE_AUTH_MODE || "").trim().toLowerCase();
  return VALID.has(raw as GoogleAuthMode) ? (raw as GoogleAuthMode) : undefined;
}

export function resolveGoogleAuthMode(option?: GoogleAuthMode): GoogleAuthMode {
  if (option && VALID.has(option)) return option;
  return fromEnv() ?? "auto";
}
