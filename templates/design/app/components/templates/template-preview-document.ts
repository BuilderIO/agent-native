import {
  parse,
  parseFragment,
  serialize,
  type DefaultTreeAdapterMap,
} from "parse5";

import {
  localRuntimeUrls,
  withLocalRuntimes,
} from "@/components/design/design-canvas/local-runtime";

const NAVIGATION_GUARD = `<script>
document.addEventListener('click', function(event) {
  var link = event.target && event.target.closest && event.target.closest('a[href]');
  if (!link) return;
  var href = link.getAttribute('href');
  if (href && href.charAt(0) === '#') return;
  event.preventDefault();
  if (href) parent.postMessage({type:'design-template-preview:navigate', href:href}, '*');
}, true);
document.addEventListener('submit', function(event) { event.preventDefault(); }, true);
document.addEventListener('keydown', function(event) {
  if (event.key === 'Escape') {
    event.preventDefault();
    parent.postMessage({type:'design-template-preview:escape'}, '*');
  }
}, true);
if (window.navigation) window.navigation.addEventListener('navigate', function(event) {
  if (!event.hashChange && event.cancelable) event.preventDefault();
});
</script>`;

export function templatePreviewDocument(html: string): string {
  const runtimes = localRuntimeUrls();
  const document = parse(withLocalRuntimes(html, runtimes));
  const renderOrigins = new Set<string>();
  const ownOrigin =
    typeof window === "undefined" ? null : window.location.origin;
  for (const match of html.matchAll(/https:\/\/[^\s"'<>()[\]{}]+/g)) {
    let url: URL;
    try {
      url = new URL(match[0]);
    } catch {
      continue;
    }
    if (url.origin !== ownOrigin && !url.username && !url.password)
      renderOrigins.add(url.origin);
  }
  const visit = (node: DefaultTreeAdapterMap["node"]) => {
    if (!("childNodes" in node)) return;
    node.childNodes = node.childNodes.filter(
      (child) =>
        !(
          "tagName" in child &&
          child.tagName === "meta" &&
          child.attrs.some(
            (attr) =>
              attr.name === "http-equiv" &&
              attr.value.toLowerCase() === "refresh",
          )
        ),
    );
    for (const child of node.childNodes) visit(child);
  };
  visit(document);
  const root = document.childNodes.find(
    (node) => "tagName" in node && node.tagName === "html",
  );
  const head =
    root && "childNodes" in root
      ? root.childNodes.find(
          (node) => "tagName" in node && node.tagName === "head",
        )
      : undefined;
  if (!head || !("childNodes" in head))
    throw new Error("Preview document has no head");
  const origins = [...renderOrigins].join(" ");
  // Only the two version-matched runtime assets may load from the app origin.
  // Preview content has no action transport or editor/session bridge.
  const policy = [
    "default-src 'none'",
    `script-src 'unsafe-inline' 'unsafe-eval' ${runtimes.tailwind} ${runtimes.alpine} ${origins}`,
    `style-src 'unsafe-inline' ${origins}`,
    `img-src data: blob: ${origins}`,
    `font-src data: ${origins} https://fonts.gstatic.com`,
    `media-src data: blob: ${origins}`,
    "connect-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
  const security = parseFragment(
    `<meta http-equiv="Content-Security-Policy" content="${policy.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"><meta name="referrer" content="no-referrer">${NAVIGATION_GUARD}`,
  );
  for (const node of security.childNodes) node.parentNode = head;
  head.childNodes.unshift(...security.childNodes);
  return serialize(document);
}
