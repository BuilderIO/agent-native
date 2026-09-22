import { appBasePath } from "@agent-native/core/client/api-path";

export interface UploadedFont {
  family: string;
  url: string;
  weight: string;
  style: "normal" | "italic";
  format: "woff2" | "woff" | "truetype" | "opentype";
}

const FONT_WEIGHT_SUFFIX =
  /\s+(?:thin|extra ?light|ultra ?light|light|book|regular|normal|medium|semi ?bold|demi ?bold|bold|extra ?bold|ultra ?bold|black|heavy)$/i;

export function inferFontUploadMetadata(filename: string): {
  family: string;
  weight: string;
  style: "normal" | "italic";
} {
  const basename = filename.replace(/\.[^.]+$/, "");
  const normalized = basename
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const style = /(?:italic|oblique)/i.test(normalized) ? "italic" : "normal";
  const familyAndWeight = normalized
    .replace(/\s+(?:italic|oblique)$/i, "")
    .trim();
  const weightMatch = familyAndWeight.match(
    /\s+(thin|extra ?light|ultra ?light|light|book|regular|normal|medium|semi ?bold|demi ?bold|bold|extra ?bold|ultra ?bold|black|heavy)$/i,
  );
  const weight =
    {
      thin: "100",
      extralight: "200",
      ultralight: "200",
      light: "300",
      book: "400",
      regular: "400",
      normal: "400",
      medium: "500",
      semibold: "600",
      demibold: "600",
      bold: "700",
      extrabold: "800",
      ultrabold: "800",
      black: "900",
      heavy: "900",
    }[weightMatch?.[1]?.replace(/\s+/g, "").toLowerCase() ?? ""] ?? "400";
  const family = familyAndWeight
    .replace(FONT_WEIGHT_SUFFIX, "")
    .replace(/\s+/g, " ")
    .trim();
  return { family: family || "Uploaded Font", weight, style };
}

export async function uploadFont(
  file: File,
  designId: string,
): Promise<UploadedFont> {
  const metadata = inferFontUploadMetadata(file.name);
  const form = new FormData();
  form.append("designId", designId);
  form.append("family", metadata.family);
  form.append("weight", metadata.weight);
  form.append("style", metadata.style);
  form.append("file", file, file.name);

  const response = await fetch(`${appBasePath()}/api/fonts`, {
    method: "POST",
    credentials: "include",
    body: form,
  });
  let payload: (UploadedFont & { error?: never }) | { error?: string } | null;
  try {
    payload = (await response.json()) as
      | (UploadedFont & { error?: never })
      | { error?: string }
      | null;
  } catch {
    throw new Error("Font upload failed");
  }
  if (!response.ok || !payload || !("url" in payload)) {
    throw new Error(
      payload && "error" in payload && payload.error
        ? payload.error
        : "Font upload failed",
    );
  }
  return payload;
}
