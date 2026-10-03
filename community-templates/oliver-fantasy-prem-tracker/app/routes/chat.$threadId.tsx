import ChatRouteContent from "@/components/chat/ChatRouteContent";
import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [{ title: APP_TITLE }];
}

export default function ChatThreadRoute() {
  return <ChatRouteContent />;
}
