import type { Machine } from "./index.js";

/** Renders attempted events with their resulting state and SQL source guard. */
export function renderMachineTrace<S extends string, E extends string>(
  machine: Machine<S, E>,
  events: readonly E[],
  initialState: S = machine.initial,
): string {
  let state = machine.parseState(initialState);
  return events
    .map((event) => {
      const accepted = machine.can(state, event);
      if (accepted) state = machine.transition(state, event);
      const outcome = accepted ? "" : " (rejected)";
      return `${event} -> ${state}${outcome} [guard: ${machine.sqlStateList(event)}]`;
    })
    .join("\n");
}
