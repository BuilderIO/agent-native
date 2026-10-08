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

export function buildGuestThemeScript(theme: RendererTheme): string {
  const encodedTheme = JSON.stringify(theme);
  const encodedEventName = JSON.stringify(EMBEDDED_THEME_CHANGE_EVENT);
  return `(function(){try{var root=document.documentElement;var hostTheme=${encodedTheme};var theme=hostTheme;try{var storage=window.localStorage;var hostKey="agent-native-desktop-host-theme";var overrideKey="agent-native-desktop-guest-theme";var appliedKey="agent-native-desktop-applied-theme";var previousHostTheme=storage.getItem(hostKey);var previousAppliedTheme=storage.getItem(appliedKey);var storedTheme=storage.getItem("theme");var guestTheme=storage.getItem(overrideKey);if((previousAppliedTheme==="light"||previousAppliedTheme==="dark")&&storedTheme!==previousAppliedTheme){if(storedTheme==="light"||storedTheme==="dark"){guestTheme=storedTheme;storage.setItem(overrideKey,storedTheme)}else{guestTheme=null;storage.removeItem(overrideKey)}}else if(guestTheme!=="light"&&guestTheme!=="dark"&&(storedTheme==="light"||storedTheme==="dark")&&previousHostTheme&&storedTheme!==previousHostTheme){guestTheme=storedTheme;storage.setItem(overrideKey,storedTheme)}if(guestTheme==="light"||guestTheme==="dark")theme=guestTheme;storage.setItem(hostKey,hostTheme);storage.setItem(appliedKey,theme);storage.setItem("theme",theme)}catch(error){window.console?.warn("Unable to persist embedded theme",error)}var isDark=theme==="dark";root.classList.toggle("dark",isDark);root.classList.toggle("light",!isDark);root.setAttribute("data-theme",theme);root.style.colorScheme=theme;window.dispatchEvent(new CustomEvent(${encodedEventName},{detail:{type:"agent-native-theme-update",theme:theme,isDark:isDark}}))}catch(error){window.console?.warn("Unable to apply embedded theme",error)}})();`;
}
