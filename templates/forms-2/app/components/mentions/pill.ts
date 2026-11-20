import { mentionToken, type MentionRef } from "@shared/form-model";

const PILL_CLASS =
  "mx-px inline rounded bg-primary/10 px-1 py-px font-medium text-primary";

export function createMentionPill(
  ref: MentionRef,
  label: string,
): HTMLSpanElement {
  const pill = document.createElement("span");
  pill.contentEditable = "false";
  pill.dataset.mention = mentionToken(ref);
  pill.className = PILL_CLASS;
  pill.textContent = label;
  return pill;
}
