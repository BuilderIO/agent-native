import { z } from "zod";

export const viewScreenSchema = z.object({
  route: z.string(),
  view: z.string(),
  title: z.string(),
  activeFilters: z.record(z.string(), z.unknown()),
  selection: z.array(z.unknown()),
  visibleItems: z.array(z.unknown()),
  liveDraft: z.unknown().optional(),
  userEditedSince: z.union([z.number(), z.string()]).optional(),
});

export type ViewScreen = z.infer<typeof viewScreenSchema>;

export function defineViewScreen<Screen extends ViewScreen>(
  screen: Screen,
): Screen {
  viewScreenSchema.parse(screen);
  return screen;
}
