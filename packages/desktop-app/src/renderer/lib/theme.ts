/**
 * Reflects the OS color-scheme preference onto the document root.
 *
 * The desktop shell chrome (shell.css) stays a fixed dark palette, but the
 * embedded Agent tab (@agent-native/code-agents-ui/styles.css) ships
 * theme-aware tokens keyed off a `.dark` class on `<html>` — the same
 * class-based strategy `@agent-native/core`'s web templates use. Electron
 * has no in-app theme picker today, so this just mirrors
 * `prefers-color-scheme` live instead of exposing a separate setting.
 */
export function initRendererTheme(): void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");

  const applyTheme = (isDark: boolean) => {
    document.documentElement.classList.toggle("dark", isDark);
  };

  applyTheme(media.matches);
  media.addEventListener("change", (event) => applyTheme(event.matches));
}
