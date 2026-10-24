// The agent pretty-prints (2-space indent) a tool result and caps it at the
// action's effective limit (`resolveToolMaxResultChars`). An action whose
// result can exceed it fits the result itself instead of letting the cap cut it
// off mid-field.
export interface ResultTooLarge {
  error: "result_too_large";
  sizeChars: number;
  capChars: number;
  guidance: string;
  [key: string]: unknown;
}

export interface FitContext<S> {
  overage: number;
  fits: (state: S) => boolean;
}

// A step returns a smaller state, or the same one when it has nothing left to
// trim. It may use `fits` to search for the largest state that still fits.
export type FitStep<S> = (state: S, context: FitContext<S>) => S;

export function serializedResultChars(value: unknown): number {
  return JSON.stringify(value, null, 2).length;
}

// `build` makes the complete result, guidance included, from the state, so
// every number and sentence in it describes what is actually returned. Steps
// run in order until it fits; if they run out, the caller gets a typed error
// instead of an over-cap result.
export function fitResult<S, R extends object>(options: {
  initial: S;
  build: (state: S) => R;
  steps: FitStep<S>[];
  summarize: (state: S) => Record<string, unknown>;
  guidance: string;
  cap: number;
}): R | ResultTooLarge {
  const cap = options.cap;
  let state = options.initial;
  let result = options.build(state);
  let size = serializedResultChars(result);
  for (const step of options.steps) {
    if (size <= cap) break;
    state = step(state, {
      overage: size - cap,
      fits: (candidate) =>
        serializedResultChars(options.build(candidate)) <= cap,
    });
    result = options.build(state);
    size = serializedResultChars(result);
  }
  if (size <= cap) return result;
  return {
    error: "result_too_large",
    sizeChars: size,
    capChars: cap,
    ...options.summarize(state),
    guidance: options.guidance,
  };
}
