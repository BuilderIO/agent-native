import { messagesByLocale } from "@/i18n-data";
import AddSharedAvailability from "@/pages/AddSharedAvailability";

export function meta() {
  return [
    { title: messagesByLocale["en-US"].routeTitles.addSharedAvailability },
  ];
}

export default function AddSharedAvailabilityRoute() {
  return <AddSharedAvailability />;
}
