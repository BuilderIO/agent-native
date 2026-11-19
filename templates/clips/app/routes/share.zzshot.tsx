import { AccountGateDialog } from "@/components/player/create-account-dialog";

export default function ShotDialog() {
  return (
    <div style={{ minHeight: "100vh" }}>
      <AccountGateDialog
        open
        onOpenChange={() => {}}
        returnTo="/share/demo"
        intent="comment"
        builderSignupEnabled
        onAuthenticated={() => {}}
      />
    </div>
  );
}
