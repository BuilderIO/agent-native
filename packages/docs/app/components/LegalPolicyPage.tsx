import { useLocale } from "@agent-native/core/client/i18n";

import DocContent from "./DocContent";

export default function LegalPolicyPage({ markdown }: { markdown: string }) {
  const { locale } = useLocale();

  return (
    <main className="mx-auto w-full max-w-site px-6 py-14 sm:py-20">
      <div className="mx-auto w-full max-w-[980px]">
        <DocContent markdown={markdown} locale={locale} />
      </div>
    </main>
  );
}
