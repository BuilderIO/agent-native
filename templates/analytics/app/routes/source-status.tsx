import enUSMessages from "@/i18n/en-US";
import SourceStatus from "@/pages/SourceStatus";

export function meta() {
  return [{ title: enUSMessages.routeTitles.sourceStatus }];
}

export default function SourceStatusRoute() {
  return <SourceStatus />;
}
