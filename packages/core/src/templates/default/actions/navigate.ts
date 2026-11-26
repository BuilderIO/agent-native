import { createNavigateAction } from "@agent-native/core/command-navigation";

export default createNavigateAction({
  description:
    'Agent-only: navigate the UI to a specific view or path. Pass intent: "open" only when the user asked to open or show an item; otherwise keep the user\'s current view.',
});
