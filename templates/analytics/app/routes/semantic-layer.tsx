import enUSMessages from "@/i18n/en-US";
import SemanticLayer from "@/pages/SemanticLayer";

export function meta() {
  return [{ title: enUSMessages.routeTitles.semanticLayer }];
}

export default function SemanticLayerRoute() {
  return <SemanticLayer />;
}
