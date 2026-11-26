const CREATE_VERB =
  "(?:make|build|create|generate|scaffold|spin\\s+up|start|prototype|write|code|design)";
const FILLER =
  "(?:\\s+(?:me|us|myself|for\\s+me|please|quickly|a|an|my|own|new|brand[- ]new|simple|small|little|tiny|local|quick|basic|web|desktop|native|agent[- ]native|[a-z]+[- ]?style))*";
const APP_NOUN = "(?:app|application|webapp|web\\s+app|mini[- ]app)";

const CREATE_APP_PATTERN = new RegExp(
  `^(?:(?:hey|ok|okay|so|please|pls|can\\s+you|could\\s+you|would\\s+you|i\\s+want\\s+(?:you\\s+)?to|i(?:'d|\\s+would)\\s+like\\s+(?:you\\s+)?to|let(?:'s|\\s+us)|help\\s+me)[\\s,]+)*${CREATE_VERB}${FILLER}(?:\\s+[a-z0-9-]+){0,3}?\\s+${APP_NOUN}\\b`,
  "i",
);

const NOT_A_NEW_APP_PATTERN =
  /\b(?:this|the\s+current|existing|my\s+existing)\s+app\b|\bapp\s+(?:store|icon|bar|router|shell)\b/i;

export function isCreateLocalAppPrompt(prompt: string): boolean {
  const text = prompt.replace(/\s+/g, " ").trim();
  if (!text || text.length > 8_000) return false;
  if (NOT_A_NEW_APP_PATTERN.test(text.slice(0, 160))) return false;
  return CREATE_APP_PATTERN.test(text);
}
