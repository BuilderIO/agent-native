import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { agentNativePath } from "@agent-native/core/client";

function navigationFromPath(pathname: string) {
  const library = pathname.match(/^\/library\/([^/]+)/);
  if (library) return { view: "library", libraryId: library[1] };
  const image = pathname.match(/^\/image\/([^/]+)/);
  if (image) return { view: "image", assetId: image[1] };
  if (pathname === "/audit") return { view: "audit" };
  if (pathname === "/settings") return { view: "settings" };
  return { view: "libraries" };
}

function pathFromCommand(command: any): string | null {
  if (!command) return null;
  if (typeof command.path === "string") return command.path;
  if (command.view === "library" && command.libraryId) {
    return `/library/${command.libraryId}`;
  }
  if (command.view === "image" && command.assetId) {
    return `/image/${command.assetId}`;
  }
  if (command.view === "audit") return "/audit";
  if (command.view === "settings") return "/settings";
  if (command.view === "libraries") return "/";
  return null;
}

export function useNavigationState() {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    fetch(agentNativePath("/_agent-native/application-state/navigation"), {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-request-source": "images-ui",
      },
      body: JSON.stringify(navigationFromPath(location.pathname)),
    }).catch(() => {});
  }, [location.pathname]);

  const { data: command } = useQuery({
    queryKey: ["app-state", "navigate"],
    queryFn: async () => {
      const res = await fetch(
        agentNativePath("/_agent-native/application-state/navigate"),
      );
      if (!res.ok) return null;
      return res.json();
    },
    refetchInterval: 1000,
  });

  useEffect(() => {
    const path = pathFromCommand(command);
    if (!path) return;
    fetch(agentNativePath("/_agent-native/application-state/navigate"), {
      method: "DELETE",
    }).catch(() => {});
    navigate(path);
  }, [command, navigate]);
}
