/**
 * For specs that call a plugin's resolveId or load hook directly. Calls it the
 * way Vite and Rolldown do: an id the hook's filter rejects never reaches the
 * handler, so a filter that is narrower than its handler fails the spec.
 */
export function callPluginHook(
  hook: unknown,
  thisArg: unknown,
  id: string,
  ...rest: unknown[]
): unknown {
  if (typeof hook === "function") {
    return Reflect.apply(hook, thisArg, [id, ...rest]);
  }
  const { filter, handler } = hook as {
    filter?: { id?: RegExp };
    handler: (...args: never[]) => unknown;
  };
  if (filter?.id && !filter.id.test(id)) return null;
  return Reflect.apply(handler, thisArg, [id, ...rest]);
}
