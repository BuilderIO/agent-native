import { Layout } from "@/components/layout/Layout";
import { TeamPage } from "@agent-native/core/client/org";

export default function Team() {
  return (
    <TeamPage
      layout={(content) => <Layout>{content}</Layout>}
      createOrgDescription="Set up a team to share dashboards and data sources with your colleagues."
    />
  );
}
