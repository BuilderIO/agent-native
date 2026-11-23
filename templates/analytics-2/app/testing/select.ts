import { act } from "react";
import { assert } from "vitest";

export function selectTrigger(scope: ParentNode, label: string) {
  const trigger = scope.querySelector<HTMLButtonElement>(
    `button[role="combobox"][aria-label="${label}"]`,
  );
  assert(trigger, `Missing ${label} combobox`);
  return trigger;
}

export function openSelect(scope: ParentNode, label: string) {
  const trigger = selectTrigger(scope, label);
  act(() =>
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    ),
  );
  const list = document.getElementById(
    trigger.getAttribute("aria-controls") ?? "",
  );
  assert(list, `Missing ${label} options`);
  return [...list.querySelectorAll<HTMLElement>('[role="option"]')];
}

export function pickSelect(scope: ParentNode, label: string, choice: string) {
  const option = openSelect(scope, label).find(
    ({ textContent }) => textContent === choice,
  );
  assert(option, `Missing ${choice} in ${label}`);
  act(() => option.click());
}

export function selectLabels(scope: ParentNode, label: string) {
  const options = openSelect(scope, label);
  const labels = options.map(({ textContent }) => textContent);
  act(() =>
    options[0]?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  return labels;
}
