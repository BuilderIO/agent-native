const REEXPORTS_DEFAULT = /export\s*\{\s*default\s*\}\s*from\s*["'][^"']+["']/;
const EXPORTS_ACTION_WRAPPER =
  /export\s+default\s+(?:(?:create|define)[A-Z][A-Za-z0-9]*Action|defineActionFactory)\s*\(/;

/**
 * Whether an `actions/` source file exports an action. Shared by the generated
 * registry and route discovery so the two cannot disagree about which files
 * are actions.
 */
export function isActionSource(content: string): boolean {
  return (
    content.includes("defineAction") ||
    REEXPORTS_DEFAULT.test(content) ||
    EXPORTS_ACTION_WRAPPER.test(content)
  );
}
