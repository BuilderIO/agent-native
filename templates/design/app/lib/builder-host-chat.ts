/**
 * Hand selection and pending visual edits to the embedding host's chat instead
 * of the editor's own agent.
 *
 * `submit: false` throughout: the host prefills its composer so the user can
 * say what they actually want before the turn is spent.
 */

import { sendToBuilderChat } from "@agent-native/core/client/host";

/** The host's chip syntax is attribute-quoted, so a stray `"` truncates it. */
function chipAttribute(value: string, max: number): string {
  return value.replace(/\s+/g, " ").replace(/"/g, "'").trim().slice(0, max);
}

export function builderSelectionChip(args: {
  label: string;
  detail: string;
}): string {
  return `<chip text="${chipAttribute(args.label, 80)}" detail="${chipAttribute(
    args.detail,
    240,
  )}" />`;
}

export function sendBuilderSelectionContext(args: {
  label: string;
  detail: string;
}): boolean {
  return sendToBuilderChat({
    message: `${builderSelectionChip(args)} `,
    submit: false,
  });
}
