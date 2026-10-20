import { afterEach, describe, expect, it, vi } from "vitest";

const OWNER = "owner@example.com";
const ACCOUNTS = ["owner@example.com", "second@example.com"];
const AI_LABEL_ID = "Label_ai";

// Deterministic rows that cover every built-in tab rule: AI-important labels
// (by Gmail id), automated senders, promotions categories, unread counts,
// archived rows, and latestDate ties that exercise the id tie-breakers.
function syntheticRows(count: number) {
  let seed = 7;
  const next = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const labelChoices = [
    [],
    [AI_LABEL_ID],
    ["Label_work"],
    ["CATEGORY_PROMOTIONS"],
    ["CATEGORY_UPDATES", "Label_work"],
    [AI_LABEL_ID, "CATEGORY_PROMOTIONS"],
  ];
  const base = Date.UTC(2026, 0, 1);
  return Array.from({ length: count }, (_, i) => {
    const account = ACCOUNTS[i % ACCOUNTS.length];
    const labels = labelChoices[Math.floor(next() * labelChoices.length)];
    const unread = next() < 0.4 ? 1 + Math.floor(next() * 2) : 0;
    return {
      id: `${OWNER}:${account}:thread-${i}`,
      ownerEmail: OWNER,
      accountEmail: account,
      threadId: `thread-${i}`,
      historyId: "1",
      inInbox: next() < 0.9 ? 1 : 0,
      isUnread: unread > 0 ? 1 : 0,
      isStarred: 0,
      isImportant: 0,
      isAutomated: next() < 0.25 ? 1 : 0,
      latestDate: base + Math.floor(next() * 20) * 60_000,
      latestMessageId: `msg-${i}`,
      subject: `Subject ${i}`,
      snippet: `snippet ${i}`,
      fromName: "Sender",
      fromEmail: `sender${i % 7}@example.com`,
      toJson: "[]",
      labelIdsJson: JSON.stringify(["INBOX", ...labels]),
      messageIdsJson: JSON.stringify([`msg-${i}`]),
      messageCount: 1,
      unreadCount: unread,
      hasAttachments: 0,
      syncedAt: base,
      updatedAt: base,
    };
  });
}

describe("inbox tab windows match the in-memory partition in PGlite", () => {
  afterEach(async () => {
    const { closeDbExec } = await import("@agent-native/core/db");
    await closeDbExec();
    Reflect.deleteProperty(globalThis as object, "__agentNativePgliteClients");
    Reflect.deleteProperty(
      globalThis as object,
      "__agentNativePgliteProcessLocks",
    );
    Reflect.deleteProperty(
      globalThis as object,
      "__agentNativePgliteProcessExitCleanupRegistered",
    );
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("returns the same counts, page, and previews for every built-in tab", async () => {
    vi.stubEnv("DATABASE_URL", "pglite:memory");
    const [{ default: initializeMailDb }, { getDb, schema }, store, tabs] =
      await Promise.all([
        import("../plugins/db.js"),
        import("../db/index.js"),
        import("./inbox-store.js"),
        import("./inbox-tabs-server.js"),
      ]);
    await initializeMailDb({});

    const rows = syntheticRows(240);
    await getDb().insert(schema.mailInboxThreads).values(rows);

    const labelMapByAccount = new Map<string, Map<string, string>>([
      [
        ACCOUNTS[0],
        new Map([
          [AI_LABEL_ID, "agent-native-important"],
          ["Label_work", "Work"],
        ]),
      ],
      [ACCOUNTS[1], new Map([["Label_work", "Work"]])],
    ]);
    const aiLabelIdsByAccount = new Map(
      ACCOUNTS.map((account) => [
        account,
        store.aiImportantLabelIds(labelMapByAccount.get(account)),
      ]),
    );
    // The literal label name is a candidate too: inboxRowToItem keeps an
    // unmapped raw id as its own name.
    expect(aiLabelIdsByAccount.get(ACCOUNTS[0])).toEqual([
      AI_LABEL_ID,
      "agent-native-important",
    ]);

    const configs = [
      {
        name: "default",
        config: {
          pinnedLabels: [],
          savedFilters: [],
          labelAliases: {},
          combineInbox: false,
          showAllTab: true,
        },
      },
      {
        name: "no All tab",
        config: {
          pinnedLabels: [],
          savedFilters: [],
          labelAliases: {},
          combineInbox: false,
          showAllTab: false,
        },
      },
      {
        name: "combined inbox",
        config: {
          pinnedLabels: [],
          savedFilters: [],
          labelAliases: {},
          combineInbox: true,
          showAllTab: true,
        },
      },
    ];

    for (const scenario of configs) {
      const labelNameById = new Map<string, string>();
      const resolved = tabs.resolveInboxTabs(scenario.config, labelNameById);
      for (const accountEmails of [ACCOUNTS, [ACCOUNTS[1]]]) {
        const memberRows = await store.readInboxThreads(OWNER, {
          accountEmails,
        });
        const items = memberRows.map((row) =>
          store.inboxRowToItem(row, labelMapByAccount.get(row.accountEmail)),
        );
        const byTab = tabs.partitionInboxItems(items, resolved);
        // Guards against a vacuous pass: every built-in tab must hold rows here.
        for (const tab of resolved) {
          expect((byTab.get(tab.id) ?? []).length).toBeGreaterThan(0);
        }

        for (const tab of resolved) {
          const pageLimit = 17;
          for (const unreadOnly of [false, true]) {
            for (const offset of [0, 17, 34]) {
              const windows = await store.readInboxTabWindows({
                ownerEmail: OWNER,
                accountEmails,
                tabs: resolved,
                aiLabelIdsByAccount,
                pageTabId: tab.id,
                pageOffset: offset,
                pageLimit,
                pageUnreadOnly: unreadOnly,
                previewLimit: 50,
              });
              const keyOf = (r: { accountEmail?: string; threadId: string }) =>
                `${r.accountEmail}:${r.threadId}`;
              const members = byTab.get(tab.id) ?? [];

              for (const other of resolved) {
                const expected = byTab.get(other.id) ?? [];
                expect(
                  windows.counts.get(other.id),
                  `${scenario.name}/${other.id}`,
                ).toEqual({
                  total: expected.length,
                  unread: expected.filter((item) => item.unreadCount > 0)
                    .length,
                });
                expect(
                  windows.previews.get(other.id)?.map(keyOf),
                  `${scenario.name}/${other.id} preview`,
                ).toEqual(expected.slice(0, 50).map((item) => keyOf(item)));
              }

              const pool = unreadOnly
                ? members.filter((item) => item.unreadCount > 0)
                : members;
              expect(
                windows.page.map(keyOf),
                `${scenario.name}/${tab.id} page offset ${offset} unread ${unreadOnly}`,
              ).toEqual(
                pool
                  .slice(offset, offset + pageLimit)
                  .map((item) => keyOf(item)),
              );
            }
          }
        }
      }
    }
  }, 60_000);
});
