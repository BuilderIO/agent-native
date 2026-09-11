export interface DashboardCertification {
  status: "certified";
  certifiedAt: string;
  certifiedBy: string;
  certifiedForUpdatedAt: string;
}

export type DashboardCertificationRead =
  | { status: "absent"; certification?: undefined }
  | { status: "invalid"; certification?: undefined }
  | { status: "valid"; certification: DashboardCertification };

export function parseDashboardCertification(
  value: unknown,
): DashboardCertificationRead {
  if (value === undefined || value === null || value === "") {
    return { status: "absent" };
  }
  let candidate = value;
  if (typeof value === "string") {
    try {
      candidate = JSON.parse(value);
    } catch {
      return { status: "invalid" };
    }
  }
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return { status: "invalid" };
  }
  const raw = candidate as Record<string, unknown>;
  if (
    raw.status !== "certified" ||
    typeof raw.certifiedAt !== "string" ||
    typeof raw.certifiedBy !== "string" ||
    typeof raw.certifiedForUpdatedAt !== "string"
  ) {
    return { status: "invalid" };
  }
  return {
    status: "valid",
    certification: {
      status: "certified",
      certifiedAt: raw.certifiedAt,
      certifiedBy: raw.certifiedBy,
      certifiedForUpdatedAt: raw.certifiedForUpdatedAt,
    },
  };
}

export function isDashboardCertified(
  certification: DashboardCertification | null | undefined,
  updatedAt: string,
): boolean {
  return (
    certification?.status === "certified" &&
    certification.certifiedForUpdatedAt === updatedAt
  );
}
