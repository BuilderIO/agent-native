import { useEffect, useState } from "react";

import ChatRouteContent from "@/components/chat/ChatRouteContent";

export { meta } from "./home";

export default function ChatThreadRoute() {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  return hydrated ? <ChatRouteContent /> : null;
}
