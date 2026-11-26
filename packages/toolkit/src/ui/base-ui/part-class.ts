import { cn } from "../../utils.js";

/**
 * A part's class merged with a caller's `className`, which Base UI lets be a
 * function of the component's state.
 */
export function partClassName<State>(
  part: string,
  className: string | ((state: State) => string | undefined) | undefined,
): string | ((state: State) => string) {
  if (typeof className === "function") {
    return (state: State) => {
      const extra = className(state);
      return extra ? cn(part, extra) : part;
    };
  }
  return className ? cn(part, className) : part;
}
