import { defaultUrlTransform } from "react-markdown";

/**
 * Where a comment's link to `href` goes, or "" where the comment draws its
 * text alone, as for a `javascript:` address.
 */
export function commentLinkHref(href: string): string {
  return defaultUrlTransform(normalizeCommentLinkHref(href));
}

function normalizeCommentLinkHref(href: string): string {
  if (/^www\./i.test(href)) return `https://${href}`;
  if (/^http:\/\/www\./i.test(href)) {
    return `https://${href.slice("http://".length)}`;
  }
  return href;
}
