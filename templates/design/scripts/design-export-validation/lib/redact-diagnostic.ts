const URL_PATTERN = /https?:\/\/[^\s)"'<>]+/gi;
const SENSITIVE_ASSIGNMENT_PATTERN =
  /(["']?\b(?:access[_\s-]?token|refresh[_\s-]?token|client[_\s-]?secret|api[_\s-]?key|token|secret|signature)["']?\s*[:=]\s*["']?)([^&\s"'<>),;}\]]+)/gi;

export function redactExportDiagnostic(value: string): string {
  return value
    .replace(URL_PATTERN, "[URL]")
    .replace(SENSITIVE_ASSIGNMENT_PATTERN, "$1[redacted]");
}
