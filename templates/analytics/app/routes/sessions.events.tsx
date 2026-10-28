import enUSMessages from "@/i18n/en-US";
import EventCatalogPage from "@/pages/sessions/EventCatalogPage";

export function meta() {
  return [{ title: enUSMessages.routeTitles.eventCatalog }];
}

export default function EventCatalogRoute() {
  return <EventCatalogPage />;
}
