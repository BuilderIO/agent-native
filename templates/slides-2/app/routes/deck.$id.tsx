import messages from "@/i18n/en-US";
import Slides2EditorPage from "@/pages/Slides2EditorPage";

export function meta() {
  return [{ title: messages.raw.routeEditorTitle }];
}

export default function DeckEditorRoute() {
  return <Slides2EditorPage />;
}
