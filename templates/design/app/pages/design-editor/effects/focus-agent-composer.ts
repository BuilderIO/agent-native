const AGENT_PANEL_SELECTOR = "[data-design-agent-panel]";
const MAX_FRAMES = 60;

function composerIn(panel: Element | null): HTMLElement | null {
  const editor = panel?.querySelector(".ProseMirror");
  if (editor) return editor as HTMLElement;
  const textarea = panel?.querySelector("textarea");
  return textarea ? (textarea as HTMLElement) : null;
}

function userIsTypingElsewhere(): boolean {
  const active = document.activeElement as HTMLElement | null;
  if (!active || active === document.body) return false;
  return (
    active.isContentEditable ||
    active.tagName === "INPUT" ||
    active.tagName === "TEXTAREA" ||
    active.tagName === "SELECT"
  );
}

export function focusAgentComposer(): void {
  let framesLeft = MAX_FRAMES;
  const attempt = () => {
    if (userIsTypingElsewhere()) return;
    const target = composerIn(document.querySelector(AGENT_PANEL_SELECTOR));
    if (target) {
      target.focus();
      if (document.activeElement === target) return;
    }
    if (framesLeft-- > 0) requestAnimationFrame(attempt);
  };
  requestAnimationFrame(attempt);
}
