/**
 * What the Import cURL dialog holds between keystrokes. A pasted command can
 * carry a credential, so the paste box is emptied the moment the command has
 * been imported and again whenever the dialog closes, however it closes. A
 * command that could not be imported stays, so it can be fixed instead of pasted
 * again.
 */
export interface ImportState {
  command: string;
  /** Why the last import was refused, in words. */
  error: string | null;
  /** What an import left out, once it has succeeded and something was; null before. */
  left: string[] | null;
}

export const EMPTY_IMPORT: ImportState = {
  command: "",
  error: null,
  left: null,
};

export type ImportAction =
  | { type: "typed"; command: string }
  | { type: "refused"; error: string }
  | { type: "imported"; left: string[] | null }
  | { type: "closed" };

export function importReducer(
  state: ImportState,
  action: ImportAction,
): ImportState {
  switch (action.type) {
    case "typed":
      return { ...state, command: action.command, error: null };
    case "refused":
      return { ...state, error: action.error };
    case "imported":
      return { command: "", error: null, left: action.left };
    case "closed":
      return EMPTY_IMPORT;
  }
}
