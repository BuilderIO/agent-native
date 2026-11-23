import { useT } from "@agent-native/core/client/i18n";
import { Link } from "react-router";

export function ProjectNotFound({ projectId }: { projectId: string }) {
  const t = useT();
  return (
    <div
      className="project-not-found"
      role="status"
      data-project-not-found={projectId}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        maxWidth: 480,
        margin: "auto",
        padding: 24,
        fontFamily: "inherit",
        fontSize: 14,
        lineHeight: "20px",
      }}
    >
      <strong style={{ fontSize: 16 }}>
        {t("publishedApp.projectNotFoundTitle")}
      </strong>
      <span style={{ opacity: 0.75 }}>
        {t("publishedApp.projectNotFoundDetail")}
      </span>
      <Link to="/home/all" style={{ width: "fit-content" }}>
        {t("publishedAppSharing.backToProjects")}
      </Link>
    </div>
  );
}
