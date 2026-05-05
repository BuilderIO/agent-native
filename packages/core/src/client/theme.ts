export type ThemePreference = "light" | "dark" | "system";

function normalizeDefaultTheme(theme: ThemePreference): ThemePreference {
  if (theme === "light" || theme === "dark" || theme === "system") {
    return theme;
  }
  return "system";
}

export function getThemeInitScript(
  defaultTheme: ThemePreference = "system",
  enableSystem = true,
) {
  const safeDefaultTheme = normalizeDefaultTheme(defaultTheme);
  const systemEnabled = enableSystem ? "true" : "false";

  return `(function(){try{var defaultTheme=${JSON.stringify(safeDefaultTheme)};var enableSystem=${systemEnabled};var stored=window.localStorage.getItem('theme');var valid=stored==='light'||stored==='dark'||stored==='system'||stored==='auto';var mode=valid?stored:defaultTheme;if(mode==='auto')mode='system';if(!enableSystem&&mode==='system')mode=defaultTheme==='system'?'light':defaultTheme;if(!valid){window.localStorage.removeItem('theme')}else if(stored!==mode){window.localStorage.setItem('theme',mode)}var prefersDark=enableSystem&&mode==='system'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches;var resolved=mode==='system'?(prefersDark?'dark':'light'):mode;var root=document.documentElement;root.classList.remove('light','dark');root.classList.add(resolved);if(mode==='system'){root.removeAttribute('data-theme')}else{root.setAttribute('data-theme',mode)}root.style.colorScheme=resolved;}catch(e){}})();`;
}

export const themeInitScript = getThemeInitScript();
