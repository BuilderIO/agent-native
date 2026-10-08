import type { CSSProperties, ReactNode } from "react";

const MUTED = "hsl(var(--muted, 240 5% 96.1%))";
const BORDER = "1px solid hsl(var(--border, 240 5.9% 90%))";

export type AppShellSkeletonLayout =
  | "assistant"
  | "calendar"
  | "dashboard"
  | "document"
  | "launchpad"
  | "list"
  | "mail"
  | "prompt-library"
  | "welcome";

function Block({ style }: { style?: CSSProperties }) {
  return (
    <span
      aria-hidden="true"
      data-agent-native-skeleton-block="true"
      style={{
        display: "block",
        backgroundColor: MUTED,
        borderRadius: 6,
        opacity: 0.7,
        ...style,
      }}
    />
  );
}

function Sidebar({ width = 248 }: { width?: number }) {
  return (
    <aside
      data-agent-native-app-skeleton-sidebar="true"
      aria-hidden="true"
      style={{
        display: "flex",
        width,
        flexShrink: 0,
        flexDirection: "column",
        gap: 16,
        borderRight: BORDER,
        padding: 16,
      }}
    >
      <Block style={{ width: 132, height: 32 }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {Array.from({ length: 6 }, (_, index) => (
          <Block
            key={index}
            style={{ width: `${68 + (index % 3) * 14}%`, height: 14 }}
          />
        ))}
      </div>
    </aside>
  );
}

function Header({ titleWidth = 128 }: { titleWidth?: number }) {
  return (
    <header
      aria-hidden="true"
      style={{
        display: "flex",
        height: 48,
        flexShrink: 0,
        alignItems: "center",
        gap: 12,
        borderBottom: BORDER,
        padding: "0 16px",
      }}
    >
      <Block style={{ width: 32, height: 32, borderRadius: 8 }} />
      <Block style={{ width: titleWidth, height: 14 }} />
      <div style={{ flex: 1 }} />
      <Block style={{ width: 32, height: 32, borderRadius: 8 }} />
      <Block style={{ width: 32, height: 32, borderRadius: 8 }} />
    </header>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <div
      style={{ display: "flex", minWidth: 0, flex: 1, flexDirection: "column" }}
    >
      <Header />
      {children}
    </div>
  );
}

function AssistantLayout() {
  return (
    <>
      <Sidebar />
      <main
        aria-hidden="true"
        style={{
          display: "flex",
          minWidth: 0,
          flex: 1,
          flexDirection: "column",
          padding: "0 24px 24px",
        }}
      >
        <div style={{ display: "flex", height: 48, alignItems: "center" }}>
          <Block style={{ width: 32, height: 32, borderRadius: 8 }} />
        </div>
        <section
          style={{
            display: "flex",
            width: "100%",
            maxWidth: 780,
            flex: 1,
            flexDirection: "column",
            justifyContent: "center",
            gap: 16,
            margin: "0 auto",
          }}
        >
          <Block style={{ width: "42%", height: 28, marginBottom: 8 }} />
          <div style={{ flex: 1, minHeight: 80 }} />
          <Block style={{ width: "100%", height: 92, borderRadius: 16 }} />
        </section>
      </main>
    </>
  );
}

function PromptLibraryLayout() {
  return (
    <>
      <Sidebar />
      <Frame>
        <section
          aria-hidden="true"
          style={{
            display: "flex",
            width: "100%",
            flex: 1,
            flexDirection: "column",
            gap: 24,
            padding: 32,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Block style={{ width: 92, height: 28, borderRadius: 14 }} />
            <Block style={{ width: 80, height: 14 }} />
            <div style={{ flex: 1 }} />
            <Block style={{ width: 144, height: 32, borderRadius: 8 }} />
          </div>
          <div
            style={{
              display: "grid",
              flex: 1,
              alignContent: "start",
              gap: 16,
            }}
            data-agent-native-app-skeleton-gallery-grid="true"
          >
            {Array.from({ length: 8 }, (_, index) => (
              <div
                key={index}
                style={{ display: "flex", flexDirection: "column", gap: 10 }}
              >
                <Block
                  style={{ width: "100%", height: 144, borderRadius: 12 }}
                />
                <Block
                  style={{ width: `${56 + (index % 3) * 12}%`, height: 12 }}
                />
              </div>
            ))}
          </div>
        </section>
      </Frame>
    </>
  );
}

function MailLayout() {
  return (
    <div
      style={{
        display: "flex",
        minWidth: 0,
        flex: 1,
        flexDirection: "column",
        containerName: "agent-native-main",
        containerType: "inline-size",
      }}
    >
      <header
        aria-hidden="true"
        data-agent-native-mail-header="true"
        style={{
          display: "flex",
          height: 48,
          flexShrink: 0,
          alignItems: "center",
          gap: 4,
          borderBottom: BORDER,
          padding: "0 8px",
          overflowX: "auto",
          overflowY: "hidden",
          overscrollBehaviorX: "contain",
          scrollbarWidth: "none",
        }}
      >
        <div
          style={{
            position: "sticky",
            insetInlineStart: 0,
            zIndex: 1,
            flexShrink: 0,
            backgroundColor: "hsl(var(--background, 0 0% 100%))",
          }}
        >
          <Block style={{ width: 32, height: 36, borderRadius: 6 }} />
        </div>
        <div
          style={{
            display: "flex",
            width: "max-content",
            flexShrink: 0,
            alignItems: "center",
            gap: 8,
          }}
        >
          <Block style={{ width: 112, height: 32, borderRadius: 8 }} />
          {[96, 128, 98, 72, 84, 62].map((width, index) => (
            <Block
              key={index}
              style={{ width, height: 32, borderRadius: 8, flexShrink: 0 }}
            />
          ))}
        </div>
        <div style={{ flex: 1, minWidth: 16 }} />
        <Block
          style={{ width: 32, height: 36, borderRadius: 8, flexShrink: 0 }}
        />
        <Block
          style={{ width: 32, height: 36, borderRadius: 8, flexShrink: 0 }}
        />
        <Block
          style={{ width: 84, height: 32, borderRadius: 8, flexShrink: 0 }}
        />
        <Block
          style={{ width: 26, height: 26, borderRadius: "50%", flexShrink: 0 }}
        />
        <Block
          style={{ width: 32, height: 36, borderRadius: 8, flexShrink: 0 }}
        />
        <Block
          style={{ width: 32, height: 36, borderRadius: 8, flexShrink: 0 }}
        />
      </header>
      <main
        style={{
          display: "flex",
          minWidth: 0,
          flex: 1,
          minHeight: 0,
        }}
      >
        <section
          aria-hidden="true"
          data-agent-native-mail-list="true"
          style={{
            display: "flex",
            minWidth: 0,
            flex: 1,
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {Array.from({ length: 12 }, (_, index) => (
            <div
              key={index}
              style={{
                display: "flex",
                minHeight: 48,
                flexShrink: 0,
                alignItems: "center",
                borderBottom: BORDER,
                padding: "0 12px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  width: 20,
                  flexShrink: 0,
                  alignItems: "center",
                  justifyContent: "center",
                  marginRight: 8,
                }}
              >
                <Block style={{ width: 7, height: 7, borderRadius: "50%" }} />
              </div>
              <div
                data-agent-native-mail-sender="true"
                style={{
                  display: "flex",
                  width: 160,
                  flexShrink: 0,
                  alignItems: "center",
                  marginRight: 12,
                }}
              >
                <Block
                  style={{ width: `${88 + (index % 3) * 12}px`, height: 12 }}
                />
              </div>
              {index % 2 === 1 && (
                <div data-agent-native-mail-label="true">
                  <Block
                    style={{
                      width: 58,
                      height: 16,
                      borderRadius: 4,
                      marginRight: 8,
                    }}
                  />
                </div>
              )}
              <div
                style={{
                  display: "flex",
                  minWidth: 0,
                  flex: 1,
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <div style={{ width: 164, maxWidth: "75%", flexShrink: 0 }}>
                  <Block style={{ width: "100%", height: 12 }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Block style={{ width: "100%", height: 12 }} />
                </div>
              </div>
              <div
                data-agent-native-mail-time="true"
                style={{
                  width: 52,
                  flexShrink: 0,
                  marginLeft: 8,
                }}
              >
                <Block style={{ width: "100%", height: 11 }} />
              </div>
            </div>
          ))}
        </section>
        <aside
          aria-hidden="true"
          data-agent-native-mail-inspector="true"
          style={{
            display: "flex",
            width: 260,
            flexShrink: 0,
            flexDirection: "column",
            borderLeft: BORDER,
            padding: 16,
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              gap: 6,
              padding: "16px 0 12px",
            }}
          >
            <Block style={{ width: 32, height: 14 }} />
            <Block style={{ width: 160, height: 12 }} />
            <Block style={{ width: 112, height: 11 }} />
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 0",
            }}
          >
            <Block style={{ width: 20, height: 20, borderRadius: 6 }} />
            <Block style={{ width: 56, height: 11 }} />
          </div>
          <div style={{ height: 1, margin: "0 0 0", borderTop: BORDER }} />
          <Block style={{ width: 84, height: 11, marginTop: 8 }} />
        </aside>
      </main>
    </div>
  );
}

function CalendarLayout() {
  return (
    <>
      <Sidebar />
      <Frame>
        <section
          aria-hidden="true"
          style={{
            display: "flex",
            minHeight: 0,
            flex: 1,
            flexDirection: "column",
            padding: 20,
          }}
        >
          <div
            data-agent-native-app-skeleton-calendar-toolbar="true"
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 12,
              paddingBottom: 18,
            }}
          >
            <Block style={{ width: 142, height: 24 }} />
            <Block style={{ width: 32, height: 32, borderRadius: 8 }} />
            <Block style={{ width: 32, height: 32, borderRadius: 8 }} />
            <div style={{ flex: 1 }} />
            <Block style={{ width: 184, height: 32, borderRadius: 8 }} />
            <Block style={{ width: 96, height: 32, borderRadius: 8 }} />
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
              borderTop: BORDER,
              borderLeft: BORDER,
            }}
          >
            {Array.from({ length: 7 }, (_, index) => (
              <div
                key={index}
                style={{
                  padding: "12px 8px",
                  borderRight: BORDER,
                  borderBottom: BORDER,
                }}
              >
                <Block
                  style={{
                    width: `${38 + (index % 3) * 8}%`,
                    height: 12,
                    margin: "0 auto",
                  }}
                />
              </div>
            ))}
          </div>
          <div
            style={{
              display: "grid",
              minHeight: 0,
              flex: 1,
              gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
              gridTemplateRows: "repeat(5, minmax(72px, 1fr))",
              borderLeft: BORDER,
              borderTop: BORDER,
            }}
          >
            {Array.from({ length: 35 }, (_, index) => (
              <div
                key={index}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  borderRight: BORDER,
                  borderBottom: BORDER,
                  padding: 8,
                }}
              >
                <Block
                  style={{ width: 20, height: 10, alignSelf: "flex-end" }}
                />
                {index % 4 === 1 ? (
                  <Block
                    style={{ width: "86%", height: 18, borderRadius: 5 }}
                  />
                ) : null}
                {index % 7 === 3 ? (
                  <Block
                    style={{ width: "68%", height: 18, borderRadius: 5 }}
                  />
                ) : null}
              </div>
            ))}
          </div>
        </section>
      </Frame>
    </>
  );
}

function ListLayout() {
  return (
    <>
      <Sidebar />
      <Frame>
        <section
          aria-hidden="true"
          style={{
            display: "flex",
            minHeight: 0,
            flex: 1,
            flexDirection: "column",
            gap: 20,
            padding: 32,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <Block style={{ width: 220, height: 26 }} />
            <div style={{ flex: 1 }} />
            <Block style={{ width: 120, height: 34, borderRadius: 8 }} />
          </div>
          <div
            data-agent-native-app-skeleton-list-toolbar="true"
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 10,
            }}
          >
            <Block
              style={{ width: "min(260px, 100%)", height: 34, borderRadius: 8 }}
            />
            <Block style={{ width: 84, height: 30, borderRadius: 8 }} />
            <Block style={{ width: 84, height: 30, borderRadius: 8 }} />
          </div>
          <div
            style={{
              display: "flex",
              minHeight: 0,
              flex: 1,
              flexDirection: "column",
              borderTop: BORDER,
              borderLeft: BORDER,
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "2fr 1.3fr 1fr 1fr",
                gap: 12,
                padding: 12,
                borderBottom: BORDER,
                borderRight: BORDER,
              }}
            >
              {[0, 1, 2, 3].map((item) => (
                <Block
                  key={item}
                  style={{ width: `${52 + item * 8}%`, height: 11 }}
                />
              ))}
            </div>
            {Array.from({ length: 8 }, (_, index) => (
              <div
                key={index}
                style={{
                  display: "grid",
                  gridTemplateColumns: "2fr 1.3fr 1fr 1fr",
                  alignItems: "center",
                  gap: 12,
                  minHeight: 58,
                  padding: 12,
                  borderBottom: BORDER,
                  borderRight: BORDER,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Block style={{ width: 28, height: 28, borderRadius: 8 }} />
                  <Block
                    style={{ width: `${56 + (index % 3) * 10}%`, height: 13 }}
                  />
                </div>
                <Block style={{ width: "76%", height: 12 }} />
                <Block style={{ width: "60%", height: 12 }} />
                <Block style={{ width: "48%", height: 12 }} />
              </div>
            ))}
          </div>
        </section>
      </Frame>
    </>
  );
}

function DashboardLayout() {
  return (
    <>
      <Sidebar />
      <Frame>
        <section
          aria-hidden="true"
          style={{
            display: "flex",
            minHeight: 0,
            flex: 1,
            flexDirection: "column",
            padding: 32,
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
              marginBottom: 28,
            }}
          >
            <Block style={{ width: 72, height: 10 }} />
            <Block style={{ width: 210, height: 26 }} />
            <Block style={{ width: 320, height: 13 }} />
          </div>
          <div
            data-agent-native-skeleton-dashboard-grid="true"
            style={{
              display: "grid",
              minHeight: 0,
              flex: 1,
              gap: 28,
            }}
          >
            <main style={{ display: "flex", flexDirection: "column", gap: 32 }}>
              {[0, 1].map((section) => (
                <div
                  key={section}
                  style={{ display: "flex", flexDirection: "column", gap: 12 }}
                >
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 12 }}
                  >
                    <Block
                      style={{ width: section === 0 ? 124 : 136, height: 16 }}
                    />
                    <div style={{ flex: 1 }} />
                    {section === 0 ? (
                      <Block
                        style={{ width: 94, height: 28, borderRadius: 8 }}
                      />
                    ) : null}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      border: BORDER,
                      borderRadius: 8,
                    }}
                  >
                    {Array.from(
                      { length: section === 0 ? 6 : 4 },
                      (_, index) => (
                        <div
                          key={index}
                          style={{
                            display: "flex",
                            minHeight: section === 0 ? 56 : 64,
                            alignItems: "center",
                            gap: 12,
                            borderBottom:
                              index === (section === 0 ? 5 : 3)
                                ? undefined
                                : BORDER,
                            padding: "12px 14px",
                          }}
                        >
                          {section === 0 ? (
                            <Block
                              style={{
                                width: 20,
                                height: 20,
                                borderRadius: 10,
                              }}
                            />
                          ) : null}
                          <div
                            style={{
                              display: "flex",
                              flex: 1,
                              flexDirection: "column",
                              gap: 8,
                            }}
                          >
                            <Block
                              style={{
                                width: `${54 + (index % 3) * 10}%`,
                                height: 12,
                              }}
                            />
                            <Block
                              style={{
                                width: `${42 + (index % 4) * 9}%`,
                                height: 10,
                              }}
                            />
                          </div>
                          {section === 1 ? (
                            <Block
                              style={{
                                width: 60,
                                height: 20,
                                borderRadius: 10,
                              }}
                            />
                          ) : null}
                        </div>
                      ),
                    )}
                  </div>
                </div>
              ))}
            </main>
            <aside
              data-agent-native-skeleton-dashboard-focus="true"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 14,
                borderLeft: BORDER,
                paddingLeft: 24,
              }}
            >
              <Block style={{ width: 72, height: 16 }} />
              <Block style={{ width: 180, height: 12 }} />
              {Array.from({ length: 5 }, (_, index) => (
                <div
                  key={index}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    borderBottom: BORDER,
                    paddingBottom: 12,
                  }}
                >
                  <Block
                    style={{ width: `${34 + (index % 3) * 10}%`, height: 10 }}
                  />
                  <Block
                    style={{ width: `${62 + (index % 2) * 8}%`, height: 12 }}
                  />
                  <Block style={{ width: "90%", height: 10 }} />
                </div>
              ))}
            </aside>
          </div>
        </section>
      </Frame>
    </>
  );
}

function DocumentLayout() {
  return (
    <>
      <Sidebar />
      <Frame>
        <main
          aria-hidden="true"
          style={{
            display: "flex",
            flex: 1,
            justifyContent: "center",
            padding: "96px 48px 24px",
          }}
        >
          <section
            style={{
              display: "flex",
              width: "100%",
              maxWidth: 768,
              flexDirection: "column",
              gap: 24,
            }}
          >
            <Block style={{ width: "66%", height: 40 }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Block style={{ width: "100%", height: 14 }} />
              <Block style={{ width: "92%", height: 14 }} />
              <Block style={{ width: "80%", height: 14 }} />
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 12,
                paddingTop: 12,
              }}
            >
              <Block style={{ width: "72%", height: 14 }} />
              <Block style={{ width: "84%", height: 14 }} />
            </div>
          </section>
        </main>
      </Frame>
    </>
  );
}

function LaunchpadLayout() {
  return (
    <>
      <Sidebar />
      <Frame>
        <section
          aria-hidden="true"
          style={{
            display: "flex",
            minHeight: 0,
            flex: 1,
            flexDirection: "column",
            gap: 32,
            padding: 32,
          }}
        >
          <div
            style={{
              display: "flex",
              width: "100%",
              maxWidth: 750,
              flexDirection: "column",
              alignSelf: "center",
              gap: 14,
            }}
          >
            <Block style={{ width: "72%", height: 28, alignSelf: "center" }} />
            <Block style={{ width: "84%", height: 14, alignSelf: "center" }} />
            <Block style={{ width: "100%", height: 120, borderRadius: 16 }} />
            <div style={{ display: "flex", justifyContent: "center", gap: 8 }}>
              <Block style={{ width: 208, height: 28, borderRadius: 8 }} />
              <Block style={{ width: 220, height: 28, borderRadius: 8 }} />
            </div>
          </div>
          <div
            style={{
              width: "100%",
              maxWidth: 1000,
              alignSelf: "center",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                marginBottom: 12,
              }}
            >
              <Block style={{ width: 64, height: 16 }} />
              <div style={{ flex: 1 }} />
              <Block style={{ width: 76, height: 28, borderRadius: 8 }} />
              <Block style={{ width: 72, height: 28, borderRadius: 8 }} />
            </div>
            <div
              style={{
                display: "grid",
                gap: 12,
              }}
              data-agent-native-app-skeleton-launchpad-grid="true"
            >
              {Array.from({ length: 4 }, (_, index) => (
                <div
                  key={index}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    border: BORDER,
                    borderRadius: 10,
                    padding: 14,
                  }}
                >
                  <Block style={{ width: 36, height: 36, borderRadius: 8 }} />
                  <div
                    style={{
                      display: "flex",
                      flex: 1,
                      flexDirection: "column",
                      gap: 8,
                    }}
                  >
                    <Block
                      style={{ width: `${46 + (index % 3) * 10}%`, height: 13 }}
                    />
                    <Block
                      style={{ width: `${62 + (index % 2) * 12}%`, height: 10 }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </Frame>
    </>
  );
}

function WelcomeLayout() {
  return (
    <main
      aria-hidden="true"
      style={{
        display: "flex",
        minWidth: 0,
        flex: 1,
        justifyContent: "center",
        overflow: "auto",
        padding: 24,
      }}
    >
      <section
        style={{
          display: "flex",
          width: "100%",
          maxWidth: 640,
          flexDirection: "column",
          justifyContent: "center",
          gap: 20,
          padding: "48px 0",
        }}
      >
        <Block style={{ width: "52%", height: 30, alignSelf: "center" }} />
        <Block
          style={{
            width: "82%",
            height: 14,
            alignSelf: "center",
            marginBottom: 20,
          }}
        />
        <Block style={{ width: "100%", height: 52, borderRadius: 10 }} />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: 12,
          }}
        >
          {[0, 1, 2, 3].map((item) => (
            <Block key={item} style={{ height: 88, borderRadius: 10 }} />
          ))}
        </div>
      </section>
    </main>
  );
}

function DefaultLayout() {
  return (
    <>
      <Sidebar />
      <Frame>
        <section
          aria-hidden="true"
          style={{
            display: "flex",
            width: "100%",
            maxWidth: 960,
            flex: 1,
            flexDirection: "column",
            gap: 12,
            margin: "0 auto",
            padding: 24,
          }}
        >
          <Block style={{ width: "38%", height: 28, marginBottom: 8 }} />
          <Block style={{ width: "24%", height: 14, marginBottom: 16 }} />
          {Array.from({ length: 6 }, (_, index) => (
            <div
              key={index}
              style={{ display: "flex", alignItems: "center", gap: 12 }}
            >
              <Block style={{ width: 32, height: 32, borderRadius: 8 }} />
              <div
                style={{
                  display: "flex",
                  flex: 1,
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <Block
                  style={{ width: `${52 + (index % 3) * 12}%`, height: 12 }}
                />
                <Block
                  style={{ width: `${34 + (index % 4) * 10}%`, height: 10 }}
                />
              </div>
            </div>
          ))}
        </section>
      </Frame>
    </>
  );
}

export function AppShellSkeleton({
  ariaLabel = "Loading application",
  height = "var(--agent-native-viewport-height, 100vh)",
  layout,
}: {
  ariaLabel?: string;
  height?: CSSProperties["height"];
  layout?: AppShellSkeletonLayout;
}) {
  const layouts: Record<AppShellSkeletonLayout, ReactNode> = {
    assistant: <AssistantLayout />,
    calendar: <CalendarLayout />,
    dashboard: <DashboardLayout />,
    document: <DocumentLayout />,
    launchpad: <LaunchpadLayout />,
    list: <ListLayout />,
    mail: <MailLayout />,
    "prompt-library": <PromptLibraryLayout />,
    welcome: <WelcomeLayout />,
  };
  const content = layout ? layouts[layout] : null;

  return (
    <div
      role="status"
      aria-label={ariaLabel}
      data-agent-native-app-skeleton="true"
      data-agent-native-app-skeleton-layout={layout ?? "default"}
      style={{
        display: "flex",
        height,
        width: "100%",
        overflow: "hidden",
        backgroundColor: "hsl(var(--background, 0 0% 100%))",
        color: "hsl(var(--foreground, 240 10% 3.9%))",
      }}
    >
      <style>{`
        [data-agent-native-skeleton-block] {
          animation: an-app-shell-skeleton-pulse 1.2s ease-in-out infinite;
        }
        @keyframes an-app-shell-skeleton-pulse {
          0%, 100% { opacity: 0.45; }
          50% { opacity: 0.85; }
        }
        @media (prefers-reduced-motion: reduce) {
          [data-agent-native-skeleton-block] { animation: none; }
        }
        [data-agent-native-app-skeleton-gallery-grid] {
          grid-template-columns: minmax(0, 1fr);
        }
        @media (min-width: 40rem) {
          [data-agent-native-app-skeleton-gallery-grid] {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }
        @media (min-width: 64rem) {
          [data-agent-native-app-skeleton-gallery-grid] {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
        }
        @media (min-width: 80rem) {
          [data-agent-native-app-skeleton-gallery-grid] {
            grid-template-columns: repeat(4, minmax(0, 1fr));
          }
        }
        [data-agent-native-app-skeleton-launchpad-grid] {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        @media (max-width: 767px) {
          [data-agent-native-app-skeleton-launchpad-grid] {
            grid-template-columns: minmax(0, 1fr);
          }
        }
        [data-agent-native-skeleton-dashboard-grid] {
          grid-template-columns: minmax(0, 1fr) 320px;
        }
        @media (max-width: 1279px) {
          [data-agent-native-skeleton-dashboard-grid] {
            grid-template-columns: minmax(0, 1fr);
          }
          [data-agent-native-skeleton-dashboard-focus] {
            border-left: 0;
            border-top: ${BORDER};
            padding: 24px 0 0;
          }
        }
        @container agent-native-main (max-width: 979px) {
          [data-agent-native-mail-inspector] { display: none !important; }
        }
        [data-agent-native-mail-header]::-webkit-scrollbar { display: none; }
        @media (max-width: 767px) {
          [data-agent-native-app-skeleton-sidebar] { display: none !important; }
          [data-agent-native-mail-list] { width: 100% !important; }
          [data-agent-native-app-skeleton-layout="mail"] [data-agent-native-mail-list] { flex: 1; }
        }
        @media (max-width: 639px) {
          [data-agent-native-mail-sender] { width: 100px !important; }
          [data-agent-native-mail-label] { display: none !important; }
        }
        @media (min-width: 640px) {
          [data-agent-native-mail-list] > div { min-height: 38px !important; }
        }
      `}</style>
      {content ?? <DefaultLayout />}
    </div>
  );
}
