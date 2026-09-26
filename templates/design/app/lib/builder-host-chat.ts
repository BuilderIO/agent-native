
import { sendToBuilderChat } from "@agent-native/core/client/host";

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
