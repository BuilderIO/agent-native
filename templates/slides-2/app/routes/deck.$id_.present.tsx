import messages from "@/i18n/en-US";
import OpenSlidePresenterPage from "@/pages/OpenSlidePresenterPage";

export function meta() {
  return [{ title: messages.raw.routeEditorTitle }];
}

export default function PresentationRoute() {
  return <OpenSlidePresenterPage />;
}
