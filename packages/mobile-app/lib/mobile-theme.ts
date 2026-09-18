export type MobileTheme = "light" | "dark";

const THEME_CHANGE_EVENT = "agent-native:theme-change";
const THEME_UPDATE_MESSAGE = "agent-native-theme-update";

export function buildMobileGuestThemeScript(theme: MobileTheme): string {
  const encodedTheme = JSON.stringify(theme);
  const isDark = theme === "dark";

  return `(function(){try{var root=document.documentElement;var theme=${encodedTheme};var isDark=${isDark};root.classList.toggle("dark",isDark);root.classList.toggle("light",!isDark);root.setAttribute("data-theme",theme);root.style.colorScheme=theme;try{window.localStorage.setItem("theme",theme)}catch(error){window.console?.warn("Unable to persist embedded theme",error)}var message={type:${JSON.stringify(THEME_UPDATE_MESSAGE)},theme:theme,isDark:isDark};window.dispatchEvent(new CustomEvent(${JSON.stringify(THEME_CHANGE_EVENT)},{detail:message}));try{var frames=window.frames;for(var i=0;i<frames.length;i++){var frame=frames[i];if(frame&&frame!==window&&typeof frame.postMessage==="function"){frame.postMessage(message,"*")}}}catch(error){window.console?.warn("Unable to forward embedded theme",error)}}catch(error){window.console?.warn("Unable to apply embedded theme",error)}})();\ntrue;`;
}
