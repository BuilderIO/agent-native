import { getBrowserTabId } from "@agent-native/core/client/hooks";
import { useAgentRouteState } from "@agent-native/core/client/navigation";

export function useNavigationState() {
  const tab = getBrowserTabId();
  useAgentRouteState<{ view?: string; id?: string | undefined; path?: string }>({
    browserTabId: tab,
    requestSource: tab,
    getNavigationState: ({ pathname }) => {
      const [, view, id] = pathname.split("/");
      return { view: view || "journeys", id: id ? decodeURIComponent(id) : undefined, path: pathname };
    },
    getCommandPath: (command) =>
      command.path?.startsWith("/") && !command.path.startsWith("//") ? command.path : "/journeys",
  });
}
