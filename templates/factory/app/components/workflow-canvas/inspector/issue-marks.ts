import { createContext, useContext } from "react";

const QuietMarksContext = createContext(false);

/**
 * Holds a form's issue marks back. The step details modal sets it while a step
 * is opened for the first time after it was added, so its fields do not start
 * out marked. Fields read it through `useInvalidMark` and `useQuietMarks`.
 */
export const QuietMarks = QuietMarksContext.Provider;

export function useQuietMarks(): boolean {
  return useContext(QuietMarksContext);
}

/** The `aria-invalid` value for a field: set only while it is invalid and its marks are not held back. */
export function useInvalidMark(invalid: boolean | undefined): true | undefined {
  const quiet = useQuietMarks();
  return invalid && !quiet ? true : undefined;
}
