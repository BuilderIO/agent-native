import { and, eq } from "drizzle-orm";

export async function remapDashboardViews(
  tx: any,
  dashboards: { id: any; orgId: any },
  dashboardViews: { id: any; dashboardId: any; isDefault: any },
  orgId: string,
  duplicateId: string,
  canonicalId: string,
): Promise<void> {
  for (const dashboardId of [duplicateId, canonicalId].sort()) {
    const [dashboard] = await tx
      .select({ id: dashboards.id })
      .from(dashboards)
      .where(and(eq(dashboards.id, dashboardId), eq(dashboards.orgId, orgId)))
      .for("update");

    if (!dashboard) {
      throw new Error(
        `Dashboard ${dashboardId} was not available to lock in organization ${orgId}`,
      );
    }
  }

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
