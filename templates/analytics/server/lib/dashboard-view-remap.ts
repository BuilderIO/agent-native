import { and, eq } from "drizzle-orm";

export async function remapDashboardViews(
  tx: any,
  dashboardViews: { id: any; dashboardId: any; isDefault: any },
  duplicateId: string,
  canonicalId: string,
): Promise<void> {
  const [canonicalDefault] = await tx
    .select({ id: dashboardViews.id })
    .from(dashboardViews)
    .where(
      and(
        eq(dashboardViews.dashboardId, canonicalId),
        eq(dashboardViews.isDefault, true),
      ),
    )
    .limit(1);

  if (canonicalDefault) {
    await tx
      .update(dashboardViews)
      .set({ isDefault: false })
      .where(
        and(
          eq(dashboardViews.dashboardId, duplicateId),
          eq(dashboardViews.isDefault, true),
        ),
      );
  }

  await tx
    .update(dashboardViews)
    .set({ dashboardId: canonicalId })
    .where(eq(dashboardViews.dashboardId, duplicateId));
}
