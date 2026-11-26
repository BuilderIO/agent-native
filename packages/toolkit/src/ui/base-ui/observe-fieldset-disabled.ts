export function observeFieldsetDisabled(
  control: Element,
  observer: MutationObserver,
) {
  for (
    let fieldset = control.closest("fieldset");
    fieldset;
    fieldset = fieldset.parentElement?.closest("fieldset") ?? null
  ) {
    observer.observe(fieldset, { attributeFilter: ["disabled"] });
  }
}
