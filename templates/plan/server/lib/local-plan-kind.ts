import { z } from "zod";

export const localPlanKindSchema = z.enum(["plan", "recap"]);

export type LocalPlanKind = z.infer<typeof localPlanKindSchema>;

export function resolveLocalPlanKind(
  explicit: LocalPlanKind | undefined,
  mdx: { "plan.mdx": string; ".plan-state.json"?: string },
): LocalPlanKind {
  if (explicit) return explicit;
  const frontmatterMatch = mdx["plan.mdx"].match(
    /^---[\s\S]*?^kind:\s*["']?(plan|recap)["']?\s*$/m,
  );
  if (frontmatterMatch) return frontmatterMatch[1] as LocalPlanKind;
  try {
    const state = mdx[".plan-state.json"]
      ? (JSON.parse(mdx[".plan-state.json"]) as { kind?: unknown })
      : null;
    if (state?.kind === "plan" || state?.kind === "recap") return state.kind;
  } catch {
    // Optional state file.
  }
  return "plan";
}
