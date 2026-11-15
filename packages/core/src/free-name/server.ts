import { ActionContractError, NoWriteError } from "../action.js";
import { NAME_TAKEN_ERROR_CODE } from "./index.js";

export {
  isFreeNameFor,
  isNameTaken,
  NAME_TAKEN_ERROR_CODE,
  nextFreeName,
} from "./index.js";
export type { NameTakenDetails } from "./index.js";

/**
 * The one typed refusal for a name another record already has. It says so
 * and carries a free name, so a person or an agent can take that instead of
 * guessing again. `record` names what was being named in a word or two, like
 * `file` or `screen`. Pass `noWrite` when the action refuses before saving
 * anything, as `defineActionErrors().noWrite` does, and `hint` for what else
 * the caller might have meant, such as editing the record that has the name.
 */
export function nameTaken(
  record: string,
  name: string,
  suggestion: string,
  options: { noWrite?: boolean; hint?: string } = {},
): ActionContractError {
  const message = `A ${record} named "${name}" already exists. Pick another name, such as "${suggestion}", which is free.${options.hint ? ` ${options.hint}` : ""}`;
  const errorOptions = {
    errorCode: NAME_TAKEN_ERROR_CODE,
    statusCode: 409,
    details: { name, suggestion },
  };
  return options.noWrite
    ? new NoWriteError(message, errorOptions)
    : new ActionContractError(message, errorOptions);
}
