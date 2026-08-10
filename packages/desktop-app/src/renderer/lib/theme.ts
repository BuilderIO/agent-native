/**
 * Reflects the OS color-scheme preference onto the document root.
 *
 * The desktop shell and embedded Agent tab use the same `.dark` / `.light`
 * class-based strategy as the web templates. Electron has no in-app theme
 * picker today, so this mirrors `prefers-color-scheme` live.
 */
export function initRendererTheme(): void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");

  const applyTheme = (isDark: boolean) => {
    document.documentElement.classList.toggle("dark", isDark);
    document.documentElement.classList.toggle("light", !isDark);
  };

  applyTheme(media.matches);
  media.addEventListener("change", (event) => applyTheme(event.matches));
}
