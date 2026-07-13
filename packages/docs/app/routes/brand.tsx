import { useT } from "@agent-native/core/client";
import { IconDownload } from "@tabler/icons-react";

import { withDefaultSocialImage } from "../seo";

type BrandAsset = {
  nameKey: string;
  descriptionKey: string;
  light: {
    previewClassName: string;
    src: string;
  };
  dark: {
    previewClassName: string;
    src: string;
  };
};

const BRAND_ASSETS: BrandAsset[] = [
  {
    nameKey: "brandPage.horizontal.title",
    descriptionKey: "brandPage.horizontal.body",
    light: {
      previewClassName: "w-full max-w-[720px]",
      src: "/agent-native-logo-light.svg",
    },
    dark: {
      previewClassName: "w-full max-w-[720px]",
      src: "/agent-native-logo-dark.svg",
    },
  },
  {
    nameKey: "brandPage.symbol.title",
    descriptionKey: "brandPage.symbol.body",
    light: {
      previewClassName: "h-24 w-auto sm:h-28",
      src: "/agent-native-icon-light.svg",
    },
    dark: {
      previewClassName: "h-24 w-auto sm:h-28",
      src: "/agent-native-icon-dark.svg",
    },
  },
];

export const meta = () =>
  withDefaultSocialImage([
    { title: "Agent-Native brand assets" },
    {
      name: "description",
      content:
        "Download official Agent-Native logos and symbols for articles, presentations, and community projects.",
    },
    { property: "og:title", content: "Agent-Native brand assets" },
    {
      property: "og:description",
      content:
        "Official Agent-Native horizontal logos and symbols, ready to download as SVG files.",
    },
  ]);

function AssetPreview({
  asset,
  background,
  label,
}: {
  asset: BrandAsset["light"];
  background: "light" | "dark";
  label: string;
}) {
  const t = useT();
  const isDark = background === "dark";

  return (
    <article className="min-w-0 overflow-hidden rounded-xl border border-[var(--docs-border)] bg-[var(--bg)]">
      <div
        className={`flex min-h-56 items-center justify-center px-8 py-12 sm:min-h-64 sm:px-12 ${
          isDark ? "bg-[#090909]" : "bg-white"
        }`}
      >
        <img
          src={asset.src}
          alt=""
          loading="lazy"
          decoding="async"
          className={asset.previewClassName}
          aria-hidden="true"
        />
      </div>
      <div className="flex items-center justify-between gap-4 border-t border-[var(--docs-border)] px-4 py-3 sm:px-5">
        <span className="text-sm font-medium text-[var(--fg)]">{label}</span>
        <a
          href={asset.src}
          download
          className="inline-flex shrink-0 items-center gap-2 rounded-full border border-[var(--docs-border)] px-4 py-2 text-sm font-medium text-[var(--fg)] no-underline transition hover:border-[var(--fg-secondary)] hover:no-underline"
        >
          <IconDownload className="size-4" aria-hidden />
          {t("brandPage.downloadSvg")}
        </a>
      </div>
    </article>
  );
}

export default function BrandPage() {
  const t = useT();

  return (
    <main className="min-w-0">
      <header className="border-b border-[var(--docs-border)] px-6 py-16 sm:py-20">
        <div className="mx-auto max-w-[1120px]">
          <p className="mb-4 text-sm font-semibold uppercase tracking-[0.14em] text-[var(--docs-accent)]">
            {t("brandPage.eyebrow")}
          </p>
          <h1 className="m-0 max-w-4xl text-4xl font-semibold leading-tight tracking-tight text-[var(--fg)] sm:text-6xl">
            {t("brandPage.title")}
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-[var(--fg-secondary)]">
            {t("brandPage.body")}
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-[1120px] px-6 py-14 sm:py-20">
        <div className="flex flex-col gap-16 sm:gap-20">
          {BRAND_ASSETS.map((asset) => (
            <section key={asset.nameKey}>
              <div className="mb-6 max-w-2xl">
                <h2 className="m-0 text-2xl font-semibold tracking-tight text-[var(--fg)] sm:text-3xl">
                  {t(asset.nameKey)}
                </h2>
                <p className="mt-2 text-base leading-7 text-[var(--fg-secondary)]">
                  {t(asset.descriptionKey)}
                </p>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <AssetPreview
                  asset={asset.light}
                  background="light"
                  label={t("brandPage.lightBackground")}
                />
                <AssetPreview
                  asset={asset.dark}
                  background="dark"
                  label={t("brandPage.darkBackground")}
                />
              </div>
            </section>
          ))}
        </div>

        <section className="mt-16 border-t border-[var(--docs-border)] pt-12 sm:mt-20 sm:pt-16">
          <h2 className="m-0 text-2xl font-semibold tracking-tight text-[var(--fg)] sm:text-3xl">
            {t("brandPage.usage.title")}
          </h2>
          <div className="mt-6 grid gap-6 md:grid-cols-3">
            {(["clear", "contrast", "original"] as const).map((item) => (
              <div key={item}>
                <h3 className="m-0 text-base font-semibold text-[var(--fg)]">
                  {t(`brandPage.usage.${item}.title`)}
                </h3>
                <p className="mt-2 text-sm leading-6 text-[var(--fg-secondary)]">
                  {t(`brandPage.usage.${item}.body`)}
                </p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
