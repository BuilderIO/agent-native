/**
 * A freshly added input opens its own settings so the person names it before
 * a SQL cell reads it. The add flow records the new cell id; the cell's
 * settings consume it whether they mount before or after the request lands.
 */
const EVENT = "analytics:input-config-request";
const pending = new Set<string>();

export function requestInputConfig(cellId: string): void {
  pending.add(cellId);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: cellId }));
}

export function consumeInputConfigRequest(cellId: string): boolean {
  return pending.delete(cellId);
}

export function onInputConfigRequest(
  cellId: string,
  listener: () => void,
): () => void {
  const handle = (event: Event) => {
    if ((event as CustomEvent<string>).detail === cellId) listener();
  };
  window.addEventListener(EVENT, handle);
  return () => window.removeEventListener(EVENT, handle);
}
