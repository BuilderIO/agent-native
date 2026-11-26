/** Persist the stable token ID and an authored fallback alongside the property. */
export interface PropertyBinding<T> {
  value: T;
  token?: string;
}
export interface PropertyToken<T> {
  id: string;
  label: string;
  value: T;
}

const catalogs = new WeakMap<
  readonly PropertyToken<unknown>[],
  ReadonlyMap<string, PropertyToken<unknown>>
>();
function catalog<T>(tokens: readonly PropertyToken<T>[]) {
  const existing = catalogs.get(tokens);
  if (existing) return existing as ReadonlyMap<string, PropertyToken<T>>;
  const index = new Map<string, PropertyToken<T>>();
  for (const token of tokens) {
    if (index.has(token.id))
      throw new Error("Duplicate property token: " + token.id);
    index.set(token.id, token);
  }
  catalogs.set(tokens, index);
  return index;
}

export function resolvePropertyToken<T>(
  property: PropertyBinding<T>,
  tokens: readonly PropertyToken<T>[],
) {
  const token =
    property.token === undefined
      ? undefined
      : catalog(tokens).get(property.token);
  return token ? token.value : property.value;
}

export function findPropertyToken<T>(
  id: string,
  tokens: readonly PropertyToken<T>[],
) {
  return catalog(tokens).get(id);
}

/** Create the same serializable binding for a document action or a field edit. */
export function bindPropertyToken<T>(
  id: string,
  tokens: readonly PropertyToken<T>[],
): PropertyBinding<T> {
  const token = findPropertyToken(id, tokens);
  if (!token) throw new Error("Unknown property token: " + id);
  return { token: id, value: token.value };
}

export function detachPropertyToken<T>(
  property: PropertyBinding<T>,
  tokens: readonly PropertyToken<T>[],
): PropertyBinding<T> {
  return { value: resolvePropertyToken(property, tokens) };
}
