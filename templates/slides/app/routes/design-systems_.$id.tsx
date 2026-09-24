import { DesignSystemWorkspace } from "@agent-native/core/client/agent-chat";
import { useNavigate, useParams } from "react-router";

export default function DesignSystemWorkspaceRoute() {
  const { id } = useParams();
  const navigate = useNavigate();
  return (
    <DesignSystemWorkspace
      key={id}
      systemId={id!}
      onBack={() => void navigate("/design-systems")}
    />
  );
}
