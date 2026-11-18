/**
 * Actions a `capability:visual-edit:design:<id>` session may run, and the
 * parameter that names the resource each one touches. The capability is a
 * signed-out editor credential for exactly one design, so every entry must
 * name that design (`designId` or `id`) or a file the action itself proves
 * belongs to it (`file`). Sharing, visibility, design creation or deletion,
 * generation, and account settings are deliberately absent.
 */
export const VISUAL_EDIT_CAPABILITY_ACTIONS: Readonly<
  Record<string, "designId" | "id" | "file">
> = Object.freeze({
  "acknowledge-visual-edit-pending": "designId",
  "add-breakpoint": "designId",
  "add-localhost-screens": "designId",
  "apply-tweaks": "designId",
  "clear-edits": "designId",
  "clear-localhost-write-consent-request": "designId",
  "create-file": "designId",
  "get-design": "id",
  "get-design-snapshot": "designId",
  "get-localhost-write-consent-request": "designId",
  "get-visual-edit-pending": "designId",
  "get-visual-edit-snapshot": "designId",
  "list-design-source-capabilities": "designId",
  "list-design-states": "designId",
  "list-files": "designId",
  "list-local-files": "designId",
  "list-localhost-connections": "designId",
  "migrate-board-objects-to-file": "designId",
  "publish-visual-edit-pending": "designId",
  "read-local-file": "designId",
  "refresh-localhost-preview-token": "designId",
  "remove-breakpoint": "designId",
  // The action loads the file and rejects one outside the capability design.
  "rename-screen": "file",
  "request-localhost-write-consent": "designId",
  "update-breakpoint": "designId",
  "update-design": "id",
  // The action loads the file and rejects one outside the capability design.
  "update-file": "file",
  "update-screen-source": "designId",
});

const VISUAL_EDIT_CAPABILITY_RESOURCES = new Map(
  Object.entries(VISUAL_EDIT_CAPABILITY_ACTIONS),
);

const VISUAL_EDIT_CAPABILITY_PREFIX = "capability:visual-edit:";
const VISUAL_EDIT_DESIGN_CAPABILITY_PREFIX = "capability:visual-edit:design:";

export function isVisualEditCapability(
  capability: string | undefined,
): capability is string {
  return capability?.startsWith(VISUAL_EDIT_CAPABILITY_PREFIX) ?? false;
}

export function isVisualEditCapabilityAction(name: string): boolean {
  return VISUAL_EDIT_CAPABILITY_RESOURCES.has(name);
}

/**
 * The design a visual-edit capability is scoped to, or `null` when the scope
 * is not a well-formed design capability.
 */
export function visualEditCapabilityDesignId(
  capability: string | undefined,
): string | null {
  if (!capability?.startsWith(VISUAL_EDIT_DESIGN_CAPABILITY_PREFIX)) {
    return null;
  }
  const encoded = capability.slice(VISUAL_EDIT_DESIGN_CAPABILITY_PREFIX.length);
  if (!encoded || encoded.includes(":")) return null;
  try {
    return decodeURIComponent(encoded) || null;
  } catch {
    // coercion-ok: a malformed scope names no design, so callers fail closed.
    return null;
  }
}

/**
 * Whether a request carrying `capability` may run `actionName` with `params`.
 * Requests without a visual-edit capability are not restricted here.
 */
export function allowsVisualEditCapabilityResource(
  actionName: string,
  capability: string | undefined,
  params: Record<string, unknown>,
): boolean {
  if (!isVisualEditCapability(capability)) return true;
  const resource = VISUAL_EDIT_CAPABILITY_RESOURCES.get(actionName);
  if (!resource) return false;
  const designId = visualEditCapabilityDesignId(capability);
  if (!designId) return false;
  if (resource === "file") {
    return typeof params.id === "string" && params.id.trim().length > 0;
  }
  return params[resource] === designId;
}
