export function isRadixOverlayOpen(wrapperEl: Element): boolean {
  if (wrapperEl.hasAttribute("data-agent-native-tooltip")) return false;
  const isOpenState = (el: Element) =>
    el.getAttribute("data-state") !== "closed";
  const stateful = wrapperEl.querySelectorAll("[data-state]");
  if (stateful.length > 0) {
    const allTooltips = Array.from(stateful).every((content) =>
      content.hasAttribute("data-agent-native-tooltip"),
    );
    if (allTooltips) return false;
    if (wrapperEl.hasAttribute("data-state")) {
      return isOpenState(wrapperEl);
    }
    return Array.from(stateful).some(
      (content) =>
        !content.hasAttribute("data-agent-native-tooltip") &&
        isOpenState(content),
    );
  }
  if (wrapperEl.hasAttribute("data-state")) {
    return isOpenState(wrapperEl);
  }
  return true;
}
