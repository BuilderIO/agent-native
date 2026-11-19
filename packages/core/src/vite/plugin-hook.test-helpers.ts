// For specs that call a plugin's filtered resolveId or load hook directly.

type FilteredHook = {
  filter: { id: RegExp };
  handler: (...args: never[]) => unknown;
};

/** The id filter Vite and Rolldown test before they call the hook's handler. */
export function hookIdFilter(hook: unknown): RegExp {
  return (hook as FilteredHook).filter.id;
}

/**
 * Calls the hook the way Vite and Rolldown do: an id the hook's filter rejects
 * never reaches the handler, so a filter that is narrower than its handler
 * fails the spec.
 */
export function callPluginHook(
  hook: unknown,
  thisArg: unknown,
  id: string,
  ...rest: unknown[]
): unknown {
  if (!hookIdFilter(hook).test(id)) return null;
  return callHookHandler(hook, thisArg, id, ...rest);
}

/** Calls the handler alone, as a bundler without hook filters would. */
export function callHookHandler(
  hook: unknown,
  thisArg: unknown,
  id: string,
  ...rest: unknown[]
): unknown {
  return Reflect.apply((hook as FilteredHook).handler, thisArg, [id, ...rest]);
}
