import enUSMessages from "@/i18n/en-US";
import DataDictionary from "@/pages/DataDictionary";

export function meta() {
  return [{ title: enUSMessages.routeTitles.dataDictionary }];
}

export default function DataDictionaryRoute() {
  return <DataDictionary />;
}
