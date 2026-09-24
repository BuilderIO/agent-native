import { z } from "zod";

/** CTAs are rendered as external links, so only web URLs are valid targets. */
export const ctaUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    if (!URL.canParse(value)) return false;
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  }, "CTA URL must use HTTP or HTTPS");
