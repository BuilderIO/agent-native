import { recordChange } from "@agent-native/core/server/poll";

/**
 * The framework's `action` change event is scoped to the caller, so a
 * collaborator's open editor never hears about design rows another user
 * changed (frame geometry, screens added or deleted, breakpoints). This event
 * is scoped to the design instead, so every user with access to it refetches.
 */
export function notifyDesignChanged(
  designId: string,
  requestSource?: string | null,
): void {
  recordChange({
    source: "design",
    type: "design-changed",
    key: designId,
    resourceType: "design",
    resourceId: designId,
    ...(requestSource ? { requestSource } : {}),
  });
}

type DesignChangeAction = {
  run: (params: any, context?: any) => unknown;
};

function didChange(result: unknown): boolean {
  if (!result || typeof result !== "object") return true;
  const outcome = result as Record<string, unknown>;
  return (
    outcome.stale !== true &&
    outcome.changed !== false &&
    outcome.deleted !== false &&
    outcome.renamed !== false
  );
}

/**
 * Publish a design-scoped change event after a design-mutating action
 * succeeds. `designId` reads the design from the call's params or result.
 */
export function publishesDesignChange<T extends DesignChangeAction>(
  action: T,
  target: { designId: (params: any, result: any) => string | undefined },
): T {
  return {
    ...action,
    run: async (params: unknown, context?: unknown) => {
      const result = await action.run(params, context);
      const designId = target.designId(params, result);
      if (designId && didChange(result)) {
        notifyDesignChanged(
          designId,
          (
            context as { requestHeaders?: Headers } | undefined
          )?.requestHeaders?.get("x-request-source"),
        );
      }
      return result;
    },
  };
}
