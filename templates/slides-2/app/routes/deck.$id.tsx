import messages from "@/i18n/en-US";
import OpenSlideEditorPage from "@/pages/OpenSlideEditorPage";

export function meta() {
  return [{ title: messages.raw.routeEditorTitle }];
}

export default function DeckEditorRoute() {
  return <OpenSlideEditorPage />;
}
