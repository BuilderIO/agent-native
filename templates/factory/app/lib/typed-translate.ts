import type enUS from "@/i18n/en-US";

type PluralSuffix = "zero" | "one" | "two" | "few" | "many" | "other";

type Join<Prefix extends string, Key extends string> = Prefix extends ""
  ? Key
  : `${Prefix}.${Key}`;

type LeafKeys<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends string
    ? Join<Prefix, K>
    : LeafKeys<T[K], Join<Prefix, K>>;
}[keyof T & string];

type WithoutPluralSuffix<Key extends string> =
  Key extends `${infer Base}_${PluralSuffix}` ? Base : Key;

/** Every key `t()` can be called with: the en-US leaves, with plural forms folded into their base key. */
type CatalogKey = WithoutPluralSuffix<LeafKeys<typeof enUS>>;

export type NamespaceKey<Namespace extends string> = Extract<
  CatalogKey,
  `${Namespace}.${string}`
>;

export type Translate<Key extends string = CatalogKey> = (
  key: Key,
  options?: Record<string, unknown>,
) => string;

/**
 * Builds each group on first read. Every row and chip calls a strings hook, so
 * building all of a module's groups per mount would run hundreds of
 * translations for the few a view uses.
 */
export function lazyGroups<Groups extends Record<string, () => unknown>>(
  groups: Groups,
): { [Name in keyof Groups]: ReturnType<Groups[Name]> } {
  const out = {} as { [Name in keyof Groups]: ReturnType<Groups[Name]> };
  for (const name of Object.keys(groups) as (keyof Groups)[]) {
    let built = false;
    let value: ReturnType<Groups[typeof name]>;
    Object.defineProperty(out, name, {
      enumerable: true,
      get() {
        if (!built) {
          value = groups[name]() as ReturnType<Groups[typeof name]>;
          built = true;
        }
        return value;
      },
    });
  }
  return out;
}
