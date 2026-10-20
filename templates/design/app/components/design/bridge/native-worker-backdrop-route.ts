export function planNativeWorkerBackdropRoute(
  groupLocalOwnerId: string | undefined,
  composingOwnerId: string | undefined,
): "target-source" | "group-local" | "owner-output" {
  if (!groupLocalOwnerId) return "target-source";
  return groupLocalOwnerId === composingOwnerId
    ? "group-local"
    : "owner-output";
}
