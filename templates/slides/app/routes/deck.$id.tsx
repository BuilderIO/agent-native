import messages from "@/i18n/en-US";
import DeckEditor from "@/pages/DeckEditor";

export function meta() {
  return [{ title: messages.raw.routeEditorTitle }];
}

export default function DeckEditorRoute() {
  return <DeckEditor />;
}
