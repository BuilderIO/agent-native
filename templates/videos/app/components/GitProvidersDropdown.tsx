/**
 * ═══════════════════════════════════════════════════════════════════════════
 * GIT PROVIDERS DROPDOWN
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Dropdown menu showing available Git provider options (GitHub, Azure DevOps,
 * GitLab, Bitbucket). Appears below the "Connect Repo" button when clicked.
 *
 * Features:
 * - Dark themed card design
 * - Provider icons and labels
 * - Hover states
 * - Smooth animation on show/hide
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import React from "react";

export type GitProvidersDropdownProps = {
  isOpen?: boolean;
  onSelectProvider?: (provider: string) => void;
  x?: number;
  y?: number;
  opacity?: number;
  githubProviderIsHovered?: boolean;
  azureProviderIsHovered?: boolean;
  gitlabProviderIsHovered?: boolean;
  bitbucketProviderIsHovered?: boolean;
};

const providers = [
  {
    id: "github",
    name: "GitHub",
    icon: "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/6a8a6f3afddd90b7415887de489fba0bba03a618?placeholderIfAbsent=true",
  },
  {
    id: "azure",
    name: "Azure DevOps",
    icon: "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/f9ff07c9779b929984a1a4e2267bc90db5eb4395?placeholderIfAbsent=true",
  },
  {
    id: "gitlab",
    name: "GitLab",
    icon: "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/34d77e65a085c59b635b80007de740a868be399e?placeholderIfAbsent=true",
  },
  {
    id: "bitbucket",
    name: "Bitbucket",
    icon: "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/a6138968b0f48e005546d199ed97e7925d6a7fa9?placeholderIfAbsent=true",
  },
];

export const GitProvidersDropdown: React.FC<GitProvidersDropdownProps> = ({
  isOpen = true,
  onSelectProvider,
  x = 0,
  y = 0,
  opacity = 1,
  githubProviderIsHovered = false,
  azureProviderIsHovered = false,
  gitlabProviderIsHovered = false,
  bitbucketProviderIsHovered = false,
}) => {
  const [shouldRender, setShouldRender] = React.useState(isOpen);
  const [animationState, setAnimationState] = React.useState<
    "entering" | "entered" | "exiting"
  >(isOpen ? "entering" : "exiting");
  const [hoveredProvider, setHoveredProvider] = React.useState<string | null>(
    null,
  );

  // Map provider IDs to hover states
  const providerHoverStates: Record<string, boolean> = {
    github: githubProviderIsHovered,
    azure: azureProviderIsHovered,
    gitlab: gitlabProviderIsHovered,
    bitbucket: bitbucketProviderIsHovered,
  };

  React.useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setAnimationState("entered");
        });
      });
    } else {
      setAnimationState("exiting");
      const timer = setTimeout(() => {
        setShouldRender(false);
      }, 200); // Match transition duration
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  if (!shouldRender) return null;

  const scale = animationState === "entered" ? 1 : 0.95;
  const translateY = animationState === "entered" ? 0 : -10;
  const currentOpacity = animationState === "entered" ? opacity : 0;

  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        opacity: currentOpacity,
        width: "auto",
        transform: `translateY(${translateY}px) scale(${scale})`,
        transformOrigin: "top center",
        transition: "opacity 0.2s ease, transform 0.2s ease",
        zIndex: 9999,
      }}
    >
      <div
        style={{
          borderRadius: 9,
          backgroundColor: "rgba(25, 25, 25, 1)",
          borderColor: "rgba(57, 57, 57, 1)",
          borderStyle: "solid",
          borderWidth: 1,
          display: "flex",
          paddingLeft: 24,
          paddingRight: 24,
          paddingTop: 16,
          paddingBottom: 16,
          flexDirection: "column",
          fontFamily: "Inter, -apple-system, Roboto, Helvetica, sans-serif",
          justifyContent: "start",
          alignSelf: "center",
        }}
      >
        {/* Header */}
        <div
          style={{
            color: "rgba(164, 164, 164, 1)",
            fontSize: 15,
            fontWeight: 600,
            lineHeight: 1.38,
            letterSpacing: "0.5px",
            textTransform: "uppercase",
          }}
        >
          Git Providers
        </div>

        {/* Provider List */}
        <div
          style={{
            display: "flex",
            marginTop: 19,
            width: "100%",
            flexDirection: "column",
            alignItems: "start",
            fontSize: 18,
            color: "rgba(255, 255, 255, 1)",
            fontWeight: 400,
            justifyContent: "start",
            gap: 13,
          }}
        >
          {providers.map((provider, index) => {
            // Use hover state from props (Remotion mode) or local state (interactive mode)
            const isHovered =
              providerHoverStates[provider.id] ||
              hoveredProvider === provider.id;

            return (
              <div
                key={provider.id}
                onClick={() => onSelectProvider?.(provider.id)}
                onMouseEnter={() => setHoveredProvider(provider.id)}
                onMouseLeave={() => setHoveredProvider(null)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 13,
                  whiteSpace: "nowrap",
                  justifyContent: "start",
                  cursor: isHovered ? "pointer" : "default",
                  width: "calc(100% + 17px)",
                  padding: "5px 3px 5px 10px",
                  marginLeft: -10,
                  borderRadius: 6,
                  backgroundColor: isHovered
                    ? "rgba(255, 255, 255, 0.15)"
                    : "transparent",
                  transition: "background-color 0.15s ease",
                }}
              >
                <img
                  loading="lazy"
                  src={provider.icon}
                  alt={`${provider.name} icon`}
                  style={{
                    aspectRatio: 1,
                    objectFit: "contain",
                    objectPosition: "center",
                    width: 25,
                  }}
                />
                <div style={{ alignSelf: "stretch" }}>{provider.name}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
