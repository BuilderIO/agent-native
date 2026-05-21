import {
  getViteDevRecoveryScript,
  shouldInlineViteDevRecoveryScript,
} from "./vite-dev-recovery-script.js";

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

  const themeScript = `(function(){function m(){var d={};return{get length(){return Object.keys(d).length},key:function(i){return Object.keys(d)[i]||null},getItem:function(k){k=String(k);return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null},setItem:function(k,v){d[String(k)]=String(v)},removeItem:function(k){delete d[String(k)]},clear:function(){d={}}}}function s(n){try{var x=window[n],p='__an_storage_probe__';x.setItem(p,'1');x.removeItem(p)}catch(e){try{Object.defineProperty(window,n,{configurable:true,value:m()})}catch(_){}}}s('localStorage');s('sessionStorage');try{var defaultTheme=${JSON.stringify(safeDefaultTheme)};var enableSystem=${systemEnabled};var stored=window.localStorage.getItem('theme');var valid=stored==='light'||stored==='dark'||stored==='system'||stored==='auto';var mode=valid?stored:defaultTheme;if(mode==='auto')mode='system';if(!enableSystem&&mode==='system')mode=defaultTheme==='system'?'light':defaultTheme;if(!valid){window.localStorage.removeItem('theme')}else if(stored!==mode){window.localStorage.setItem('theme',mode)}var prefersDark=enableSystem&&mode==='system'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches;var resolved=mode==='system'?(prefersDark?'dark':'light'):mode;var root=document.documentElement;root.classList.remove('light','dark');root.classList.add(resolved);root.setAttribute('data-theme',resolved);root.style.colorScheme=resolved;var appearance=window.localStorage.getItem('appearance');var appearanceValid=appearance==='warm'||appearance==='ocean'||appearance==='forest'||appearance==='rose'||appearance==='slate';if(appearanceValid){root.setAttribute('data-appearance',appearance)}else{root.removeAttribute('data-appearance');if(appearance!==null)window.localStorage.removeItem('appearance')}}catch(e){}})();`;
  if (!shouldInlineViteDevRecoveryScript()) return themeScript;
  return `${themeScript}\n${getViteDevRecoveryScript()}`;
}

export const themeInitScript = getThemeInitScript();
