/** Schema dependencies of a framework-created Drizzle getter. Registration is
 * synchronous; createGetDb waits before allowing its first query to execute. */
const dependencies = new WeakMap<() => unknown, Set<() => Promise<void>>>();

export function registerDbDependency(
  getDb: () => unknown,
  ready: () => Promise<void>,
): void {
  let registered = dependencies.get(getDb);
  if (!registered) {
    registered = new Set();
    dependencies.set(getDb, registered);
  }
  registered.add(ready);
}

export function getDbDependencies(
  getDb: () => unknown,
): ReadonlySet<() => Promise<void>> | undefined {
  return dependencies.get(getDb);
}
