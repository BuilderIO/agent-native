import { AgentNativeIcon } from "@agent-native/core/client/ui";
/**
 * Source-shaped Assets artwork based on the create chat and generation tray.
 * Images are licensed template presets; all conversation text is fabricated.
 *
 * i18n-raw-literal-disable-file -- static product artwork, not interactive UI.
 */
import {
  IconArrowUp,
  IconBox,
  IconPhoto,
  IconPhotoPlus,
  IconSearch,
  IconTemplate,
  IconVideo,
} from "@tabler/icons-react";

import "./AssetsLandingMock.css";

type AssetsLandingMode = "generated" | "campaign" | "refine" | "library";

const ARTWORK_BY_MODE: Record<AssetsLandingMode, [string, string, string]> = {
  generated: [
    "/template-previews/assets-watercolor-bridge.webp",
    "/template-previews/assets-storybook-garden.webp",
    "/template-previews/assets-pastoral-wash.webp",
  ],
  campaign: [
    "/template-previews/assets-paper-rainbow.webp",
    "/template-previews/assets-kirigami.webp",
    "/template-previews/assets-paper-cutout.webp",
  ],
  refine: [
    "/template-previews/assets-location-clay.webp",
    "/template-previews/assets-bag-clay.webp",
    "/template-previews/assets-travel-clay.webp",
  ],
  library: [
    "/template-previews/assets-watercolor-bridge.webp",
    "/template-previews/assets-location-clay.webp",
    "/template-previews/assets-paper-rainbow.webp",
  ],
};

const PROMPTS = {
  generated:
    "Create a calm editorial hero for our spring travel guide. Use the Storybook Pastoral kit, with room for a headline.",
  campaign:
    "Make a small launch campaign with one clear idea: thoughtful design makes everyday work feel lighter.",
  refine:
    "Keep the product shape, switch to soft clay, and leave more clear space above it for the launch headline.",
} as const;

const LIBRARY_ITEMS = [
  {
    title: "Spring travel guide",
    kind: "Campaign · 8 assets",
    image: "/template-previews/assets-watercolor-bridge.webp",
  },
  {
    title: "Soft Travel 3D",
    kind: "Style kit · 12 references",
    image: "/template-previews/assets-location-clay.webp",
  },
  {
    title: "Product launch",
    kind: "Campaign · 6 assets",
    image: "/template-previews/assets-paper-rainbow.webp",
  },
  {
    title: "Storybook Pastoral",
    kind: "Style kit · 9 references",
    image: "/template-previews/assets-storybook-garden.webp",
  },
];

export function AssetsLandingMock({
  mode,
  label,
  className = "",
}: {
  mode: AssetsLandingMode;
  label: string;
  className?: string;
}) {
  const artwork = ARTWORK_BY_MODE[mode];
  const isLibrary = mode === "library";
  const prompt = mode === "library" ? PROMPTS.generated : PROMPTS[mode];

  return (
    <div
      className={
        "assets-landing-mock assets-landing-mock--" + mode + " " + className
      }
      role="img"
      aria-label={label}
    >
      <div className="as-app" aria-hidden="true">
        <aside className="as-sidebar">
          <div className="as-brand">
            <span className="as-brand-mark">
              <AgentNativeIcon aria-hidden="true" />
            </span>
            <span>Assets</span>
          </div>
          <button className="as-new-chat" type="button" tabIndex={-1}>
            <IconPhotoPlus size={14} />
            Create
          </button>
          <div className="as-sidebar-label">WORKSPACE</div>
          <nav className="as-nav">
            <span className={"as-nav-item" + (!isLibrary ? " is-active" : "")}>
              <IconPhoto size={14} />
              New chat
            </span>
            <span className={"as-nav-item" + (isLibrary ? " is-active" : "")}>
              <IconBox size={14} />
              Brand library
            </span>
            <span className="as-nav-item">
              <IconTemplate size={14} />
              Templates
            </span>
          </nav>
          <div className="as-sidebar-label as-recent-label">RECENT</div>
          <div className="as-recent-list">
            <span>Spring travel guide</span>
            <span>Product launch</span>
            <span>Weekend market photos</span>
          </div>
          <div className="as-brand-kit">
            <span className="as-kit-mark">SP</span>
            <span>
              <strong>Studio Pine</strong>
              <small>Brand kit</small>
            </span>
          </div>
        </aside>

        <main className="as-main">
          <header className="as-header">
            <span>{isLibrary ? "Brand library" : "Spring travel guide"}</span>
            {isLibrary ? (
              <span className="as-header-filter">
                <IconSearch size={13} />
                Search assets
              </span>
            ) : (
              <span className="as-header-kit">
                <span className="as-kit-mark">SP</span>
                Studio Pine kit
              </span>
            )}
          </header>

          {isLibrary ? (
            <section className="as-library-view">
              <div className="as-library-heading">
                <div>
                  <h2>Brand library</h2>
                  <p>Reusable references, kits, and generated work</p>
                </div>
                <span className="as-library-add">
                  <IconPhotoPlus size={12} />
                  Add assets
                </span>
              </div>
              <div className="as-library-filters">
                <span className="is-active">All assets</span>
                <span>Style kits</span>
                <span>Generated</span>
              </div>
              <div className="as-library-grid">
                {LIBRARY_ITEMS.map((item) => (
                  <article className="as-library-card" key={item.title}>
                    <img
                      src={item.image}
                      alt=""
                      draggable={false}
                      loading="lazy"
                      decoding="async"
                    />
                    <div>
                      <strong>{item.title}</strong>
                      <span>{item.kind}</span>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : (
            <section className="as-chat-view">
              <div className="as-chat-thread">
                <div className="as-user-message">
                  {mode === "refine" ? (
                    <span className="as-reference-attachment">
                      <img
                        src={ARTWORK_BY_MODE.refine[0]}
                        alt=""
                        loading="lazy"
                        decoding="async"
                      />
                      Product hero · reference
                    </span>
                  ) : null}
                  <p>{prompt}</p>
                </div>
                <div className="as-agent-message">
                  <span className="as-agent-mark">A</span>
                  <div className="as-agent-copy">
                    <strong>
                      {mode === "refine"
                        ? "I kept the original product silhouette and opened up space for your headline."
                        : "I made three directions with your Studio Pine brand kit."}
                    </strong>
                    <div className="as-output-heading">
                      <span>Generated images</span>
                      <span>3 variations · Image model</span>
                    </div>
                    <div className="as-generated-grid">
                      <img
                        className="as-generated-primary"
                        src={artwork[0]}
                        alt=""
                        draggable={false}
                        loading="lazy"
                        decoding="async"
                      />
                      <div className="as-generated-secondary">
                        <img
                          src={artwork[1]}
                          alt=""
                          draggable={false}
                          loading="lazy"
                          decoding="async"
                        />
                        <img
                          src={artwork[2]}
                          alt=""
                          draggable={false}
                          loading="lazy"
                          decoding="async"
                        />
                      </div>
                    </div>
                    <div className="as-image-actions">
                      <span className="is-selected">Save to brand library</span>
                      <span>Use as reference</span>
                      <span>Refine</span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="as-composer">
                <span>Refine a variation or ask for another direction...</span>
                <div>
                  <span className="as-composer-tool">
                    <IconPhotoPlus size={13} />
                  </span>
                  <span className="as-composer-tool">
                    <IconVideo size={13} />
                  </span>
                  <span className="as-composer-spacer" />
                  <span className="as-composer-model">Image model</span>
                  <span className="as-send">
                    <IconArrowUp size={13} />
                  </span>
                </div>
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
