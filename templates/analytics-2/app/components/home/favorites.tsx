import { IconAlertTriangle, IconFolder, IconStar } from "@tabler/icons-react";
import { Link } from "react-router";

import { HomeProjectCardView } from "./project-card";
import { HomeLoading, HomeNonIdealState } from "./state";
import type { HomeCallbacks, HomeFavorites } from "./types";

export function HomeFavoritesSection({
  favorites,
  callbacks,
}: {
  favorites: HomeFavorites;
  callbacks: HomeCallbacks;
}) {
  if (favorites.status === "loading") {
    return <HomeLoading />;
  }

  if (favorites.status === "error") {
    return (
      <HomeNonIdealState
        icon={<IconAlertTriangle size={28} aria-hidden="true" />}
        description={
          favorites.errorMessage ?? "There was an error loading your favorites"
        }
      />
    );
  }

  const collections = favorites.collectionsEnabled ? favorites.collections : [];
  const projects = favorites.projects;
  const bothEmpty = collections.length === 0 && projects.length === 0;

  if (bothEmpty) {
    const { onBrowseProjects, onBrowseCollections } = callbacks;
    return (
      <HomeNonIdealState
        icon={<IconStar size={28} aria-hidden="true" />}
        description={`Favorite the projects${
          favorites.collectionsEnabled ? " and collections" : ""
        } you care about most, and they'll appear here for access later`}
      >
        <button
          type="button"
          className="ws-home-button"
          onClick={onBrowseProjects}
          disabled={onBrowseProjects == null}
        >
          Browse projects
        </button>
        {favorites.collectionsEnabled ? (
          <button
            type="button"
            className="ws-home-button"
            onClick={onBrowseCollections}
            disabled={onBrowseCollections == null}
          >
            <IconFolder size={14} aria-hidden="true" />
            Browse collections
          </button>
        ) : null}
      </HomeNonIdealState>
    );
  }

  return (
    <div className="ws-home-favorites">
      {collections.length > 0 ? (
        <div className="ws-home-group">
          <h4 className="ws-home-group-title">Collections</h4>
          <div className="ws-home-card-grid">
            {collections.map((collection) => (
              <article className="ws-home-card" key={collection.id}>
                <Link className="ws-home-card-title" to={collection.href}>
                  {collection.title}
                </Link>
                {collection.description ? (
                  <p className="ws-home-card-description">
                    {collection.description}
                  </p>
                ) : null}
              </article>
            ))}
          </div>
        </div>
      ) : null}
      {projects.length > 0 ? (
        <div className="ws-home-group">
          <h4 className="ws-home-group-title">Projects</h4>
          <div className="ws-home-card-grid">
            {projects.map((project) => (
              <HomeProjectCardView key={project.id} project={project} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
