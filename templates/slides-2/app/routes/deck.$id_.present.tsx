import messages from "@/i18n/en-US";
import Slides2PresenterPage from "@/pages/Slides2PresenterPage";

export function meta() {
  return [{ title: messages.raw.routeEditorTitle }];
}

export default function PresentationRoute() {
  return <Slides2PresenterPage />;
}
