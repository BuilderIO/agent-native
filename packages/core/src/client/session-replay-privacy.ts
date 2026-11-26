import { SESSION_REPLAY_IFRAME_ATTRIBUTE } from "../session-replay-iframe-protocol.js";

export const SESSION_REPLAY_MASK_ATTRIBUTE = "data-an-mask";
export const SESSION_REPLAY_MASK_PROPS = {
  [SESSION_REPLAY_MASK_ATTRIBUTE]: "",
} as const;
export const SESSION_REPLAY_BLOCK_ATTRIBUTE = "data-an-block";
export const SESSION_REPLAY_BLOCK_PROPS = {
  [SESSION_REPLAY_BLOCK_ATTRIBUTE]: "",
} as const;

export const SESSION_REPLAY_IFRAME_BLOCK_SELECTOR = `iframe[${SESSION_REPLAY_IFRAME_ATTRIBUTE}]`;
export const SESSION_REPLAY_DEFAULT_BLOCK_SELECTOR = [
  SESSION_REPLAY_IFRAME_BLOCK_SELECTOR,
  "[data-sensitive]",
  `[${SESSION_REPLAY_BLOCK_ATTRIBUTE}]`,
  "[data-an-private]",
  "[data-private]",
  ".an-block",
  ".an-replay-block",
  ".an-private",
  ".rr-block",
  "[autocomplete='cc-number']",
  "[autocomplete='cc-csc']",
  "[autocomplete='cc-exp']",
  "[name*='password' i]",
  "[name*='credit' i]",
  "[name*='card' i]",
  "[name*='ssn' i]",
].join(", ");
export const SESSION_REPLAY_DEFAULT_IGNORE_SELECTOR =
  ".an-ignore, [data-an-ignore]";
export const SESSION_REPLAY_DEFAULT_MASK_TEXT_CLASS = "an-mask";
export const SESSION_REPLAY_DEFAULT_MASK_TEXT_SELECTOR = `[${SESSION_REPLAY_MASK_ATTRIBUTE}]`;
