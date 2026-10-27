import { z } from "zod";

export const ICON_COLORS = [
  "gray",
  "brown",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
  "red",
] as const;

export type IconColor = (typeof ICON_COLORS)[number];

const textField = (label: string, maximum: number) =>
  z
    .string()
    .trim()
    .min(1, `${label} cannot be empty`)
    .max(maximum, `${label} is too long`);

export const iconValueSchema = z.discriminatedUnion("kind", [
  z
    .object({
      version: z.literal(1),
      kind: z.literal("emoji"),
      emoji: textField("Emoji", 64),
    })
    .strict(),
  z
    .object({
      version: z.literal(1),
      kind: z.literal("library"),
      library: z.literal("tabler"),
      name: textField("Icon name", 128).regex(
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/u,
        "Icon name must be a stable kebab-case catalog name",
      ),
      variant: z.enum(["outline", "filled"]).optional(),
      color: z.enum(ICON_COLORS).optional(),
    })
    .strict(),
  z
    .object({
      version: z.literal(1),
      kind: z.literal("image"),
      assetId: textField("Asset ID", 2048),
      authority: textField("Asset authority", 256),
      alt: z
        .string()
        .trim()
        .max(500, "Image description is too long")
        .optional(),
    })
    .strict(),
]);

export type IconValue = z.infer<typeof iconValueSchema>;

export type SafeParseIconValueResult =
  | { success: true; data: IconValue | null }
  | { success: false; error: z.ZodError };

function decodeIconInput(input: unknown): unknown {
  if (input === null) return null;
  if (typeof input !== "string") return input;

  const value = input.trim();
  if (!value) return input;
  if (!value.startsWith("{") && !value.startsWith("[")) {
    return { version: 1, kind: "emoji", emoji: input };
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return input;
  }
}

export function safeParseIconValue(input: unknown): SafeParseIconValueResult {
  const decoded = decodeIconInput(input);
  if (decoded === null) return { success: true, data: null };
  return iconValueSchema.safeParse(decoded);
}

export function parseIconValue(input: unknown): IconValue | null {
  const result = safeParseIconValue(input);
  if (!result.success) throw result.error;
  return result.data;
}

export function serializeIconValue(value: IconValue | null): string | null {
  if (value === null) return null;
  return JSON.stringify(iconValueSchema.parse(value));
}
