import { IconAlertTriangle, IconTrendingUp } from "@tabler/icons-react";
import { Link } from "react-router";

import { HomeProjectCardView } from "./project-card";
import { HomeLoading, HomeNonIdealState } from "./state";
import type { HomePopular } from "./types";

export function HomePopularSection({ popular }: { popular: HomePopular }) {
  if (popular.status === "loading") {
    return <HomeLoading />;
  }

  if (popular.status === "error") {
    return (
      <HomeNonIdealState
        icon={<IconAlertTriangle size={28} aria-hidden="true" />}
        description={
          popular.errorMessage ?? "There was an error loading popular projects"
        }
      >
        {popular.onRetry ? (
          <button
            type="button"
            className="ws-home-viewall"
            onClick={popular.onRetry}
          >
            Try again
          </button>
        ) : null}
      </HomeNonIdealState>
    );
  }

  if (popular.projects.length === 0) {
    return (
      <HomeNonIdealState
        icon={<IconTrendingUp size={28} aria-hidden="true" />}
        description="Popular projects will show you what's being frequently viewed in your workspace."
      />
    );
  }

  return (
    <div>
      <div className="ws-home-group-heading">
        <h4 className="ws-home-group-title">Popular this week</h4>
        {popular.viewAllHref != null ? (
          <Link className="ws-home-viewall" to={popular.viewAllHref}>
            View all
          </Link>
        ) : null}
      </div>
      <div className="ws-home-card-grid">
        {popular.projects.map((project) => (
          <HomeProjectCardView key={project.id} project={project} />
        ))}
      </div>
    </div>
  );
}
