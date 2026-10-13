import { WorkflowHome } from "@/components/workflow-home";
import { workflow } from "@/lib/workflow";

export function meta() {
  return [
    { title: workflow.title },
    { name: "description", content: workflow.summary },
  ];
}

export default function WorkspaceRoute() {
  return <WorkflowHome workflow={workflow} />;
}
