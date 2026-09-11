import { messagesByLocale } from "@/i18n-data";
import DataDictionary from "@/pages/DataDictionary";

export function meta() {
  return [{ title: messagesByLocale["en-US"].routeTitles.dataDictionary }];
}

export default function DataDictionaryRoute() {
  return <DataDictionary />;
}
