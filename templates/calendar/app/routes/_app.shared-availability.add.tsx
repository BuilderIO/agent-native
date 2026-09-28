import enUSMessages from "@/i18n/en-US";
import AddSharedAvailability from "@/pages/AddSharedAvailability";

export function meta() {
  return [{ title: enUSMessages.routeTitles.addSharedAvailability }];
}

export default function AddSharedAvailabilityRoute() {
  return <AddSharedAvailability />;
}
