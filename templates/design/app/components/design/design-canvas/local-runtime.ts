import tailwindRuntimeUrl from "@tailwindcss/browser?url";
import alpineRuntimeUrl from "alpinejs/dist/cdn.min.js?url";

import { ensureGroupRuntime } from "../../../../shared/group-runtime";
import {
  ensureNativeShaderRuntime,
  replaceForeignShaderRuntime,
} from "../../../../shared/shader-fills";
import { runtimeSrcSpans } from "./runtime-src-spans";

function absolute(url: string): string {
  if (/^[a-z]+:\/\//i.test(url)) return url;
  if (typeof window === "undefined") return url;
  return new URL(url, window.location.origin).href;
}

export function localRuntimeUrls(): { tailwind: string; alpine: string } {
  return {
    tailwind: absolute(tailwindRuntimeUrl),
    alpine: absolute(alpineRuntimeUrl),
  };
}

export function withLocalRuntimes(
  html: string,
  urls: { tailwind: string; alpine: string } = localRuntimeUrls(),
): string {
  html = replaceForeignShaderRuntime(ensureGroupRuntime(html));
  if (!html || !/<script/i.test(html)) return html;
  const spans = runtimeSrcSpans(html);
  if (spans.length === 0) return html;

  let out = "";
  let cursor = 0;
  for (const span of spans) {
    out += `${html.slice(cursor, span.start)}src="${urls[span.runtime]}"`;
    cursor = span.end;
  }
  return out + html.slice(cursor);
}

const NATIVE_MANIFEST_TAG =
  /<script\b[^>]*\btype\s*=\s*(?:"application\/x-agent-native-effects"|'application\/x-agent-native-effects')[^>]*>/i;

export function withNativeShaderRuntime(
  document: string,
  always = false,
): string {
  return always ||
    NATIVE_MANIFEST_TAG.test(document) ||
    document.includes("data-agent-native-native-shader-runtime")
    ? ensureNativeShaderRuntime(document)
    : document;
}
