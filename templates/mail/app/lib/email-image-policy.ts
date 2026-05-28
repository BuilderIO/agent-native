export type EmailImagePolicy = "show" | "block-trackers" | "block-all";

// Known tracking pixel domains (partial matches against hostname)
const TRACKER_DOMAINS = [
  "open.convertkit-",
  "pixel.mailchimp.com",
  "list-manage.com/track",
  "t.sendinblue.com",
  "t.sidekickopen",
  "t.semail.",
  "tracking.tldrnewsletter.com",
  "links.iterable.com",
  "email.mg.",
  "trk.klclick",
  "beacon.krxd.net",
  "r.sup.sh", // Superhuman
  "t.superhuman.com",
  "track.hubspot",
  "track.customer.io",
  "ct.sendgrid.net",
  "sendgrid.net/wf/open",
  "mandrillapp.com/track",
  "mailgun.org/track",
  "go.pardot.com",
  "analytics.google.com",
  "google-analytics.com",
  "bat.bing.com",
  "facebook.com/tr",
  "connect.facebook.net",
  "ad.doubleclick.net",
  "demdex.net",
  "omtrdc.net",
  "ml.klaviyo.com",
  "trk.klaviyo.com",
];

function isTrackingUrl(src: string): boolean {
  try {
    const url = new URL(src);
    const full = url.hostname + url.pathname;
    return TRACKER_DOMAINS.some((d) => full.includes(d));
  } catch {
    return false;
  }
}

export function decodeHtmlEntities(value: string): string {
  let decoded = value;
  for (let i = 0; i < 3; i++) {
    const next = decoded
      .replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) =>
        String.fromCodePoint(Number.parseInt(hex, 16)),
      )
      .replace(/&#(\d+);?/g, (_, dec: string) =>
        String.fromCodePoint(Number.parseInt(dec, 10)),
      )
      .replace(/&colon;?/gi, ":")
      .replace(/&tab;?/gi, "\t")
      .replace(/&newline;?/gi, "\n")
      .replace(/&amp;?/gi, "&");
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
}

function isAllowedNonRemoteResourceUrl(value: string): boolean {
  const lower = decodeHtmlEntities(value)
    .trim()
    .replace(/[\s\u0000-\u001f\u007f]+/g, "")
    .toLowerCase();
  return (
    lower.startsWith("data:image/") ||
    lower.startsWith("cid:") ||
    lower.startsWith("#")
  );
}

function stripCssRemoteResources(css: string): [string, number] {
  let blocked = 0;
  const withoutImports = css.replace(
    /@import\s+(?:url\(\s*)?(['"]?)[\s\S]*?\1\s*\)?[^;]*;?/gi,
    () => {
      blocked++;
      return "";
    },
  );
  const withoutRemoteUrls = withoutImports.replace(
    /url\(\s*(['"]?)([\s\S]*?)\1\s*\)/gi,
    (match, _quote: string, rawUrl: string) => {
      if (isAllowedNonRemoteResourceUrl(rawUrl)) return match;
      blocked++;
      return "none";
    },
  );

  return [withoutRemoteUrls, blocked];
}

/** Strip images from HTML based on policy. Returns [processedHtml, imageCount]. */
export function processHtmlImages(
  html: string,
  policy: EmailImagePolicy,
): [string, number] {
  if (policy === "show") return [html, 0];

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const template = doc.createElement("template");
  template.innerHTML = html;
  const root = template.content;
  const images = root.querySelectorAll("img");
  let blocked = 0;

  images.forEach((img) => {
    const src = img.getAttribute("src") || "";
    if (!src || isAllowedNonRemoteResourceUrl(src)) return;

    if (policy === "block-all") {
      img.removeAttribute("src");
      img.setAttribute("data-blocked-src", src);
      blocked++;
    } else if (policy === "block-trackers" && isTrackingUrl(src)) {
      img.remove();
      blocked++;
    }
  });

  // Also strip tracking pixel style tags (1x1 images via CSS background)
  if (policy === "block-trackers" || policy === "block-all") {
    root.querySelectorAll('img[width="1"][height="1"]').forEach((img) => {
      img.remove();
      blocked++;
    });
    root.querySelectorAll('img[width="0"]').forEach((img) => {
      img.remove();
      blocked++;
    });
    root
      .querySelectorAll(
        'img[style*="display:none"], img[style*="display: none"]',
      )
      .forEach((img) => {
        img.remove();
        blocked++;
      });
  }

  if (policy === "block-all") {
    root.querySelectorAll("link[href]").forEach((link) => {
      link.remove();
      blocked++;
    });

    root.querySelectorAll<HTMLElement>("[style]").forEach((el) => {
      const [style, count] = stripCssRemoteResources(
        el.getAttribute("style") ?? "",
      );
      if (count === 0) return;
      blocked += count;
      if (style.trim()) {
        el.setAttribute("style", style);
      } else {
        el.removeAttribute("style");
      }
    });

    root.querySelectorAll("style").forEach((styleEl) => {
      const [css, count] = stripCssRemoteResources(styleEl.textContent ?? "");
      if (count === 0) return;
      blocked += count;
      if (css.trim()) {
        styleEl.textContent = css;
      } else {
        styleEl.remove();
      }
    });

    root
      .querySelectorAll<HTMLElement>(
        "[background], [poster], source[src], video[src], audio[src], track[src]",
      )
      .forEach((el) => {
        for (const attrName of ["background", "poster", "src"]) {
          const value = el.getAttribute(attrName);
          if (!value || isAllowedNonRemoteResourceUrl(value)) continue;
          el.removeAttribute(attrName);
          blocked++;
        }
      });

    const svgResourceElements = new Set(["feimage", "image", "use"]);
    root.querySelectorAll<Element>("*").forEach((el) => {
      if (!svgResourceElements.has(el.localName.toLowerCase())) return;

      for (const attrName of ["href", "xlink:href"]) {
        const value = el.getAttribute(attrName);
        if (!value || isAllowedNonRemoteResourceUrl(value)) continue;
        el.removeAttribute(attrName);
        blocked++;
      }
    });
  }

  return [template.innerHTML, blocked];
}
