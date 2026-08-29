export interface DashboardCertification {
  status: "certified";
  certifiedAt: string;
  certifiedBy: string;
  certifiedForUpdatedAt: string;
}

export function readDashboardCertification(
  config: Record<string, unknown>,
): DashboardCertification | null {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return null;
  }
  const value = config.certification;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const certification = value as Record<string, unknown>;
  if (
    certification.status !== "certified" ||
    typeof certification.certifiedAt !== "string" ||
    typeof certification.certifiedBy !== "string" ||
    typeof certification.certifiedForUpdatedAt !== "string"
  ) {
    return null;
  }
  return {
    status: "certified",
    certifiedAt: certification.certifiedAt as string,
    certifiedBy: certification.certifiedBy as string,
    certifiedForUpdatedAt: certification.certifiedForUpdatedAt as string,
  };
}

export function isDashboardCertified(
  config: Record<string, unknown>,
  updatedAt: string,
): boolean {
  return (
    readDashboardCertification(config)?.certifiedForUpdatedAt === updatedAt
  );
}

export function certifyDashboardConfig(
  config: Record<string, unknown>,
  certification: DashboardCertification,
): Record<string, unknown> {
  return { ...config, certification };
}
