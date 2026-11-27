export const CANVAS_IMAGE_ROUTE = "/api/canvas-image";
export const CANVAS_IMAGE_MAX_EDGE = 2048;
export const CANVAS_IMAGE_DENIED_MESSAGE = "agent-native:canvas-image-denied";

const NON_RASTER_PATH = /\.svg$/i;
const PRIVATE_HOST =
  /^(?:(?:.+\.)?(?:localhost|local|test|example|invalid)|0\.0\.0\.0|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|\[(?:::1?|f[cd][0-9a-f]*:[^\]]*|fe80:[^\]]*)\])$/i;
const NON_IMAGE_CSS_PATH = /\.(?:svg|woff2?|ttf|otf|eot|css)$/i;

export interface CanvasImageAuth {
  subject: string;
  exp: number;
  token: string;
}

export interface CanvasImageProxy {
  origin: string;
  route: string;
  auth: CanvasImageAuth;
}

export function isCanvasImagePath(pathname: string): boolean {
  return pathname.endsWith(CANVAS_IMAGE_ROUTE);
}

function authQuery(auth: CanvasImageAuth): string {
  return `&u=${encodeURIComponent(auth.subject)}&exp=${auth.exp}&t=${encodeURIComponent(auth.token)}`;
}

export function toCanvasImageUrl(
  src: string,
  proxy: CanvasImageProxy,
): string | null {
  if (typeof src !== "string" || src === "" || src !== src.trim()) return null;
  const isProtocolRelative = src.startsWith("//");
  if (!isProtocolRelative && !/^https?:\/\//i.test(src)) return null;
  const absolute = isProtocolRelative ? `https:${src}` : src;
  if (!URL.canParse(absolute)) return null;
  const parsed = new URL(absolute);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (parsed.origin === proxy.origin) return null;
  if (PRIVATE_HOST.test(parsed.hostname)) return null;
  if (NON_RASTER_PATH.test(parsed.pathname)) return null;
  if (isCanvasImagePath(parsed.pathname)) return null;
  return `${proxy.origin}${proxy.route}?src=${encodeSrc(src)}&w=${CANVAS_IMAGE_MAX_EDGE}${authQuery(proxy.auth)}`;
}

const RELATIVE_BASE = "http://canvas-image.invalid";

export function fromCanvasImageUrl(
  url: string,
  origin?: string,
): string | null {
  if (typeof url !== "string" || !url.includes(CANVAS_IMAGE_ROUTE)) return null;
  if (!URL.canParse(url, RELATIVE_BASE)) return null;
  const parsed = new URL(url, RELATIVE_BASE);
  if (parsed.origin !== RELATIVE_BASE && parsed.origin !== origin) return null;
  if (!isCanvasImagePath(parsed.pathname)) return null;
  return parsed.searchParams.get("src");
}

function encodeSrc(src: string): string {
  return encodeURIComponent(src).replace(
    /[()'!*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

const ATTRS = `(?:"[^"]*"|'[^']*'|[^>"'])*`;
const MARKUP_RE = new RegExp(
  `<!--[\\s\\S]*?-->` +
    `|<script\\b[\\s\\S]*?<\\/script\\s*>` +
    `|(<style\\b${ATTRS}>)([\\s\\S]*?)(<\\/style\\s*>)` +
    `|<([a-zA-Z][^\\s/>]*)(${ATTRS})>`,
  "gi",
);
const ATTR_RE =
  /(\s)([^\s"'<>\/=]+)(\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
const CSS_DECLARATION_RE =
  /((?:-webkit-)?(?:background(?:-image|-size)?|border-image(?:-source)?|list-style(?:-image)?|mask(?:-image)?|content|--[\w-]+)\s*:)((?:url\([^)]*\)|[^;}])*)/gi;
const CSS_URL_RE =
  /url\(\s*(?:(&quot;|&#39;|&#x27;|&apos;|"|')([\s\S]*?)\1|([^)\s"']*))\s*\)/gi;

export function withCanvasImageSizing(
  html: string,
  proxy: CanvasImageProxy,
): string {
  if (!html.includes("//")) return html;
  return html.replace(
    MARKUP_RE,
    (
      match,
      styleOpen: string | undefined,
      css: string | undefined,
      styleClose: string | undefined,
      tag: string | undefined,
      attrs: string | undefined,
    ) => {
      if (styleOpen !== undefined) {
        const body = css ?? "";
        const next = rewriteCss(body, proxy, false);
        return next === body ? match : styleOpen + next + styleClose;
      }
      if (tag === undefined) return match;
      const name = tag.toLowerCase();
      const hasImageSrc = name === "img";
      const hasImageSrcset = name === "img" || name === "source";
      const attrText = attrs ?? "";
      const nextAttrs = attrText.replace(
        ATTR_RE,
        (
          attr,
          space: string,
          attrName: string,
          eq: string,
          dq: string | undefined,
          sq: string | undefined,
          bare: string | undefined,
        ) => {
          const lower = attrName.toLowerCase();
          const isSrc = hasImageSrc && lower === "src";
          const isSrcset = hasImageSrcset && lower === "srcset";
          if (!isSrc && !isSrcset && lower !== "style") return attr;
          const raw = dq ?? sq ?? bare ?? "";
          const next = isSrc
            ? rewriteAttrUrl(raw, proxy)
            : isSrcset
              ? rewriteSrcset(raw, proxy)
              : rewriteCss(raw, proxy, true);
          if (next === raw) return attr;
          const quote = dq !== undefined ? '"' : sq !== undefined ? "'" : "";
          return `${space}${attrName}${eq}${quote}${next}${quote}`;
        },
      );
      return nextAttrs === attrText ? match : `<${tag}${nextAttrs}>`;
    },
  );
}

const RESTORE_RE = new RegExp(
  `(https?:\\/\\/[^\\s"'()<>\\/]+)?(?:\\/[^\\s"'()<>?\\/]+)*${CANVAS_IMAGE_ROUTE.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&")}\\?src=([^&\\s"'()<>]*)&(amp;)?w=\\d+(?:&(?:amp;)?u=[\\w-]+&(?:amp;)?exp=\\d+&(?:amp;)?t=[\\w-]+)?`,
  "g",
);

export function restoreCanvasImageUrls(html: string, origin?: string): string {
  if (!html.includes(CANVAS_IMAGE_ROUTE)) return html;
  return html.replace(
    RESTORE_RE,
    (
      match,
      matchedOrigin: string | undefined,
      encoded: string,
      amp?: string,
    ) => {
      if (matchedOrigin !== undefined && matchedOrigin !== origin) return match;
      return restoreMatch(match, encoded, amp);
    },
  );
}

function isOpaqueObject(node: object): boolean {
  if (ArrayBuffer.isView(node) || node instanceof ArrayBuffer) return true;
  return [
    typeof Blob !== "undefined" ? Blob : null,
    typeof MessagePort !== "undefined" ? MessagePort : null,
    typeof ImageBitmap !== "undefined" ? ImageBitmap : null,
  ].some((type) => type !== null && node instanceof type);
}

export function restoreCanvasImageUrlsInMessage(
  data: unknown,
  origin: string,
): void {
  if (typeof data !== "object" || data === null) return;
  const seen = new WeakSet<object>();
  const stack: object[] = [data];
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    if (seen.has(node) || isOpaqueObject(node)) continue;
    seen.add(node);
    const record = node as Record<string | number, unknown>;
    const keys: (string | number)[] = Array.isArray(node)
      ? Array.from(node.keys())
      : Object.keys(record);
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "string") {
        if (!value.includes(CANVAS_IMAGE_ROUTE)) continue;
        const next = restoreCanvasImageUrls(value, origin);
        if (next !== value) record[key] = next;
      } else if (typeof value === "object" && value !== null) {
        stack.push(value);
      }
    }
  }
}

function restoreMatch(match: string, encoded: string, amp?: string): string {
  let original: string;
  try {
    original = decodeURIComponent(encoded);
  } catch {
    return match;
  }
  return amp ? escapeAttrUrl(original) : original;
}

const ATTR_URL_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  '"': "&quot;",
  "'": "&#39;",
  "<": "&lt;",
  ">": "&gt;",
  " ": "&#32;",
  "\t": "&#9;",
  "\n": "&#10;",
  "\f": "&#12;",
  "\r": "&#13;",
};

function escapeAttrUrl(value: string): string {
  return value.replace(/[&"'<> \t\n\f\r]/g, (c) => ATTR_URL_ESCAPES[c] ?? c);
}

function rewriteAttrUrl(raw: string, proxy: CanvasImageProxy): string {
  const next = toCanvasImageUrl(decodeEntities(raw), proxy);
  return next === null ? raw : next.replace(/&/g, "&amp;");
}

function rewriteSrcset(raw: string, proxy: CanvasImageProxy): string {
  let out = "";
  let i = 0;
  while (i < raw.length) {
    const skip = /^[\s,]*/.exec(raw.slice(i))?.[0] ?? "";
    out += skip;
    i += skip.length;
    if (i >= raw.length) break;
    const token = /^\S+/.exec(raw.slice(i))?.[0] ?? "";
    i += token.length;
    const trailing = /,*$/.exec(token)?.[0] ?? "";
    const url = token.slice(0, token.length - trailing.length);
    out += rewriteAttrUrl(url, proxy) + trailing;
    if (trailing) continue;
    const comma = raw.indexOf(",", i);
    const end = comma === -1 ? raw.length : comma;
    out += raw.slice(i, end);
    i = end;
  }
  return out;
}

const SIZE_LENGTH_RE = /^-?(?:\d+\.?\d*|\.\d+)(?:[a-z]+|%)?$/i;
const IMPORTANT_RE = /\s*!\s*important\s*$/i;
const BLOCK_RE = /\{([^{}]*)\}/g;

function splitTopLevel(
  value: string,
  isSeparator: (char: string) => boolean,
): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    const char = value.charAt(i);
    if (char === "(") depth++;
    else if (char === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0 && isSeparator(char)) {
      parts.push(value.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

function sizeTokens(value: string): string[] {
  return splitTopLevel(value, (char) => /\s/.test(char))
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token !== "");
}

function isFixedSize(tokens: string[]): boolean {
  if (tokens.length === 1)
    return tokens[0] === "cover" || tokens[0] === "contain";
  return (
    tokens.length === 2 && tokens.every((token) => SIZE_LENGTH_RE.test(token))
  );
}

function backgroundSizeLayers(value: string): boolean[] {
  return splitTopLevel(value, (char) => char === ",").map((layer) =>
    isFixedSize(sizeTokens(layer)),
  );
}

function shorthandSizeLayers(value: string): boolean[] {
  return splitTopLevel(value, (char) => char === ",").map((layer) => {
    const parts = splitTopLevel(layer, (char) => char === "/");
    if (parts.length !== 2) return false;
    const tokens = sizeTokens(parts[1] ?? "");
    const size = tokens.slice(0, 1);
    const second = tokens
      .slice(1, 2)
      .filter((token) => token === "auto" || SIZE_LENGTH_RE.test(token));
    return isFixedSize(size.concat(second));
  });
}

function declarationName(property: string): string {
  return property
    .replace(/\s*:$/, "")
    .toLowerCase()
    .replace(/^-webkit-/, "");
}

function rewriteCssUrls(
  value: string,
  proxy: CanvasImageProxy,
  inAttribute: boolean,
): string {
  return value.replace(
    CSS_URL_RE,
    (
      whole,
      quote: string | undefined,
      quoted: string | undefined,
      bare: string | undefined,
    ) => {
      const raw = quoted ?? bare ?? "";
      const decoded = inAttribute ? decodeEntities(raw) : raw;
      if (NON_IMAGE_CSS_PATH.test(decoded.replace(/[?#][\s\S]*$/, "")))
        return whole;
      const rewritten = toCanvasImageUrl(decoded, proxy);
      if (rewritten === null) return whole;
      const url = inAttribute ? rewritten.replace(/&/g, "&amp;") : rewritten;
      return quote === undefined
        ? `url(${url})`
        : `url(${quote}${url}${quote})`;
    },
  );
}

function rewriteCssBlock(
  block: string,
  proxy: CanvasImageProxy,
  inAttribute: boolean,
): string {
  let fixedSizes: boolean[] = [];
  let important = false;
  for (const [, property = "", value = ""] of block.matchAll(
    CSS_DECLARATION_RE,
  )) {
    const name = declarationName(property);
    if (name !== "background" && name !== "background-size") continue;
    const isImportant = IMPORTANT_RE.test(value);
    if (important && !isImportant) continue;
    important = isImportant;
    const bare = value.replace(IMPORTANT_RE, "");
    fixedSizes =
      name === "background-size"
        ? backgroundSizeLayers(bare)
        : shorthandSizeLayers(bare);
  }
  return block.replace(
    CSS_DECLARATION_RE,
    (match, property: string, value: string) => {
      const name = declarationName(property);
      if (name.startsWith("--")) return match;
      const next =
        name === "background" || name === "background-image"
          ? splitTopLevel(value, (char) => char === ",")
              .map((layer, index) =>
                fixedSizes[index % Math.max(fixedSizes.length, 1)] === true
                  ? rewriteCssUrls(layer, proxy, inAttribute)
                  : layer,
              )
              .join(",")
          : rewriteCssUrls(value, proxy, inAttribute);
      return next === value ? match : property + next;
    },
  );
}

function rewriteCss(
  css: string,
  proxy: CanvasImageProxy,
  inAttribute: boolean,
): string {
  if (!css.includes("//")) return css;
  if (inAttribute) return rewriteCssBlock(css, proxy, true);
  return css.replace(
    BLOCK_RE,
    (_match, block: string) => `{${rewriteCssBlock(block, proxy, false)}}`,
  );
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeEntities(value: string): string {
  if (!value.includes("&")) return value;
  return value.replace(
    /&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|(amp|lt|gt|quot|apos));/g,
    (match, dec?: string, hex?: string, named?: string) => {
      if (named) return NAMED_ENTITIES[named] ?? match;
      const code = dec ? parseInt(dec, 10) : parseInt(hex ?? "", 16);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    },
  );
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

const SCRIPT_CLOSE = ["</", "script>"].join("");

export function canvasImageFrameBootstrap(proxy: CanvasImageProxy): string {
  const { origin, route, auth } = proxy;
  const literal = (value: unknown) =>
    JSON.stringify(value).replace(/</g, "\\u003c");
  return `<script data-agent-native-canvas-image-bootstrap data-origin="${escapeAttr(origin)}">${String.raw`(function(){try{
var ORIGIN=${literal(origin)},AUTH=${literal(auth)},ROUTE=${literal(CANVAS_IMAGE_ROUTE)},PATH=${literal(route)},DENIED=${literal(CANVAS_IMAGE_DENIED_MESSAGE)},EDGE=${CANVAS_IMAGE_MAX_EDGE};
var NON_RASTER=/\.svg$/i,PRIVATE_HOST=new RegExp(${literal(PRIVATE_HOST.source)},"i");
var PROXY="(?:https?://[^\\s\"'()<>/]+)?(?:/[^\\s\"'()<>?/]+)*"+ROUTE+"\\?src=([^&\\s\"'()<>]*)&w=\\d+(?:&u=[\\w-]+&exp=\\d+&t=[\\w-]+)?";
var RESTORE=new RegExp(PROXY,"g");
var failed=new WeakMap(),probes=new Map();
function enc(s){return encodeURIComponent(s).replace(/[()'!*]/g,function(c){return "%"+c.charCodeAt(0).toString(16).toUpperCase();});}
function toUrl(src){
if(typeof src!=="string"||src===""||src!==src.trim())return null;
var rel=src.indexOf("//")===0;
if(!rel&&!/^https?:\/\//i.test(src))return null;
var abs=rel?"https:"+src:src;
if(!URL.canParse(abs))return null;
var u=new URL(abs);
if(u.protocol!=="http:"&&u.protocol!=="https:")return null;
if(u.origin===ORIGIN||PRIVATE_HOST.test(u.hostname)||NON_RASTER.test(u.pathname)||u.pathname.slice(-ROUTE.length)===ROUTE)return null;
return ORIGIN+PATH+"?src="+enc(src)+"&w="+EDGE+"&u="+encodeURIComponent(AUTH.subject)+"&exp="+AUTH.exp+"&t="+encodeURIComponent(AUTH.token);
}
function toSrcset(raw){
var out="",i=0;
while(i<raw.length){
var skip=/^[\s,]*/.exec(raw.slice(i))[0];
out+=skip;i+=skip.length;
if(i>=raw.length)break;
var token=/^\S+/.exec(raw.slice(i))[0];
i+=token.length;
var trailing=/,*$/.exec(token)[0];
var url=token.slice(0,token.length-trailing.length);
out+=(toUrl(url)||url)+trailing;
if(trailing)continue;
var comma=raw.indexOf(",",i);
var end=comma===-1?raw.length:comma;
out+=raw.slice(i,end);i=end;
}
return out;
}
function denied(){parent.postMessage({type:DENIED},ORIGIN);}
function restore(s){return s.replace(RESTORE,function(m,e){try{return decodeURIComponent(e);}catch(x){return m;}});}
function fix(el){
var tag=el.localName;
if(tag!=="img"&&tag!=="source")return;
var src=el.getAttribute("src"),set=el.getAttribute("srcset"),f=failed.get(el);
if(f&&f.src===src&&f.set===set)return;
var next=tag==="img"&&src!==null?toUrl(src):null;
if(next)el.setAttribute("src",next);
if(set){var nextSet=toSrcset(set);if(nextSet!==set)el.setAttribute("srcset",nextSet);}
}
function restoreCss(url){
var original=restore(url),styled=document.querySelectorAll("[style]"),sheets=document.querySelectorAll("style");
for(var i=0;i<styled.length;i++){var v=styled[i].getAttribute("style");if(v.indexOf(url)>=0)styled[i].setAttribute("style",v.split(url).join(original));}
for(var j=0;j<sheets.length;j++){var t=sheets[j].textContent;if(t.indexOf(url)>=0)sheets[j].textContent=t.split(url).join(original);}
}
function probeCss(text){
if(!text||text.indexOf(ROUTE)<0)return;
var found=text.match(new RegExp(PROXY,"g"))||[];
found.forEach(function(url){
var state=probes.get(url);
if(state==="failed")restoreCss(url);
if(state)return;
probes.set(url,"pending");
var probe=new Image();
probe.onload=function(){probes.set(url,"ok");};
probe.onerror=function(){probes.set(url,"failed");restoreCss(url);denied();};
probe.src=url;
});
}
function scan(node){
if(node.nodeType===3){var p=node.parentNode;if(p&&p.localName==="style")probeCss(p.textContent);return;}
if(node.nodeType!==1)return;
fix(node);
if(node.localName==="style")probeCss(node.textContent);
else probeCss(node.getAttribute("style"));
if(node.firstElementChild){var list=node.querySelectorAll("img,source,style,[style]");for(var i=0;i<list.length;i++){var el=list[i];fix(el);probeCss(el.localName==="style"?el.textContent:el.getAttribute("style"));}}
}
function fallBack(el){
var group=[el],parent=el.parentNode;
if(parent&&parent.localName==="picture"){
var sources=parent.querySelectorAll("source");
for(var i=0;i<sources.length;i++)group.push(sources[i]);
}
for(var j=0;j<group.length;j++){
var t=group[j],touched=false;
["src","srcset"].forEach(function(name){
var v=t.getAttribute(name);
if(v&&v.indexOf(ROUTE)>=0){var r=restore(v);if(r!==v){t.setAttribute(name,r);touched=true;}}
});
if(touched){failed.set(t,{src:t.getAttribute("src"),set:t.getAttribute("srcset")});denied();}
}
}
document.addEventListener("error",function(e){var el=e.target;if(el&&el.localName==="img")fallBack(el);},true);
new MutationObserver(function(records){
for(var i=0;i<records.length;i++){
var r=records[i];
if(r.type==="attributes"){if(r.attributeName==="style")probeCss(r.target.getAttribute("style"));else fix(r.target);}
else{for(var j=0;j<r.addedNodes.length;j++)scan(r.addedNodes[j]);}
}
}).observe(document,{childList:true,subtree:true,attributes:true,attributeFilter:["src","srcset","style"]});
if(document.documentElement)scan(document.documentElement);
}catch(e){console.error("[agent-native] canvas image bootstrap failed",e);}})();`}${SCRIPT_CLOSE}`;
}
