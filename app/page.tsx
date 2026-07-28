"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type MatchKind = "journal" | "scholar" | "keyword";
type Match = { kind: MatchKind; label: string; terms?: string[] };
type Journal = { label: string; issn: string };
type KeywordGroup = {
  root: string;
  variants: string[];
};
type Scholar = {
  label: string;
  openAlexIds: string[];
  institution: string;
  profileUrl?: string;
  orcid?: string;
  worksCount?: number;
  researchAreas?: string[];
};
type Subscriptions = {
  journal: Journal[];
  scholar: Scholar[];
  keyword: KeywordGroup[];
};
type SearchResult = {
  label: string;
  value: string;
  detail?: string;
  institution?: string;
  profileUrl?: string;
  orcid?: string;
  worksCount?: number;
  researchAreas?: string[];
};

type Article = {
  id: string;
  doi?: string;
  title: string;
  authors: string[];
  venue: string;
  publisher?: string;
  publishedAt: string;
  type: string;
  url: string;
  abstract?: string;
  keywords?: string[];
  matches: Match[];
};

type FeedResponse = {
  items: Article[];
  updatedAt: string;
  source: "live" | "fallback";
  historyScholar?: string;
  scholars?: Scholar[];
  warnings?: string[];
};

type ArticleState = { saved: boolean; read: boolean; ignored: boolean };
type Filter = "all" | MatchKind | "saved";
type SubscriptionSelection = { kind: MatchKind; label: string } | null;
type LocalData = {
  subscriptions: Subscriptions;
  states: Record<string, ArticleState>;
  feed: FeedResponse | null;
  translations: Record<string, string>;
};

const FILTERS: { id: Filter; label: string; icon: string }[] = [
  { id: "all", label: "学者动态", icon: "●" },
  { id: "journal", label: "期刊更新", icon: "▦" },
  { id: "keyword", label: "关键词命中", icon: "#" },
  { id: "saved", label: "已收藏", icon: "♡" },
];

const DEFAULT_SUBSCRIPTIONS: Subscriptions = {
  journal: [],
  scholar: [],
  keyword: [],
};

const LEGACY_ARTICLE_STORAGE = "anthropology-canteen.article-state.v1";
const LEGACY_SUBSCRIPTION_STORAGE = "anthropology-canteen.subscriptions.v1";
const LEGACY_FEED_STORAGE = "anthropology-canteen.feed-cache.v1";
const LEGACY_TRANSLATION_STORAGE = "anthropology-canteen.translations.v1";
const LEGACY_STORAGE_KEYS = [
  LEGACY_ARTICLE_STORAGE,
  LEGACY_SUBSCRIPTION_STORAGE,
  LEGACY_FEED_STORAGE,
  LEGACY_TRANSLATION_STORAGE,
];

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  }).format(date);
}

function relativeDate(value: string) {
  const date = new Date(value);
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days <= 0) return "今天";
  if (days === 1) return "昨天";
  if (days < 30) return `${days} 天前`;
  return formatDate(value);
}

function kindLabel(kind: MatchKind) {
  return kind === "journal" ? "期刊" : kind === "scholar" ? "学者" : "关键词";
}

function defaultArticleState(): ArticleState {
  return { saved: false, read: false, ignored: false };
}

function defaultLocalData(): LocalData {
  return {
    subscriptions: DEFAULT_SUBSCRIPTIONS,
    states: {},
    feed: null,
    translations: {},
  };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function canonicalKeywordRoot(input: string) {
  const value = input.trim().toLowerCase().replace(/\s+/g, " ");
  if (!/^[a-z]+$/.test(value)) return value;
  if (value.endsWith("ically") && value.length > 7) return value.slice(0, -4);
  if (value.endsWith("ical") && value.length > 6) return value.slice(0, -2);
  if (value.endsWith("ies") && value.length > 4) {
    return `${value.slice(0, -3)}y`;
  }
  if (value.endsWith("ics") && value.length > 5) return value.slice(0, -1);
  if (value.endsWith("s") && value.length > 4 && !value.endsWith("ss")) {
    return value.slice(0, -1);
  }
  return value;
}

function keywordVariants(root: string) {
  if (!/^[a-z]+$/.test(root)) return [root];
  let variants: string[];
  if (root.endsWith("ic")) {
    variants = [root, `${root}s`, `${root}al`, `${root}ally`];
  } else if (root.endsWith("y") && root.length > 3) {
    const stem = root.slice(0, -1);
    variants = [root, `${stem}ies`, `${stem}ical`, `${stem}ically`];
  } else if (root.endsWith("e") && root.length > 3) {
    const stem = root.slice(0, -1);
    variants = [
      root,
      `${root}s`,
      `${root}d`,
      `${stem}ing`,
      `${root}ful`,
    ];
  } else {
    variants = [root, `${root}s`, `${root}ed`, `${root}ing`, `${root}al`];
  }
  return [...new Set(variants)];
}

function createKeywordGroup(input: string): KeywordGroup | null {
  const root = canonicalKeywordRoot(input);
  if (!root) return null;
  return { root, variants: keywordVariants(root) };
}

function safeKeywordGroup(value: unknown): KeywordGroup | null {
  if (typeof value === "string") return createKeywordGroup(value);
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<KeywordGroup>;
  const root = canonicalKeywordRoot(
    typeof candidate.root === "string" ? candidate.root : "",
  );
  if (!root) return null;
  const storedVariants = Array.isArray(candidate.variants)
    ? candidate.variants
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean)
    : [];
  return {
    root,
    variants: [...new Set([root, ...storedVariants, ...keywordVariants(root)])],
  };
}

function keywordGroupLabel(group: KeywordGroup) {
  return group.variants.join(" / ");
}

function keywordVariantSource(keyword: string) {
  const value = keyword.trim().toLowerCase();
  if (!value) return "";
  if (!/^[a-z]+$/i.test(value)) return escapeRegExp(value);

  let base = value;
  if (base.endsWith("ies") && base.length > 4) {
    base = `${base.slice(0, -3)}y`;
  } else if (
    base.endsWith("s") &&
    base.length > 4 &&
    !base.endsWith("ss")
  ) {
    base = base.slice(0, -1);
  }

  if (base.endsWith("y") && base.length > 3) {
    const stem = escapeRegExp(base.slice(0, -1));
    return `${stem}(?:y|ies|ical|ically|ist|ists)`;
  }
  if (base.endsWith("e") && base.length > 3) {
    const escaped = escapeRegExp(base);
    const withoutE = escapeRegExp(base.slice(0, -1));
    return `(?:${escaped}(?:s|d|r|rs|ful|fully|less|lessly)?|${withoutE}ing)`;
  }
  return `${escapeRegExp(base)}(?:s|es|ed|ing|er|ers|al|ally|ic|ical|ically)?`;
}

function keywordRegex(keyword: string, global = false) {
  const source = keywordVariantSource(keyword);
  if (!source) return null;
  try {
    return new RegExp(
      `(?<!\\p{L})(?:${source})(?!\\p{L})`,
      global ? "giu" : "iu",
    );
  } catch {
    return new RegExp(escapeRegExp(keyword), global ? "gi" : "i");
  }
}

function matchesKeyword(text: string, keyword: string) {
  return Boolean(keywordRegex(keyword)?.test(text));
}

function HighlightedText({
  text,
  keywords,
}: {
  text: string;
  keywords: string[];
}) {
  const sources = keywords.map(keywordVariantSource).filter(Boolean);
  if (!sources.length) return text;
  let pattern: RegExp;
  try {
    pattern = new RegExp(
      `((?<!\\p{L})(?:${sources.join("|")})(?!\\p{L}))`,
      "giu",
    );
  } catch {
    pattern = new RegExp(`(${keywords.map(escapeRegExp).join("|")})`, "gi");
  }
  return text.split(pattern).map((part, index) =>
    index % 2 === 1 ? <mark key={`${part}-${index}`}>{part}</mark> : part,
  );
}

function safeSubscriptions(value: unknown): Subscriptions {
  if (!value || typeof value !== "object") return DEFAULT_SUBSCRIPTIONS;
  const candidate = value as Record<string, unknown>;
  if (
    !Array.isArray(candidate.journal) ||
    !Array.isArray(candidate.scholar) ||
    !Array.isArray(candidate.keyword)
  ) {
    return DEFAULT_SUBSCRIPTIONS;
  }
  return {
    journal: candidate.journal.filter(
      (item): item is Journal =>
        Boolean(item && typeof item.label === "string" && typeof item.issn === "string"),
    ),
    scholar: candidate.scholar
      .map((item) => {
        if (typeof item === "string") {
          const normalized = item.toLowerCase().replace(/^c\.\s*/, "");
          return (
            DEFAULT_SUBSCRIPTIONS.scholar.find(
              (known) =>
                known.label.toLowerCase().replace(/^c\.\s*/, "") === normalized,
            ) || {
              label: item,
              openAlexIds: [],
              institution: "单位待确认",
            }
          );
        }
        if (
          item &&
          typeof item === "object" &&
          typeof (item as Scholar).label === "string"
        ) {
          const scholar = item as Scholar;
          return {
            label: scholar.label,
            openAlexIds: Array.isArray(scholar.openAlexIds)
              ? scholar.openAlexIds
              : [],
            institution: scholar.institution || "单位待确认",
            profileUrl: scholar.profileUrl,
            orcid: scholar.orcid,
            worksCount: scholar.worksCount,
            researchAreas: Array.isArray(scholar.researchAreas)
              ? scholar.researchAreas.filter(
                  (item): item is string => typeof item === "string",
                )
              : undefined,
          };
        }
        return null;
      })
      .filter((item): item is Scholar => Boolean(item)),
    keyword: candidate.keyword
      .map(safeKeywordGroup)
      .filter((item): item is KeywordGroup => Boolean(item))
      .filter(
        (item, index, all) =>
          all.findIndex((candidate) => candidate.root === item.root) === index,
      ),
  };
}

function safeArticleStates(value: unknown): Record<string, ArticleState> {
  if (!value || typeof value !== "object") return {};
  const result: Record<string, ArticleState> = {};
  for (const [id, state] of Object.entries(value)) {
    if (!state || typeof state !== "object") continue;
    const item = state as Partial<ArticleState>;
    result[id] = {
      saved: Boolean(item.saved),
      read: Boolean(item.read),
      ignored: Boolean(item.ignored),
    };
  }
  return result;
}

function safeTranslations(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const result: Record<string, string> = {};
  for (const [id, translation] of Object.entries(value)) {
    if (typeof translation === "string") result[id] = translation;
  }
  return result;
}

function safeFeed(value: unknown): FeedResponse | null {
  if (!value || typeof value !== "object") return null;
  const feed = value as Partial<FeedResponse>;
  if (!Array.isArray(feed.items)) return null;
  return {
    items: feed.items.filter(
      (item): item is Article =>
        Boolean(
          item &&
            typeof item === "object" &&
            typeof (item as Article).id === "string" &&
            typeof (item as Article).title === "string" &&
            Array.isArray((item as Article).matches),
        ),
    ),
    updatedAt:
      typeof feed.updatedAt === "string"
        ? feed.updatedAt
        : new Date().toISOString(),
    source: feed.source === "fallback" ? "fallback" : "live",
    historyScholar:
      typeof feed.historyScholar === "string" ? feed.historyScholar : undefined,
    scholars: Array.isArray(feed.scholars) ? feed.scholars : [],
    warnings: Array.isArray(feed.warnings)
      ? feed.warnings.filter((item): item is string => typeof item === "string")
      : [],
  };
}

function migrateFeedKeywordMatches(
  feed: FeedResponse | null,
  keywordGroups: KeywordGroup[],
) {
  if (!feed || keywordGroups.length === 0) return feed;
  return {
    ...feed,
    items: feed.items.map((article) => ({
      ...article,
      matches: article.matches.map((match) => {
        if (match.kind !== "keyword") return match;
        const normalized = canonicalKeywordRoot(match.label);
        const group = keywordGroups.find(
          (candidate) =>
            candidate.root === normalized ||
            candidate.variants.includes(match.label.toLowerCase()),
        );
        return group
          ? {
              ...match,
              label: keywordGroupLabel(group),
              terms: group.variants,
            }
          : match;
      }),
    })),
  };
}

function safeLocalData(value: unknown): LocalData {
  if (!value || typeof value !== "object") return defaultLocalData();
  const data = value as Partial<LocalData>;
  const subscriptions = safeSubscriptions(data.subscriptions);
  return {
    subscriptions,
    states: safeArticleStates(data.states),
    feed: migrateFeedKeywordMatches(
      safeFeed(data.feed),
      subscriptions.keyword,
    ),
    translations: safeTranslations(data.translations),
  };
}

function hasStoredLocalData(data: LocalData) {
  return (
    data.subscriptions.journal.length > 0 ||
    data.subscriptions.scholar.length > 0 ||
    data.subscriptions.keyword.length > 0 ||
    Object.keys(data.states).length > 0 ||
    Object.keys(data.translations).length > 0 ||
    Boolean(data.feed?.items.length)
  );
}

function readLegacyBrowserData(): LocalData | null {
  const data = defaultLocalData();
  try {
    const storedSubscriptions = localStorage.getItem(LEGACY_SUBSCRIPTION_STORAGE);
    const storedStates = localStorage.getItem(LEGACY_ARTICLE_STORAGE);
    const storedFeed = localStorage.getItem(LEGACY_FEED_STORAGE);
    const storedTranslations = localStorage.getItem(LEGACY_TRANSLATION_STORAGE);
    if (storedSubscriptions) {
      data.subscriptions = safeSubscriptions(JSON.parse(storedSubscriptions));
    }
    if (storedStates) data.states = safeArticleStates(JSON.parse(storedStates));
    if (storedFeed) data.feed = safeFeed(JSON.parse(storedFeed));
    if (storedTranslations) {
      data.translations = safeTranslations(JSON.parse(storedTranslations));
    }
  } catch {
    return null;
  }
  return hasStoredLocalData(data) ? data : null;
}

function clearLegacyBrowserData() {
  for (const key of LEGACY_STORAGE_KEYS) localStorage.removeItem(key);
}

async function writeLocalData(data: LocalData) {
  const response = await fetch("/api/local-data", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error("local data unavailable");
  return safeLocalData(await response.json());
}

export default function Home() {
  const [feed, setFeed] = useState<FeedResponse | null>(null);
  const [subscriptions, setSubscriptions] =
    useState<Subscriptions>(DEFAULT_SUBSCRIPTIONS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [activeSubscription, setActiveSubscription] =
    useState<SubscriptionSelection>(null);
  const [historyScholar, setHistoryScholar] = useState<string>();
  const [query, setQuery] = useState("");
  const [states, setStates] = useState<Record<string, ArticleState>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState("");
  const [translating, setTranslating] = useState<string | null>(null);
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [addKind, setAddKind] = useState<MatchKind>("journal");
  const [addQuery, setAddQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const localDataRef = useRef<LocalData>(defaultLocalData());
  const saveQueueRef = useRef(Promise.resolve());
  const keywordSuggestion = useMemo(
    () => (addKind === "keyword" ? createKeywordGroup(addQuery) : null),
    [addKind, addQuery],
  );
  const searchActive =
    addOpen && addKind !== "keyword" && addQuery.trim().length >= 2;
  const visibleSearching = searchActive && searching;
  const visibleSearchResults = searchActive ? searchResults : [];

  function applyLocalData(data: LocalData) {
    localDataRef.current = data;
    setSubscriptions(data.subscriptions);
    setStates(data.states);
    setTranslations(data.translations);
    setFeed(data.feed);
  }

  function persistLocalData(patch: Partial<LocalData>, silent = false) {
    const next = { ...localDataRef.current, ...patch };
    localDataRef.current = next;
    saveQueueRef.current = saveQueueRef.current
      .catch(() => undefined)
      .then(() => writeLocalData(next))
      .then((saved) => {
        if (localDataRef.current === next) localDataRef.current = saved;
      })
      .catch(() => {
        // showNotice is a stable component helper; this promise runs after render.
        // eslint-disable-next-line react-hooks/immutability
        if (!silent) showNotice("本地文件保存失败，请确认文件夹可写");
      });
    return saveQueueRef.current;
  }

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch("/api/local-data", { cache: "no-store" });
        if (!response.ok) throw new Error("local data unavailable");
        let data = safeLocalData(await response.json());
        const legacyData = !hasStoredLocalData(data)
          ? readLegacyBrowserData()
          : null;

        if (legacyData) {
          data = legacyData;
          await writeLocalData(data);
          clearLegacyBrowserData();
          if (!cancelled) showNotice("已将旧版浏览器数据迁移到本地文件夹");
        }

        if (cancelled) return;
        applyLocalData(data);
        // Boot intentionally uses the initial local snapshot exactly once.
        // eslint-disable-next-line react-hooks/immutability
        await loadFeed(false, undefined, data.subscriptions, data.feed);
      } catch {
        if (!cancelled) {
          setError("无法读取文件夹内的本地数据，请确认已经完整解压且文件夹可写。");
          setSubscriptions(DEFAULT_SUBSCRIPTIONS);
          setLoading(false);
        }
      }
    }
    void boot();
    return () => {
      cancelled = true;
    };
    // Boot is intentionally a one-time migration and initial-load effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    let session: EventSource | undefined;
    async function connectPortableSession() {
      try {
        const response = await fetch("/api/runtime-status", {
          cache: "no-store",
        });
        if (!response.ok) return;
        const status = (await response.json()) as { app?: string };
        if (cancelled || status.app !== "anthropology-canteen") return;
        session = new EventSource("/api/browser-session");
      } catch {
        // Hosted previews do not use the portable server lifecycle.
      }
    }
    void connectPortableSession();
    return () => {
      cancelled = true;
      session?.close();
    };
  }, []);

  useEffect(() => {
    if (!searchActive) return;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const response = await fetch(
          `/api/search?kind=${addKind}&q=${encodeURIComponent(addQuery.trim())}`,
          { cache: "no-store" },
        );
        const data = (await response.json()) as { results?: SearchResult[] };
        setSearchResults(data.results || []);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 360);
    return () => window.clearTimeout(timer);
  }, [addKind, addQuery, searchActive]);

  async function loadFeed(
    force = false,
    scholar?: string,
    sourceSubscriptions = subscriptions,
    cachedFeed = localDataRef.current.feed,
  ) {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/feed${force ? "?refresh=1" : ""}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          subscriptions: sourceSubscriptions,
          historyScholar: scholar,
        }),
      });
      if (!response.ok) throw new Error("feed unavailable");
      const data = (await response.json()) as FeedResponse;
      setFeed(data);
      void persistLocalData({
        feed: data,
        subscriptions: sourceSubscriptions,
      });
      if (force) showNotice("已检查最新出版记录");
    } catch {
      const cached = cachedFeed || localDataRef.current.feed;
      if (cached) {
        setFeed(cached);
        setError("暂时无法更新，正在显示上次保存的内容。");
      } else {
        setError("暂时无法读取学术数据，请稍后再试。");
      }
    } finally {
      setLoading(false);
    }
  }

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2600);
  }

  function saveSubscriptions(next: Subscriptions) {
    setSubscriptions(next);
    void persistLocalData({ subscriptions: next });
  }

  function updateArticle(id: string, patch: Partial<ArticleState>) {
    const next = {
      ...localDataRef.current.states,
      [id]: {
        ...(localDataRef.current.states[id] || defaultArticleState()),
        ...patch,
      },
    };
    setStates(next);
    void persistLocalData({ states: next });
  }

  function addSubscription(result?: SearchResult) {
    if (addKind === "keyword") {
      if (!keywordSuggestion) return;
      if (
        subscriptions.keyword.some(
          (item) => item.root === keywordSuggestion.root,
        )
      ) {
        showNotice("这个词根及其变体已经在关注列表中");
        return;
      }
      const next = {
        ...subscriptions,
        keyword: [...subscriptions.keyword, keywordSuggestion],
      };
      saveSubscriptions(next);
      void loadFeed(false, historyScholar, next);
    } else if (addKind === "journal" && result) {
      if (subscriptions.journal.some((item) => item.issn === result.value)) {
        showNotice("这本期刊已经在关注列表中");
        return;
      }
      const next = {
        ...subscriptions,
        journal: [
          ...subscriptions.journal,
          { label: result.label, issn: result.value },
        ],
      };
      saveSubscriptions(next);
      void loadFeed(false, undefined, next);
    } else if (addKind === "scholar" && result) {
      if (
        subscriptions.scholar.some(
          (item) => item.label.toLowerCase() === result.label.toLowerCase(),
        )
      ) {
        showNotice("这位学者已经在关注列表中");
        return;
      }
      const next = {
        ...subscriptions,
        scholar: [
          ...subscriptions.scholar,
          {
            label: result.label,
            openAlexIds: [result.value],
            institution: result.institution || "单位待确认",
            profileUrl: result.profileUrl,
            orcid: result.orcid,
            worksCount: result.worksCount,
            researchAreas: result.researchAreas,
          },
        ],
      };
      saveSubscriptions(next);
      void loadFeed(false, undefined, next);
    } else {
      return;
    }
    setAddOpen(false);
    setAddQuery("");
    setSearchResults([]);
    showNotice("已添加到你的关注");
  }

  function removeSubscription(kind: MatchKind, label: string) {
    const next: Subscriptions =
      kind === "journal"
        ? {
            ...subscriptions,
            journal: subscriptions.journal.filter((item) => item.label !== label),
          }
        : kind === "scholar"
          ? {
              ...subscriptions,
              scholar: subscriptions.scholar.filter(
                (item) => item.label !== label,
              ),
            }
          : {
              ...subscriptions,
              keyword: subscriptions.keyword.filter(
                (item) => keywordGroupLabel(item) !== label,
              ),
            };
    saveSubscriptions(next);
    if (
      activeSubscription?.kind === kind &&
      activeSubscription.label === label
    ) {
      setActiveSubscription(null);
      setFilter("all");
      setHistoryScholar(undefined);
    }
    void loadFeed(false, undefined, next);
    showNotice("已从关注列表移除");
  }

  async function selectSubscription(kind: MatchKind, label: string) {
    setFilter(kind);
    setActiveSubscription({ kind, label });
    if (kind === "scholar") {
      setHistoryScholar(label);
      await loadFeed(false, label);
    } else if (historyScholar) {
      setHistoryScholar(undefined);
      await loadFeed();
    }
  }

  async function selectFilter(nextFilter: Filter) {
    setFilter(nextFilter);
    setActiveSubscription(null);
    if (historyScholar) {
      setHistoryScholar(undefined);
      await loadFeed();
    }
  }

  async function translateAbstract(article: Article) {
    if (!article.abstract) {
      showNotice("这条记录没有可翻译的摘要");
      return;
    }
    setTranslating(article.id);
    try {
      const response = await fetch("/api/translate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: article.abstract }),
      });
      const data = (await response.json()) as {
        translation?: string;
        message?: string;
      };
      if (!response.ok || !data.translation) {
        showNotice(data.message || "中文翻译暂时不可用");
        return;
      }
      const next = {
        ...localDataRef.current.translations,
        [article.id]: data.translation!,
      };
      setTranslations(next);
      void persistLocalData({ translations: next });
      showNotice("已生成中文摘要");
    } catch {
      showNotice("中文翻译暂时不可用");
    } finally {
      setTranslating(null);
    }
  }

  const visibleItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return (feed?.items || []).filter((article) => {
      const state = states[article.id] || defaultArticleState();
      if (state.ignored) return false;
      if (filter === "saved" && !state.saved) return false;
      if (
        filter !== "all" &&
        filter !== "saved" &&
        !article.matches.some((match) => match.kind === filter)
      ) {
        return false;
      }
      if (
        activeSubscription &&
        !article.matches.some(
          (match) =>
            match.kind === activeSubscription.kind &&
            match.label === activeSubscription.label,
        )
      ) {
        return false;
      }
      if (!normalized) return true;
      return [
        article.title,
        article.venue,
        article.authors.join(" "),
        article.abstract || "",
        ...(article.keywords || []),
        article.matches.map((match) => match.label).join(" "),
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalized);
    });
  }, [activeSubscription, feed, filter, query, states]);

  const isScholarOverview = !activeSubscription && filter === "all";
  const scholarCards = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return subscriptions.scholar
      .map((savedScholar) => {
        const scholar =
          feed?.scholars?.find(
            (item) =>
              item.label.toLowerCase() === savedScholar.label.toLowerCase(),
          ) || savedScholar;
        const articles = (feed?.items || [])
          .filter(
            (article) =>
              !states[article.id]?.ignored &&
              article.matches.some(
                (match) =>
                  match.kind === "scholar" &&
                  match.label.toLowerCase() === scholar.label.toLowerCase(),
              ),
          )
          .sort(
            (a, b) =>
              new Date(b.publishedAt).getTime() -
              new Date(a.publishedAt).getTime(),
          );
        return { scholar, articles, latest: articles[0] };
      })
      .filter(({ scholar, articles }) => {
        if (!normalizedQuery) return true;
        return [
          scholar.label,
          scholar.institution,
          ...(scholar.researchAreas || []),
          ...articles.flatMap((article) => [
            article.title,
            article.abstract || "",
            article.authors.join(" "),
            ...(article.keywords || []),
          ]),
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);
      })
      .sort((a, b) => {
        const aTime = a.latest
          ? new Date(a.latest.publishedAt).getTime()
          : Number.NEGATIVE_INFINITY;
        const bTime = b.latest
          ? new Date(b.latest.publishedAt).getTime()
          : Number.NEGATIVE_INFINITY;
        return bTime - aTime || a.scholar.label.localeCompare(b.scholar.label);
      });
  }, [feed, query, states, subscriptions.scholar]);

  const unreadCount = (feed?.items || []).filter(
    (article) => !states[article.id]?.read && !states[article.id]?.ignored,
  ).length;
  const savedCount = Object.values(states).filter((state) => state.saved).length;
  const currentScholar =
    activeSubscription?.kind === "scholar"
      ? subscriptions.scholar.find(
          (item) => item.label === activeSubscription.label,
        ) ||
        feed?.scholars?.find(
          (item) => item.label === activeSubscription.label,
        )
      : undefined;

  async function openScholar(label: string) {
    await selectSubscription("scholar", label);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="Anthropology Canteen 首页">
          <span className="brand-mark">AC</span>
          <strong>ANTHROPOLOGY CANTEEN</strong>
        </a>
        <div className="topbar-actions">
          <label className="search">
            <span aria-hidden="true">⌕</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索题目、作者或主题"
              aria-label="搜索文章"
            />
          </label>
          <button
            className="refresh-button"
            onClick={() => void loadFeed(true, historyScholar)}
            disabled={loading}
          >
            <span className={loading ? "spin" : ""} aria-hidden="true">↻</span>
            {loading ? "检查中" : "检查更新"}
          </button>
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <nav className="filter-nav" aria-label="信息流筛选">
            {FILTERS.map((item) => (
              <button
                key={item.id}
                className={filter === item.id && !activeSubscription ? "active" : ""}
                onClick={() => void selectFilter(item.id)}
              >
                <span className="nav-icon" aria-hidden="true">{item.icon}</span>
                {item.label}
                {item.id === "all" && <em>{unreadCount}</em>}
                {item.id === "saved" && savedCount > 0 && <em>{savedCount}</em>}
              </button>
            ))}
          </nav>

          <div className="divider" />

          <section className="subscriptions">
            <div className="section-heading">
              <span>我的关注</span>
              <button
                aria-label="添加关注项"
                title="搜索并添加关注"
                onClick={() => setAddOpen(true)}
              >
                ＋
              </button>
            </div>
            <SubscriptionGroup
              title="学者"
              items={subscriptions.scholar.map((item) => item.label)}
              kind="scholar"
              activeLabel={activeSubscription?.label}
              onSelect={(label) => void selectSubscription("scholar", label)}
              onRemove={(label) => removeSubscription("scholar", label)}
            />
            <SubscriptionGroup
              title="期刊"
              items={subscriptions.journal.map((item) => item.label)}
              kind="journal"
              activeLabel={activeSubscription?.label}
              onSelect={(label) => void selectSubscription("journal", label)}
              onRemove={(label) => removeSubscription("journal", label)}
            />
            <SubscriptionGroup
              title="关键词"
              items={subscriptions.keyword.map(keywordGroupLabel)}
              kind="keyword"
              activeLabel={activeSubscription?.label}
              onSelect={(label) => void selectSubscription("keyword", label)}
              onRemove={(label) => removeSubscription("keyword", label)}
            />
          </section>

          <div className="sidebar-note">
            <span className="pulse-dot" />
            <div>
              <strong>配置保存在当前文件夹</strong>
              <small>无需账号，复制自己的文件夹即可带走</small>
            </div>
          </div>
        </aside>

        <section className="feed">
          <div className="feed-heading">
            <div>
              <p className="eyebrow">
                {new Intl.DateTimeFormat("zh-CN", {
                  month: "long",
                  day: "numeric",
                  weekday: "long",
                }).format(new Date())}
              </p>
              <h1>
                {activeSubscription?.label ||
                  (filter === "all"
                    ? "学者动态"
                    : filter === "journal"
                      ? "期刊更新"
                      : filter === "keyword"
                        ? "关键词命中"
                        : "已收藏")}
              </h1>
              <p>
                {isScholarOverview
                  ? "按最近发表时间排列，共关注 "
                  : historyScholar
                  ? "正在展示该学者可检索到的历史发表，共 "
                  : activeSubscription
                    ? `仅显示该${kindLabel(activeSubscription.kind)}下的内容，共 `
                    : "从你的关注网络中发现 "}
                <strong>
                  {feed
                    ? isScholarOverview
                      ? scholarCards.length
                      : visibleItems.length
                    : "—"}
                </strong>
                {isScholarOverview ? " 位学者" : " 条记录"}
              </p>
            </div>
            <div className="feed-status">
              <span className={feed?.source === "live" ? "live" : "fallback"} />
              公开学术数据
            </div>
          </div>

          {currentScholar && (
            <section className="scholar-profile">
              <div className="scholar-monogram" aria-hidden="true">
                {currentScholar.label
                  .split(/\s+/)
                  .map((part) => part[0])
                  .slice(0, 2)
                  .join("")}
              </div>
              <div>
                <p>身份已确认</p>
                <h2>{currentScholar.label}</h2>
                <strong>{currentScholar.institution}</strong>
                <small>
                  公开索引约收录{" "}
                  {currentScholar.worksCount?.toLocaleString("zh-CN") || "—"}{" "}
                  条成果；下方合并展示历史发表与近期更新。
                </small>
                {currentScholar.researchAreas?.length ? (
                  <small>
                    研究方向：{currentScholar.researchAreas.join("、")}
                  </small>
                ) : null}
                <nav>
                  {currentScholar.profileUrl && (
                    <a
                      href={currentScholar.profileUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {currentScholar.profileUrl.includes("openalex.org")
                        ? "OpenAlex 档案 ↗"
                        : "官方个人主页 ↗"}
                    </a>
                  )}
                  {currentScholar.orcid && (
                    <a
                      href={currentScholar.orcid}
                      target="_blank"
                      rel="noreferrer"
                    >
                      ORCID ↗
                    </a>
                  )}
                </nav>
              </div>
            </section>
          )}

          {error && <div className="error-banner">{error}</div>}
          {feed?.warnings?.map((warning) => (
            <div className="error-banner" key={warning}>{warning}</div>
          ))}

          {loading && !feed ? (
            <div className="loading-list" aria-label="正在加载">
              {[0, 1, 2].map((item) => (
                <div className="loading-card" key={item}>
                  <span /><span /><span />
                </div>
              ))}
            </div>
          ) : isScholarOverview ? (
            subscriptions.scholar.length === 0 ? (
              <div className="empty-state scholar-empty">
                <span>◉</span>
                <h2>从关注第一位学者开始</h2>
                <p>
                  添加学者后，首页会按最近发表时间排列学者卡片，并展示每人的最新动态与历史发表。
                </p>
                <button
                  onClick={() => {
                    setAddKind("scholar");
                    setAddOpen(true);
                  }}
                >
                  搜索并添加学者
                </button>
              </div>
            ) : scholarCards.length === 0 ? (
              <div className="empty-state">
                <span>⌕</span>
                <h2>没有找到匹配的学者或成果</h2>
                <p>清空顶部搜索框后再试。</p>
              </div>
            ) : (
              <div className="scholar-card-grid">
                {scholarCards.map(({ scholar, articles, latest }) => {
                  const matchedKeywordGroups = latest
                    ? latest.matches.filter(
                        (match) => match.kind === "keyword",
                      )
                    : [];
                  const keywordMatches = matchedKeywordGroups.flatMap(
                    (match) => match.terms || [match.label],
                  );
                  return (
                    <article
                      className="scholar-card"
                      key={scholar.label}
                      role="button"
                      tabIndex={0}
                      aria-label={`查看 ${scholar.label} 的全部发表`}
                      onClick={() => void openScholar(scholar.label)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          void openScholar(scholar.label);
                        }
                      }}
                    >
                      <header>
                        <span className="scholar-card-monogram" aria-hidden="true">
                          {scholar.label
                            .split(/\s+/)
                            .map((part) => part[0])
                            .slice(0, 2)
                            .join("")}
                        </span>
                        <div>
                          <h2>{scholar.label}</h2>
                          <p>{scholar.institution || "单位待确认"}</p>
                        </div>
                        {latest && (
                          <time dateTime={latest.publishedAt}>
                            {relativeDate(latest.publishedAt)}
                          </time>
                        )}
                      </header>

                      {scholar.researchAreas?.length ? (
                        <p className="scholar-card-areas">
                          {scholar.researchAreas.slice(0, 3).join(" · ")}
                        </p>
                      ) : null}

                      {latest ? (
                        <section className="scholar-latest">
                          <small>最新发表</small>
                          <h3>
                            <HighlightedText
                              text={latest.title}
                              keywords={keywordMatches}
                            />
                          </h3>
                          <p className="scholar-latest-meta">
                            {latest.venue} · {formatDate(latest.publishedAt)}
                          </p>
                          <p className="scholar-latest-abstract">
                            {latest.abstract
                              ? (
                                  <HighlightedText
                                    text={latest.abstract}
                                    keywords={keywordMatches}
                                  />
                                )
                              : "公开索引暂未收录摘要，可进入学者详情查看原文。"}
                          </p>
                          {matchedKeywordGroups.length > 0 && (
                            <div className="scholar-keyword-hits">
                              {matchedKeywordGroups.map((match) => (
                                <span key={match.label}>#{match.label}</span>
                              ))}
                            </div>
                          )}
                        </section>
                      ) : (
                        <section className="scholar-latest no-publication">
                          <small>尚未读取到发表记录</small>
                          <p>点击进入详情页后，可重新检查该学者的公开索引。</p>
                        </section>
                      )}

                      <section className="scholar-history">
                        <div>
                          <small>历史发表</small>
                          <span>{articles.length} 条已读取</span>
                        </div>
                        {articles.slice(1, 4).length > 0 ? (
                          <ol>
                            {articles.slice(1, 4).map((article) => (
                              <li key={article.id}>
                                <span>{article.title}</span>
                                <time>{formatDate(article.publishedAt)}</time>
                              </li>
                            ))}
                          </ol>
                        ) : (
                          <p>更多历史成果将在进入详情时载入。</p>
                        )}
                      </section>

                      <footer>
                        查看全部发表
                        <span aria-hidden="true">→</span>
                      </footer>
                    </article>
                  );
                })}
              </div>
            )
          ) : visibleItems.length === 0 ? (
            <div className="empty-state">
              <span>⌕</span>
              <h2>没有找到匹配内容</h2>
              <p>换一个筛选条件或搜索词试试。</p>
            </div>
          ) : (
            <div className="article-list">
              {visibleItems.map((article) => {
                const state = states[article.id] || defaultArticleState();
                const isExpanded = expanded[article.id];
                const keywordMatches = article.matches
                  .filter((match) => match.kind === "keyword")
                  .flatMap((match) => match.terms || [match.label]);
                return (
                  <article
                    className={`article-card ${state.read ? "is-read" : ""}`}
                    key={article.id}
                  >
                    <div className="article-meta">
                      <span className="venue">{article.venue}</span>
                      <span>·</span>
                      <time>{relativeDate(article.publishedAt)}</time>
                      <span className="type-pill">{article.type}</span>
                    </div>

                    <h2>
                      <a
                        href={article.url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={() => updateArticle(article.id, { read: true })}
                      >
                        <HighlightedText
                          text={article.title}
                          keywords={keywordMatches}
                        />
                      </a>
                    </h2>

                    <p className="authors">
                      {article.authors.length
                        ? article.authors.slice(0, 8).join(", ")
                        : "作者信息暂缺"}
                    </p>

                    <div className="match-row">
                      <span>收录原因</span>
                      {article.matches.map((match) => (
                        <button
                          key={`${match.kind}-${match.label}`}
                          className={`match-chip ${match.kind}`}
                          title={`${kindLabel(match.kind)}匹配`}
                        >
                          {match.kind === "keyword" ? "#" : ""}
                          {match.label}
                        </button>
                      ))}
                    </div>

                    <div className="abstract-block">
                      <div className="abstract-heading">
                        <strong>摘要</strong>
                        {article.abstract && (
                          <button
                            className="inline-translate"
                            onClick={() => void translateAbstract(article)}
                            disabled={translating === article.id}
                          >
                            {translating === article.id
                              ? "翻译中…"
                              : "一键翻译中文"}
                          </button>
                        )}
                      </div>
                      {article.abstract ? (
                        <>
                        <p className={isExpanded ? "" : "clamp"}>
                          <HighlightedText
                            text={article.abstract}
                            keywords={keywordMatches}
                          />
                        </p>
                        <button
                          onClick={() =>
                            setExpanded((current) => ({
                              ...current,
                              [article.id]: !current[article.id],
                            }))
                          }
                        >
                          {isExpanded ? "收起原摘要" : "展开原摘要"}
                        </button>
                        </>
                      ) : (
                        <p className="abstract-missing">
                          公开索引暂未收录摘要，请点击“阅读原文”查看出版商页面。
                        </p>
                      )}
                    </div>

                    {article.keywords?.length ? (
                      <div className="source-keywords">
                        <span>文献关键词</span>
                        <div>
                          {article.keywords.slice(0, 10).map((keyword) => {
                            const matched = keywordMatches.some((followed) =>
                              matchesKeyword(keyword, followed),
                            );
                            return (
                              <em
                                className={matched ? "matched" : ""}
                                key={keyword}
                              >
                                <HighlightedText
                                  text={keyword}
                                  keywords={keywordMatches}
                                />
                              </em>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}

                    {translations[article.id] && (
                      <div className="guide-block">
                        <div className="guide-label">
                          <span aria-hidden="true">译</span>
                          <strong>中文摘要</strong>
                          <em>机器翻译</em>
                        </div>
                        <p>{translations[article.id]}</p>
                      </div>
                    )}

                    <footer className="article-actions">
                      <button
                        className={state.saved ? "selected" : ""}
                        onClick={() =>
                          updateArticle(article.id, { saved: !state.saved })
                        }
                      >
                        {state.saved ? "♥ 已收藏" : "♡ 收藏"}
                      </button>
                      <button
                        onClick={() =>
                          updateArticle(article.id, { read: !state.read })
                        }
                      >
                        {state.read ? "标为未读" : "✓ 标为已读"}
                      </button>
                      <button
                        onClick={() =>
                          updateArticle(article.id, { ignored: true })
                        }
                      >
                        × 忽略
                      </button>
                      <a
                        href={article.url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={() => updateArticle(article.id, { read: true })}
                      >
                        阅读原文 →
                      </a>
                    </footer>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <aside className="right-rail">
          <section className="signal-card">
            <div className="section-heading">
              <span>当前信号</span>
              <small>本次检索</small>
            </div>
            <div className="signal-stat">
              <strong>{feed?.items.length || 0}</strong>
              <span>条出版记录</span>
            </div>
            <div className="mini-bars" aria-label="更新信号">
              {[32, 48, 26, 61, 44, 79, 55].map((height, index) => (
                <i key={index} style={{ height: `${height}%` }} />
              ))}
            </div>
            <div className="signal-legend">
              <span><i className="journal" /> 期刊</span>
              <span><i className="scholar" /> 学者</span>
              <span><i className="keyword" /> 关键词</span>
            </div>
          </section>

          <blockquote>
            “The purpose of anthropology is to make the world safe for human
            differences.”
            <cite>— Ruth Benedict</cite>
          </blockquote>
        </aside>
      </div>

      {addOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setAddOpen(false)}>
          <section
            className="add-modal"
            role="dialog"
            aria-modal="true"
            aria-label="添加关注"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <p>添加关注</p>
                <h2>搜索期刊、学者或关键词</h2>
              </div>
              <button aria-label="关闭" onClick={() => setAddOpen(false)}>×</button>
            </header>
            <div className="add-tabs">
              {(["scholar", "journal", "keyword"] as MatchKind[]).map((kind) => (
                <button
                  key={kind}
                  className={addKind === kind ? "active" : ""}
                  onClick={() => {
                    setAddKind(kind);
                    setAddQuery("");
                    setSearchResults([]);
                  }}
                >
                  {kindLabel(kind)}
                </button>
              ))}
            </div>
            <label className="add-search">
              <span>⌕</span>
              <input
                autoFocus
                value={addQuery}
                onChange={(event) => setAddQuery(event.target.value)}
                placeholder={
                  addKind === "journal"
                    ? "输入期刊名，例如 Medical Anthropology"
                    : addKind === "scholar"
                      ? "输入学者姓名"
                      : "输入需要重点标注的关键词"
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter" && addKind === "keyword") {
                    addSubscription();
                  }
                }}
              />
            </label>

            {addKind === "keyword" ? (
              <div className="keyword-add">
                <p>
                  输入一个英文词后，会将同一词根的常见变体作为一个完整关注项；匹配范围包括标题、摘要和文献关键词。
                </p>
                {keywordSuggestion ? (
                  <button
                    className="keyword-family-result"
                    onClick={() => addSubscription()}
                  >
                    <span>
                      <small>词根与变体</small>
                      <strong>{keywordGroupLabel(keywordSuggestion)}</strong>
                      <em>核心词根：{keywordSuggestion.root}</em>
                    </span>
                    <b>添加整组</b>
                  </button>
                ) : (
                  <p className="search-hint">输入关键词后，这里会显示完整词族。</p>
                )}
              </div>
            ) : (
              <div className="search-results">
                {visibleSearching && <p className="search-hint">正在搜索公开学术索引…</p>}
                {!visibleSearching && addQuery.trim().length < 2 && (
                  <p className="search-hint">输入至少两个字符开始搜索。</p>
                )}
                {!visibleSearching &&
                  addQuery.trim().length >= 2 &&
                  visibleSearchResults.length === 0 && (
                    <p className="search-hint">没有找到结果，请换一种写法。</p>
                  )}
                {visibleSearchResults.map((result) => (
                  <button
                    className="search-result"
                    key={`${result.label}-${result.value}`}
                    onClick={() => addSubscription(result)}
                  >
                    <span>
                      <strong>{result.label}</strong>
                      <small>{result.detail || result.value}</small>
                      {addKind === "scholar" && result.researchAreas?.length ? (
                        <small className="research-preview">
                          研究方向：{result.researchAreas.join("、")}
                        </small>
                      ) : null}
                    </span>
                    <em>添加</em>
                  </button>
                ))}
              </div>
            )}
            <footer>
              配置会写入解压文件夹中的 data 文件；不要把自己的使用中副本发给别人。
            </footer>
          </section>
        </div>
      )}

      {notice && <div className="toast">{notice}</div>}
    </main>
  );
}

function SubscriptionGroup({
  title,
  items,
  kind,
  activeLabel,
  onSelect,
  onRemove,
}: {
  title: string;
  items: string[];
  kind: MatchKind;
  activeLabel?: string;
  onSelect: (label: string) => void;
  onRemove: (label: string) => void;
}) {
  return (
    <details open className="subscription-group">
      <summary>
        <span><i className={kind} />{title}</span>
        <em>{items.length}</em>
      </summary>
      <ul>
        {items.map((item) => (
          <li key={item}>
            <button
              className={`subscription-name ${activeLabel === item ? "active" : ""}`}
              onClick={() => onSelect(item)}
              title={`只看 ${item}`}
            >
              {item}
            </button>
            <button
              className="subscription-remove"
              aria-label={`移除 ${item}`}
              title="移除"
              onClick={() => onRemove(item)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
