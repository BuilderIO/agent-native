import { useEffect, useRef } from "react";
import { useLocation, useNavigate, type Location } from "react-router";

import { WorkspaceSearch } from ".";
import type { WorkspaceSearchProps } from "./types";

export function isWorkspaceSearchRoute(
  location: Pick<Location, "pathname" | "search">,
): boolean {
  if (location.pathname === "/home/search") return true;
  if (location.pathname !== "/home") return false;
  const params = new URLSearchParams(location.search);
  return params.has("q") || params.has("search");
}

function searchQueryFromLocation(location: Pick<Location, "search">): string {
  const params = new URLSearchParams(location.search);
  return params.get("q") ?? params.get("search") ?? "";
}

export function WorkspaceSearchNavigation({
  open,
  onClose,
  onCreateThread,
  ...props
}: Omit<
  WorkspaceSearchProps,
  "onNavigate" | "queryText" | "onQueryTextChange"
>) {
  const location = useLocation();
  const navigate = useNavigate();
  const navigating = useRef(false);
  const searchRoute = isWorkspaceSearchRoute(location);
  const queryText = searchRoute ? searchQueryFromLocation(location) : "";

  useEffect(() => {
    navigating.current = false;
  }, [location.pathname, location.search]);

  return (
    <WorkspaceSearch
      {...props}
      open={open || searchRoute}
      {...(searchRoute
        ? {
            queryText,
            onQueryTextChange: (text: string) => {
              const params = new URLSearchParams(location.search);
              params.delete("search");
              if (text) params.set("q", text);
              else params.delete("q");
              const query = params.toString();
              void navigate(`/home/search${query ? `?${query}` : ""}`, {
                replace: true,
              });
            },
          }
        : {})}
      onClose={() => {
        onClose();
        if (navigating.current) {
          navigating.current = false;
        } else if (searchRoute) {
          void navigate("/home");
        }
      }}
      onNavigate={(href) => {
        navigating.current = searchRoute;
        onClose();
        void navigate(href);
      }}
      {...(onCreateThread
        ? {
            onCreateThread: async (
              query: string,
              options: { newTab: boolean },
            ) => {
              if (searchRoute && !options.newTab) navigating.current = true;
              try {
                await onCreateThread(query, options);
              } catch (error) {
                navigating.current = false;
                throw error;
              }
            },
          }
        : {})}
    />
  );
}
