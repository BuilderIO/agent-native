import { useEffect, useState } from "react";

export type RendererTheme = "light" | "dark";

const EMBEDDED_THEME_CHANGE_EVENT = "agent-native:theme-change";

function readRendererTheme(): RendererTheme {
  if (typeof document === "undefined") return "light";
  const root = document.documentElement;
  return root.classList.contains("dark") || root.dataset.theme === "dark"
    ? "dark"
    : "light";
}

/**
 * Reflects the OS color-scheme preference onto the document root.
 *
 * The desktop shell and embedded Agent tab use the same `.dark` / `.light`
 * class-based strategy as the web templates. Electron has no in-app theme
 * picker today, so this mirrors `prefers-color-scheme` live.
 */
export function initRendererTheme(): void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const root = document.documentElement;

  const applyTheme = (isDark: boolean) => {
    const theme: RendererTheme = isDark ? "dark" : "light";
    root.classList.toggle("dark", isDark);
    root.classList.toggle("light", !isDark);
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
  };

  applyTheme(media.matches);
  media.addEventListener("change", (event) => applyTheme(event.matches));
}

/** Tracks the shell's resolved theme so every live app surface can follow it. */
export function useRendererTheme(): RendererTheme {
  const [theme, setTheme] = useState<RendererTheme>(readRendererTheme);

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setTheme(readRendererTheme());
    const observer = new MutationObserver(sync);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });
    sync();
    return () => observer.disconnect();
  }, []);

  return theme;
}

/**
 * Applies a shell theme inside a webview without relying on an app-specific
 * preload. The custom event lets apps using AppProviders synchronize their
 * next-themes state as well as the initial DOM, while the DOM/localStorage
 * fallback still covers apps that do not use the shared provider.
 */
export function buildGuestThemeScript(theme: RendererTheme): string {
  const encodedTheme = JSON.stringify(theme);
  const encodedEventName = JSON.stringify(EMBEDDED_THEME_CHANGE_EVENT);
  return `(function(){try{var root=document.documentElement;var hostTheme=${encodedTheme};var theme=hostTheme;try{var previousHostTheme=window.localStorage.getItem("agent-native-desktop-host-theme");var storedTheme=window.localStorage.getItem("theme");if((storedTheme==="light"||storedTheme==="dark")&&previousHostTheme&&storedTheme!==previousHostTheme)theme=storedTheme;window.localStorage.setItem("agent-native-desktop-host-theme",hostTheme);window.localStorage.setItem("theme",theme)}catch(error){window.console?.warn("Unable to persist embedded theme",error)}var isDark=theme==="dark";root.classList.toggle("dark",isDark);root.classList.toggle("light",!isDark);root.setAttribute("data-theme",theme);root.style.colorScheme=theme;window.dispatchEvent(new CustomEvent(${encodedEventName},{detail:{type:"agent-native-theme-update",theme:theme,isDark:isDark}}))}catch(error){window.console?.warn("Unable to apply embedded theme",error)}})();`;
}
