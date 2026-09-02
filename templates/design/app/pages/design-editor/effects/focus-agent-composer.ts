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

/**
 * Puts the caret in the agent composer. Opening the panel cold mounts its
 * editor asynchronously, so a single frame finds no `.ProseMirror` and used to
 * leave focus on `<body>` while reporting nothing — retry across a bounded
 * window instead, and stop the moment the user starts typing somewhere else.
 */
export function focusAgentComposer(): void {
  let framesLeft = MAX_FRAMES;
  const attempt = () => {
    if (userIsTypingElsewhere()) return;
    const target = composerIn(document.querySelector(AGENT_PANEL_SELECTOR));
    // A composer rendered before its provider is connected is disabled, so it
    // is present but not focusable and `focus()` no-ops. Confirm the caret
    // actually landed rather than reporting a focus we never took.
    if (target) {
      target.focus();
      if (document.activeElement === target) return;
    }
    if (framesLeft-- > 0) requestAnimationFrame(attempt);
  };
  requestAnimationFrame(attempt);
}
