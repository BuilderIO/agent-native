import DeckEditor from "@/pages/DeckEditor";
import messages from "@/i18n/en-US";

export function meta() {
  return [{ title: messages.raw.routeEditorTitle }];
}

export default function DeckEditorRoute() {
  return <DeckEditor />;
}
