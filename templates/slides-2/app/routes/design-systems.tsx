import messages from "@/i18n/en-US";
import DesignSystems from "@/pages/DesignSystems";

export function meta() {
  return [{ title: messages.raw.routeDesignSystemsTitle }];
}

export default function DesignSystemsRoute() {
  return <DesignSystems />;
}
