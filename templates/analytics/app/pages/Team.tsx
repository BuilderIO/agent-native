import { Layout } from "@/components/layout/Layout";
import { TeamPage } from "@agent-native/core/client/org";

export default function Team() {
  return <TeamPage layout={(content) => <Layout>{content}</Layout>} />;
}
