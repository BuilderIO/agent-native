import {
  type BuilderChatMessage,
  sendToBuilderChat,
} from "@agent-native/core/client/host";

import {
  getDesignHostChannel,
  isInProcessDesignHost,
} from "@/host/design-host-channel";

/**
 * Hand a message to the host's chat. Under an in-process host this is a direct
 * call on the host channel; otherwise it is the `builder.submitChat`
 * postMessage that core already sends to `window.parent`.
 */
export function sendToHostChat(opts: BuilderChatMessage): boolean {
  if (!opts.message?.trim()) return false;
  if (!isInProcessDesignHost()) return sendToBuilderChat(opts);
  const { targetOrigin: _targetOrigin, ...data } = opts;
  getDesignHostChannel().send({ type: "builder.submitChat", data });
  return true;
}

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
  return sendToHostChat({
    message: `${builderSelectionChip(args)} `,
    submit: false,
  });
}
