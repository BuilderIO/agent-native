import { defineAction } from "@agent-native/core/action";
import {
  isBlockedExtensionUrlWithDns,
  ssrfSafeFetch,
} from "@agent-native/core/extensions/url-safety";
import { z } from "zod";

const MAX_EXTRACTION_BYTES = 12 * 1024 * 1024;
const MAX_COLOR_NAME_BYTES = 64_000;

type ExtractionPayload = {
  url?: string;
  signals?: {
    title?: string;
    description?: string;
  };
  designSystemData?: {
    colors?: {
      primary?: string;
      secondary?: string;
      accent?: string;
    };
    typography?: {
      headingFont?: string;
      bodyFont?: string;
    };
  };
};

async function readBoundedText(response: Response, maxBytes: number) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel();
    throw new Error("That response is too large to inspect.");
  }

  const reader = response.body?.getReader();
  if (!reader) return "";

  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      throw new Error("That response is too large to inspect.");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function truncateWords(value: string, maxWords: number) {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, maxWords)
    .join(" ");
}

function colorToHex(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  const hex = trimmed.match(/^#([\da-f]{3,8})$/i)?.[1];
  if (hex) {
    const rgb =
      hex.length === 3 || hex.length === 4
        ? hex
            .slice(0, 3)
            .split("")
            .map((character) => character.repeat(2))
            .join("")
        : hex.slice(0, 6);
    return rgb.toLowerCase();
  }
  const rgb = trimmed.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (!rgb) return null;
  return rgb
    .slice(1, 4)
    .map((channel) =>
      Math.max(0, Math.min(255, Math.round(Number(channel))))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("");
}

function normalizedColor(value: string | null | undefined) {
  const hex = colorToHex(value);
  return hex ? `#${hex}` : null;
}

async function extractDesignReference(url: URL) {
  if (await isBlockedExtensionUrlWithDns(url.href)) {
    throw new Error("Private or internal website URLs are not supported.");
  }
  const endpoint = new URL("https://freedesign.md/api/extract");
  endpoint.searchParams.set("url", url.href);
  endpoint.searchParams.set("format", "json");
  const response = await ssrfSafeFetch(
    endpoint.href,
    {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(60_000),
    },
    { maxRedirects: 2 },
  );
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Design extraction returned ${response.status}.`);
  }
  return JSON.parse(
    await readBoundedText(response, MAX_EXTRACTION_BYTES),
  ) as ExtractionPayload;
}

async function getColorNames(colors: Array<string | null>) {
  const values = colors
    .map(colorToHex)
    .filter((value): value is string => Boolean(value));
  if (!values.length) return new Map<string, string>();
  const endpoint = new URL("https://api.color.pizza/v1/");
  endpoint.searchParams.set("values", values.join(","));
  endpoint.searchParams.set("goodnamesonly", "true");
  const response = await ssrfSafeFetch(
    endpoint.href,
    { signal: AbortSignal.timeout(8_000) },
    { maxRedirects: 3 },
  );
  if (!response.ok)
    throw new Error(`Color lookup returned ${response.status}.`);
  const payload = JSON.parse(
    await readBoundedText(response, MAX_COLOR_NAME_BYTES),
  ) as {
    colors?: Array<{ name?: string; requestedHex?: string }>;
  };
  return new Map(
    (payload.colors ?? []).flatMap((color) => {
      const requestedHex = color.requestedHex?.replace(/^#/, "").toLowerCase();
      return requestedHex && color.name ? [[requestedHex, color.name]] : [];
    }),
  );
}

export default defineAction({
  description:
    "Inspect a public website and return bounded visual style metadata for a slide-deck prompt.",
  schema: z.object({
    url: z.string().url().max(2_048),
  }),
  outputSchema: z.object({
    title: z.string(),
    description: z.string(),
    primaryColor: z.string().nullable(),
    primaryColorName: z.string().nullable(),
    accentColor: z.string().nullable(),
    accentColorName: z.string().nullable(),
    headingFont: z.string().nullable(),
    bodyFont: z.string().nullable(),
  }),
  outputErrorStrategy: "strict",
  http: { method: "GET" },
  readOnly: true,
  requiresAuth: false,
  agentTool: false,
  run: async ({ url }) => {
    const parsedUrl = new URL(url);
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      throw new Error("Enter a public HTTP or HTTPS URL.");
    }
    if (parsedUrl.username || parsedUrl.password) {
      throw new Error("URLs with embedded credentials are not supported.");
    }

    const extracted = await extractDesignReference(parsedUrl);
    const title = extracted.signals?.title?.trim() || parsedUrl.hostname;
    if (/just a moment|attention required|security verification/i.test(title)) {
      throw new Error("That site blocked automated browser inspection.");
    }
    const primaryColor = normalizedColor(
      extracted.designSystemData?.colors?.primary,
    );
    const accentColor = normalizedColor(
      extracted.designSystemData?.colors?.accent ||
        extracted.designSystemData?.colors?.secondary,
    );
    let colorNames = new Map<string, string>();
    try {
      colorNames = await getColorNames([primaryColor, accentColor]);
    } catch {
      colorNames = new Map();
    }

    return {
      title: title.slice(0, 120),
      description: truncateWords(extracted.signals?.description ?? "", 14),
      primaryColor,
      primaryColorName: colorNames.get(colorToHex(primaryColor) ?? "") ?? null,
      accentColor,
      accentColorName: colorNames.get(colorToHex(accentColor) ?? "") ?? null,
      headingFont:
        extracted.designSystemData?.typography?.headingFont?.trim() || null,
      bodyFont:
        extracted.designSystemData?.typography?.bodyFont?.trim() || null,
    };
  },
});
