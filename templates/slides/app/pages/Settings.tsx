import { ApiKeySettings } from "@agent-native/core/client";

export default function Settings() {
  return (
    <div className="flex-1 overflow-y-auto">
      <main className="max-w-xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <h1 className="text-lg font-semibold text-white/90 mb-6">Settings</h1>
        <ApiKeySettings />
      </main>
    </div>
  );
}
