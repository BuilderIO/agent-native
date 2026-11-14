export type ModelInputScopeGuard = () => boolean | Promise<boolean>;

export const MODEL_INPUT_SCOPE_ABORT_REASON = "user_input_scope_changed";

/** Ephemeral, server-owned guards; never put callbacks in run history. */
export function createModelInputScopeGuardRegistry(onRefused?: () => void) {
  const guards = new Set<ModelInputScopeGuard>();
  let refused = false;

  const refuse = () => {
    if (!refused) {
      refused = true;
      try {
        onRefused?.();
      } catch {
        // coercion-ok: a lifecycle observer cannot restore permission to dispatch; refusal stands.
      }
    }
    return false;
  };

  return {
    register(guard: ModelInputScopeGuard): boolean {
      if (refused) return false;
      if (typeof guard !== "function") {
        return refuse();
      }
      guards.add(guard);
      return true;
    },
    validate(): boolean | Promise<boolean> {
      if (refused) return Promise.resolve(false);
      if (guards.size === 0) return true;
      return (async () => {
        for (const guard of guards) {
          try {
            const current = guard();
            if (current !== true && (await current) !== true) {
              return refuse();
            }
          } catch {
            return refuse();
          }
        }
        return !refused;
      })();
    },
  };
}
