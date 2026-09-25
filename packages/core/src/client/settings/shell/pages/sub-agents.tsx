import { AgentDirectorySection } from "../../AgentDirectorySection.js";
import { AgentsSection } from "../../AgentsSection.js";
import { ResourceCollection } from "./resource-collection.js";

// Bridge: today's Connected agents, custom agents (Resources › Agents), and
// Agent directory, stacked until the Sub-agents page lands.
export default function SubAgentsSettingsPage() {
  return (
    <div className="flex flex-col gap-10">
      <AgentsSection />
      <ResourceCollection view="agents" />
      <AgentDirectorySection />
    </div>
  );
}
