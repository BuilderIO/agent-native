import { z } from "zod";

export const NATIVE_SHADER_LIBRARY_PAGE_LIMIT = 50;
export const NATIVE_SHADER_LIBRARY_MAX_ITEMS = 512;

export type NativeShaderLibraryView = "all" | "favorites" | "recent";
export type NativeShaderLibraryCategory =
  | "generator"
  | "processor"
  | "simulation";

export interface NativeShaderLibraryCursor {
  view: NativeShaderLibraryView;
  search: string;
  category: NativeShaderLibraryCategory | null;
  sortAt: string;
  id: string;
}

const cursorSchema = z
  .object({
    view: z.enum(["all", "favorites", "recent"]),
    search: z.string().max(100),
    category: z.enum(["generator", "processor", "simulation"]).nullable(),
    sortAt: z.string().min(1).max(80),
    id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  })
  .strict();

export class NativeShaderLibraryCursorError extends TypeError {
  constructor() {
    super("Shader Library cursor is invalid for this view or filter.");
    this.name = "NativeShaderLibraryCursorError";
  }
}

export function encodeNativeShaderLibraryCursor(
  value: NativeShaderLibraryCursor,
): string {
  const parsed = cursorSchema.safeParse(value);
  if (!parsed.success) throw new NativeShaderLibraryCursorError();
  const encoded = JSON.stringify(parsed.data);
  if (encoded.length > 512) throw new NativeShaderLibraryCursorError();
  return encoded;
}

export function decodeNativeShaderLibraryCursor(
  encoded: string,
  filter: Pick<NativeShaderLibraryCursor, "view" | "search" | "category">,
): NativeShaderLibraryCursor {
  if (encoded.length > 512) throw new NativeShaderLibraryCursorError();
  let value: unknown;
  try {
    value = JSON.parse(encoded);
  } catch {
    throw new NativeShaderLibraryCursorError();
  }
  const parsed = cursorSchema.safeParse(value);
  if (
    !parsed.success ||
    parsed.data.view !== filter.view ||
    parsed.data.search !== filter.search ||
    parsed.data.category !== filter.category
  )
    throw new NativeShaderLibraryCursorError();
  return parsed.data;
}
