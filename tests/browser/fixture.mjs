// Synthetic data only. This fixture never opens the user's data directory.
export function browserFixture() {
  const scholar = Array.from({ length: 60 }, (_, i) => ({
    subscriptionId: `openalex:A${i + 1}`, label: `测试学者 ${String(i + 1).padStart(3, "0")}`,
    openAlexIds: [`A${i + 1}`], semanticScholarIds: [],
    institution: "示例大学", followedAt: "2026-08-01T00:00:00.000Z", trackingStatus: "verified",
  }));
  const journal = Array.from({ length: 20 }, (_, i) => ({
    label: `测试期刊 ${i + 1}`, issn: `1000-${String(i).padStart(4, "0")}`,
    followedAt: "2026-08-01T00:00:00.000Z",
  }));
  const keyword = Array.from({ length: 20 }, (_, i) => ({
    root: `测试关键词 ${i + 1}`, variants: [`keyword ${i + 1}`], followedAt: "2026-08-01T00:00:00.000Z",
  }));
  scholar[0].label = "测试学者 001 一个用于检查截断和点击区域的非常长的姓名";
  return {
    version: 8, revision: 0, subscriptions: { scholar, journal, keyword },
    states: { protected: { saved: true, read: true, ignored: true } }, articleArchive: {},
    translations: { protected: "应保留的合成译文" }, scholarProfiles: {},
    feed: { items: [], scholars: scholar, updatedAt: new Date().toISOString(), source: "live", warnings: [],
      coverage: scholar.map((s) => ({ kind: "scholar", subscriptionId: s.subscriptionId, label: s.label,
        status: "success", providers: [{ provider: "openalex", status: "success" }],
      })),
    },
  };
}
