import { RequireSession } from "@agent-native/core/client/ui";

import messages from "@/i18n/en-US";
import DeckEditor from "@/pages/DeckEditor";

export function meta() {
  return [{ title: messages.raw.routeEditorTitle }];
}

export default function DeckEditorRoute() {
  return (
    <RequireSession>
      <DeckEditor />
    </RequireSession>
  );
}
