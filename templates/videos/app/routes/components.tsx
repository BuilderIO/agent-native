import enUS from "@/i18n/en-US";
import ComponentLibrary from "@/pages/ComponentLibrary";

export function meta() {
  return [{ title: enUS.raw.routes.components }];
}

export default function ComponentsRoute() {
  return <ComponentLibrary />;
}
