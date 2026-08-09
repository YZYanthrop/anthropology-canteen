"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type MatchKind = "journal" | "scholar" | "keyword";
type Match = { kind: MatchKind; label: string; terms?: string[] };
type Journal = { label: string; issn: string; followedAt?: string };
type KeywordGroup = {
  root: string;
  variants: string[];
};
type Scholar = {
  subscriptionId: string;
  label: string;
  aliases?: string[];
  openAlexIds: string[];
  semanticScholarIds?: string[];
  quarantinedOpenAlexIds?: string[];
  quarantinedSemanticScholarIds?: string[];
  identityNeedsReview?: boolean;
  institution: string;
  institutions?: string[];
  profileUrl?: string;
  profileUrls?: string[];
  institutionalProfileUrl?: string;
  institutionalProfileVerifiedAt?: string;
  institutionalEvidence?: string[];
  orcid?: string;
  worksCount?: number;
  researchAreas?: string[];
  verifiedWorkDois?: string[];
  sources?: string[];
  trackingStatus?: "verified" | "limited";
  followedAt?: string;
  identityCheckedAt?: string;
  mergedRecordCount?: number;
  mergeConfidence?: "verified" | "high" | "unconfirmed";
  mergeEvidence?: string[];
};
type Subscriptions = {
  journal: Journal[];
  scholar: Scholar[];
  keyword: KeywordGroup[];
};
type ScholarWork = {
  id: string;
  doi?: string;
  title: string;
  year?: number;
  venue?: string;
  url?: string;
  abstract?: string;
  familyIds?: string[];
};
type SearchResult = {
  candidateId?: string;
  label: string;
  value: string;
  detail?: string;
  institution?: string;
  institutions?: string[];
  aliases?: string[];
  profileUrl?: string;
  profileUrls?: string[];
  institutionalProfileUrl?: string;
  institutionalProfileVerifiedAt?: string;
  institutionalEvidence?: string[];
  orcid?: string;
  worksCount?: number;
  researchAreas?: string[];
  representativeWorks?: ScholarWork[];
  verifiedWorkDois?: string[];
  externalIds?: {
    openAlex?: string;
    semanticScholar?: string;
    orcid?: string;
  };
  openAlexIds?: string[];
  semanticScholarIds?: string[];
  sources?: string[];
  identityWarnings?: string[];
  scoreReasons?: string[];
  trackingStatus?: "verified" | "limited";
  mergedRecordCount?: number;
  mergeConfidence?: "verified" | "high" | "unconfirmed";
  mergeEvidence?: string[];
};

type ArticleAuthor = {
  name: string;
  openAlexId?: string;
  semanticScholarId?: string;
  orcid?: string;
};
type Article = {
  id: string;
  doi?: string;
  title: string;
  authors: ArticleAuthor[];
  venue: string;
  publisher?: string;
  publishedAt: string;
  type: string;
  url: string;
  abstract?: string;
  keywords?: string[];
  matches: Match[];
};

type ScholarProfile = {
  candidate: SearchResult;
  works: ScholarWork[];
};

type CachedScholarProfile = ScholarProfile & {
  updatedAt: string;
  complete: boolean;
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
type SubscriptionSelection = {
  kind: MatchKind;
  label: string;
  id?: string;
} | null;
type LocalData = {
  subscriptions: Subscriptions;
  states: Record<string, ArticleState>;
  feed: FeedResponse | null;
  translations: Record<string, string>;
  scholarProfiles: Record<string, CachedScholarProfile>;
};

type LocalSettingsStatus = {
  openAlexConfigured: boolean;
  openAlexKeyHint?: string;
  semanticScholarConfigured?: boolean;
  semanticScholarKeyHint?: string;
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

function safeTimestamp(value: unknown, fallback = new Date().toISOString()) {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? value
    : fallback;
}

function kindLabel(kind: MatchKind) {
  return kind === "journal" ? "期刊" : kind === "scholar" ? "学者" : "关键词";
}

function defaultArticleState(): ArticleState {
  return { saved: false, read: false, ignored: false };
}

function articlePublishedSinceFollow(
  article: Article,
  subscriptions: Subscriptions,
) {
  const publicationDate = article.publishedAt.slice(0, 10);
  return article.matches.some((match) => {
    if (match.kind === "scholar") {
      const scholar = subscriptions.scholar.find(
        (item) => item.label.toLowerCase() === match.label.toLowerCase(),
      );
      return scholar
        ? publicationDate >= safeTimestamp(scholar.followedAt).slice(0, 10)
        : false;
    }
    if (match.kind === "journal") {
      const journal = subscriptions.journal.find(
        (item) => item.label.toLowerCase() === match.label.toLowerCase(),
      );
      return journal
        ? publicationDate >= safeTimestamp(journal.followedAt).slice(0, 10)
        : false;
    }
    return false;
  });
}

function defaultLocalData(): LocalData {
  return {
    subscriptions: DEFAULT_SUBSCRIPTIONS,
    states: {},
    feed: null,
    translations: {},
    scholarProfiles: {},
  };
}

function cleanExternalId(value: unknown, prefix?: RegExp) {
  if (typeof value !== "string") return "";
  const id = value.trim().split("/").filter(Boolean).at(-1) || "";
  return !prefix || prefix.test(id) ? id : "";
}

function cleanOrcid(value: unknown) {
  if (typeof value !== "string") return "";
  const id = value
    .trim()
    .replace(/^https?:\/\/orcid\.org\//i, "")
    .toUpperCase();
  return /^\d{4}-\d{4}-\d{4}-[\dX]{4}$/.test(id) ? id : "";
}

function normalizeScholarName(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .toLowerCase();
}

function formatScholarDisplayName(value: string) {
  const source = value.replace(/\s+/g, " ").trim();
  if (!source || /\p{Script=Han}/u.test(source)) return source;
  const letters = source.replace(/[^A-Za-z]/g, "");
  if (
    letters &&
    letters !== letters.toLowerCase() &&
    letters !== letters.toUpperCase()
  ) {
    return source;
  }
  return source
    .toLowerCase()
    .replace(/(^|[\s\-‐‑‒–—'’])([a-z])/g, (_match, separator, letter) =>
      `${separator}${letter.toUpperCase()}`,
    )
    .replace(/\b([A-Z])\b(?!\.)/g, "$1.");
}

function scholarIdentityKey(value: Partial<Scholar> & Partial<SearchResult>) {
  const orcid = cleanOrcid(value.orcid || value.externalIds?.orcid);
  const openAlex =
    value.openAlexIds?.map((id) => cleanExternalId(id, /^A\d+$/)).find(Boolean) ||
    cleanExternalId(value.externalIds?.openAlex, /^A\d+$/) ||
    "";
  const semantic =
    value.semanticScholarIds?.find(Boolean) ||
    value.externalIds?.semanticScholar ||
    "";
  return (
    value.subscriptionId ||
    value.candidateId ||
    (orcid && `orcid:${orcid}`) ||
    (openAlex && `openalex:${openAlex}`) ||
    (semantic && `semantic:${semantic}`) ||
    `limited:${(value.label || "").toLowerCase()}:${(
      value.institution || ""
    ).toLowerCase()}`
  );
}

function safeArticleAuthor(value: unknown): ArticleAuthor | null {
  const candidate =
    typeof value === "string"
      ? { name: value }
      : value && typeof value === "object"
        ? (value as Partial<ArticleAuthor>)
        : null;
  if (!candidate || typeof candidate.name !== "string") return null;
  const name = candidate.name.trim();
  if (!name) return null;
  return {
    name,
    openAlexId: cleanExternalId(candidate.openAlexId, /^A\d+$/) || undefined,
    semanticScholarId:
      typeof candidate.semanticScholarId === "string"
        ? candidate.semanticScholarId.trim() || undefined
        : undefined,
    orcid: cleanOrcid(candidate.orcid) || undefined,
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
    journal: candidate.journal.flatMap((item): Journal[] =>
      item &&
      typeof item.label === "string" &&
      typeof item.issn === "string"
        ? [{
            label: item.label,
            issn: item.issn,
            followedAt: safeTimestamp(
              (item as Partial<Journal>).followedAt,
            ),
          }]
        : [],
    ),
    scholar: candidate.scholar
      .flatMap((item): Scholar[] => {
        if (typeof item === "string") {
          const label = formatScholarDisplayName(item);
          return [{
            subscriptionId: `legacy:${label.toLowerCase()}`,
            label,
            aliases: [],
            openAlexIds: [],
            semanticScholarIds: [],
            institution: "单位待确认",
            institutions: [],
            trackingStatus: "limited" as const,
            followedAt: new Date().toISOString(),
          }];
        }
        if (
          item &&
          typeof item === "object" &&
          typeof (item as Scholar).label === "string"
        ) {
          const scholar = item as Scholar;
          const label = formatScholarDisplayName(scholar.label);
          const openAlexIds = Array.isArray(scholar.openAlexIds)
            ? scholar.openAlexIds
                .map((id) => cleanExternalId(id, /^A\d+$/))
                .filter(Boolean)
            : [];
          const semanticScholarIds = Array.isArray(
            scholar.semanticScholarIds,
          )
            ? scholar.semanticScholarIds
                .filter((id): id is string => typeof id === "string")
                .map((id) => id.trim())
                .filter(Boolean)
            : [];
          const orcid = cleanOrcid(scholar.orcid) || undefined;
          const institutions = Array.isArray(scholar.institutions)
            ? scholar.institutions.filter(
                (item): item is string => typeof item === "string",
              )
            : [];
          const institution =
            scholar.institution || institutions[0] || "单位待确认";
          return [{
            subscriptionId:
              scholar.subscriptionId ||
              (orcid && `orcid:${orcid}`) ||
              (openAlexIds[0] && `openalex:${openAlexIds[0]}`) ||
              (semanticScholarIds[0] &&
                `semantic:${semanticScholarIds[0]}`) ||
              `legacy:${label.toLowerCase()}:${institution.toLowerCase()}`,
            label,
            aliases: Array.isArray(scholar.aliases)
              ? scholar.aliases.filter(
                  (item): item is string => typeof item === "string",
                )
              : [],
            openAlexIds,
            semanticScholarIds,
            quarantinedOpenAlexIds: Array.isArray(
              scholar.quarantinedOpenAlexIds,
            )
              ? scholar.quarantinedOpenAlexIds.filter(
                  (id): id is string => typeof id === "string",
                )
              : [],
            quarantinedSemanticScholarIds: Array.isArray(
              scholar.quarantinedSemanticScholarIds,
            )
              ? scholar.quarantinedSemanticScholarIds.filter(
                  (id): id is string => typeof id === "string",
                )
              : [],
            identityNeedsReview: Boolean(scholar.identityNeedsReview),
            institution,
            institutions: [
              ...new Set([institution, ...institutions].filter(Boolean)),
            ],
            profileUrl: scholar.profileUrl,
            profileUrls: Array.isArray(scholar.profileUrls)
              ? scholar.profileUrls.filter(
                  (item): item is string => typeof item === "string",
                )
              : undefined,
            institutionalProfileUrl:
              typeof scholar.institutionalProfileUrl === "string"
                ? scholar.institutionalProfileUrl
                : undefined,
            institutionalProfileVerifiedAt:
              typeof scholar.institutionalProfileVerifiedAt === "string" &&
              Number.isFinite(
                Date.parse(scholar.institutionalProfileVerifiedAt),
              )
                ? scholar.institutionalProfileVerifiedAt
                : undefined,
            institutionalEvidence: Array.isArray(
              scholar.institutionalEvidence,
            )
              ? scholar.institutionalEvidence.filter(
                  (item): item is string => typeof item === "string",
                )
              : [],
            orcid,
            worksCount: scholar.worksCount,
            researchAreas: Array.isArray(scholar.researchAreas)
              ? scholar.researchAreas.filter(
                  (item): item is string => typeof item === "string",
                )
              : undefined,
            verifiedWorkDois: Array.isArray(scholar.verifiedWorkDois)
              ? scholar.verifiedWorkDois.filter(
                  (item): item is string => typeof item === "string",
                )
              : undefined,
            sources: Array.isArray(scholar.sources)
              ? scholar.sources.filter(
                  (item): item is string => typeof item === "string",
                )
              : undefined,
            trackingStatus:
              openAlexIds.length || semanticScholarIds.length || orcid
                ? ("verified" as const)
                : ("limited" as const),
            followedAt: safeTimestamp(scholar.followedAt),
            identityCheckedAt:
              typeof scholar.identityCheckedAt === "string" &&
              Number.isFinite(Date.parse(scholar.identityCheckedAt))
                ? scholar.identityCheckedAt
                : undefined,
            mergedRecordCount:
              typeof scholar.mergedRecordCount === "number"
                ? Math.max(1, Math.floor(scholar.mergedRecordCount))
                : 1,
            mergeConfidence:
              scholar.mergeConfidence === "verified" ||
              scholar.mergeConfidence === "high" ||
              scholar.mergeConfidence === "unconfirmed"
                ? scholar.mergeConfidence
                : orcid
                  ? "verified"
                  : openAlexIds.length || semanticScholarIds.length
                    ? "high"
                    : "unconfirmed",
            mergeEvidence: Array.isArray(scholar.mergeEvidence)
              ? scholar.mergeEvidence.filter(
                  (item): item is string => typeof item === "string",
                )
              : [],
          }];
        }
        return [];
      }),
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
    items: feed.items
      .filter(
        (item): item is Article =>
          Boolean(
            item &&
              typeof item === "object" &&
              typeof (item as Article).id === "string" &&
              typeof (item as Article).title === "string" &&
              Array.isArray((item as Article).matches),
          ),
      )
      .map((article) => ({
        ...article,
        authors: Array.isArray(article.authors)
          ? article.authors
              .map(safeArticleAuthor)
              .filter((item): item is ArticleAuthor => Boolean(item))
          : [],
      })),
    updatedAt:
      typeof feed.updatedAt === "string"
        ? feed.updatedAt
        : new Date().toISOString(),
    source: feed.source === "fallback" ? "fallback" : "live",
    historyScholar:
      typeof feed.historyScholar === "string" ? feed.historyScholar : undefined,
    scholars: Array.isArray(feed.scholars)
      ? safeSubscriptions({
          journal: [],
          scholar: feed.scholars,
          keyword: [],
        }).scholar
      : [],
    warnings: Array.isArray(feed.warnings)
      ? feed.warnings.filter((item): item is string => typeof item === "string")
      : [],
  };
}

function safeScholarWork(value: unknown): ScholarWork | null {
  if (!value || typeof value !== "object") return null;
  const work = value as Partial<ScholarWork>;
  if (typeof work.title !== "string" || !work.title.trim()) return null;
  return {
    id:
      typeof work.id === "string" && work.id.trim()
        ? work.id
        : work.title.toLowerCase(),
    doi: typeof work.doi === "string" ? work.doi : undefined,
    title: work.title,
    year:
      typeof work.year === "number" && Number.isFinite(work.year)
        ? work.year
        : undefined,
    venue: typeof work.venue === "string" ? work.venue : undefined,
    url: typeof work.url === "string" ? work.url : undefined,
    abstract:
      typeof work.abstract === "string" ? work.abstract : undefined,
    familyIds: Array.isArray(work.familyIds)
      ? work.familyIds.filter(
          (item): item is string => typeof item === "string",
        )
      : undefined,
  };
}

function safeScholarProfiles(
  value: unknown,
): Record<string, CachedScholarProfile> {
  if (!value || typeof value !== "object") return {};
  const result: Record<string, CachedScholarProfile> = {};
  for (const [key, rawProfile] of Object.entries(value)) {
    if (!rawProfile || typeof rawProfile !== "object") continue;
    const profile = rawProfile as Partial<CachedScholarProfile>;
    const rawCandidate = profile.candidate;
    if (
      !rawCandidate ||
      typeof rawCandidate !== "object" ||
      typeof rawCandidate.label !== "string"
    ) {
      continue;
    }
    const savedScholar = safeSubscriptions({
      journal: [],
      scholar: [rawCandidate],
      keyword: [],
    }).scholar[0];
    if (!savedScholar) continue;
    const candidate: SearchResult = {
      ...rawCandidate,
      ...savedScholar,
      candidateId:
        typeof rawCandidate.candidateId === "string"
          ? rawCandidate.candidateId
          : savedScholar.subscriptionId,
      value:
        typeof rawCandidate.value === "string"
          ? rawCandidate.value
          : savedScholar.subscriptionId,
      representativeWorks: Array.isArray(rawCandidate.representativeWorks)
        ? rawCandidate.representativeWorks
            .map(safeScholarWork)
            .filter((item): item is ScholarWork => Boolean(item))
        : [],
      identityWarnings: Array.isArray(rawCandidate.identityWarnings)
        ? rawCandidate.identityWarnings.filter(
            (item): item is string => typeof item === "string",
          )
        : [],
      scoreReasons: Array.isArray(rawCandidate.scoreReasons)
        ? rawCandidate.scoreReasons.filter(
            (item): item is string => typeof item === "string",
          )
        : [],
    };
    const works = Array.isArray(profile.works)
      ? profile.works
          .map(safeScholarWork)
          .filter((item): item is ScholarWork => Boolean(item))
      : candidate.representativeWorks || [];
    result[key] = {
      candidate,
      works,
      updatedAt: safeTimestamp(profile.updatedAt),
      complete: Boolean(profile.complete),
    };
  }
  return result;
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
    scholarProfiles: safeScholarProfiles(data.scholarProfiles),
  };
}

function hasStoredLocalData(data: LocalData) {
  return (
    data.subscriptions.journal.length > 0 ||
    data.subscriptions.scholar.length > 0 ||
    data.subscriptions.keyword.length > 0 ||
    Object.keys(data.states).length > 0 ||
    Object.keys(data.translations).length > 0 ||
    Object.keys(data.scholarProfiles).length > 0 ||
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
  const [addKind, setAddKind] = useState<MatchKind>("scholar");
  const [addQuery, setAddQuery] = useState("");
  const [scholarSearchMode, setScholarSearchMode] =
    useState<"name" | "work">("name");
  const [scholarInstitution, setScholarInstitution] = useState("");
  const [scholarTopic, setScholarTopic] = useState("");
  const [scholarHomepage, setScholarHomepage] = useState("");
  const [manualScholarName, setManualScholarName] = useState("");
  const [authorContextName, setAuthorContextName] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchWarnings, setSearchWarnings] = useState<string[]>([]);
  const [queryVariants, setQueryVariants] = useState<string[]>([]);
  const [localSettings, setLocalSettings] = useState<LocalSettingsStatus>({
    openAlexConfigured: false,
  });
  const [apiSettingsOpen, setApiSettingsOpen] = useState(false);
  const [openAlexApiKeyInput, setOpenAlexApiKeyInput] = useState("");
  const [semanticScholarApiKeyInput, setSemanticScholarApiKeyInput] =
    useState("");
  const [apiSettingsSaving, setApiSettingsSaving] = useState(false);
  const [profile, setProfile] = useState<ScholarProfile | null>(null);
  const [scholarProfiles, setScholarProfiles] = useState<
    Record<string, CachedScholarProfile>
  >({});
  const [profileLoading, setProfileLoading] = useState(false);
  const localDataRef = useRef<LocalData>(defaultLocalData());
  const saveQueueRef = useRef(Promise.resolve());
  const searchAbortRef = useRef<AbortController | null>(null);
  const searchRequestRef = useRef(0);
  const keywordSuggestion = useMemo(
    () => (addKind === "keyword" ? createKeywordGroup(addQuery) : null),
    [addKind, addQuery],
  );
  const searchActive =
    addOpen && addKind !== "keyword" && addQuery.trim().length >= 2;
  const visibleSearching = searchActive && searching;
  const visibleSearchResults = searchActive
    ? authorContextName
      ? [
          ...searchResults.filter(
            (item) =>
              normalizeScholarName(item.label) ===
              normalizeScholarName(authorContextName),
          ),
          ...searchResults.filter(
            (item) =>
              normalizeScholarName(item.label) !==
              normalizeScholarName(authorContextName),
          ),
        ]
      : searchResults
    : [];

  function applyLocalData(data: LocalData) {
    localDataRef.current = data;
    setSubscriptions(data.subscriptions);
    setStates(data.states);
    setTranslations(data.translations);
    setFeed(data.feed);
    setScholarProfiles(data.scholarProfiles);
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
        const cachedAt = Date.parse(data.feed?.updatedAt || "");
        if (
          data.feed &&
          !data.feed.historyScholar &&
          Number.isFinite(cachedAt) &&
          Date.now() - cachedAt < 6 * 60 * 60 * 1000
        ) {
          setLoading(false);
          return;
        }
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
    async function loadLocalSettings() {
      try {
        const response = await fetch("/api/local-settings", {
          cache: "no-store",
        });
        if (!response.ok) return;
        const settings = (await response.json()) as LocalSettingsStatus;
        if (!cancelled) setLocalSettings(settings);
      } catch {
        // Hosted previews do not expose portable local settings.
      }
    }
    void loadLocalSettings();
    return () => {
      cancelled = true;
    };
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
    const requestId = searchRequestRef.current + 1;
    searchRequestRef.current = requestId;
    searchAbortRef.current?.abort();
    if (!searchActive) return;
    const controller = new AbortController();
    searchAbortRef.current = controller;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const params = new URLSearchParams({
          kind: addKind,
          q: addQuery.trim(),
        });
        if (addKind === "scholar") {
          params.set("mode", scholarSearchMode);
          if (scholarInstitution.trim()) {
            params.set("institution", scholarInstitution.trim());
          }
          if (scholarTopic.trim()) params.set("topic", scholarTopic.trim());
          if (scholarHomepage.trim()) {
            params.set("homepage", scholarHomepage.trim());
          }
        }
        const response = await fetch(
          `/api/search?${params.toString()}`,
          { cache: "no-store", signal: controller.signal },
        );
        const data = (await response.json()) as {
          results?: SearchResult[];
          warnings?: string[];
          queryVariants?: string[];
          openAlexConfigured?: boolean;
          semanticScholarConfigured?: boolean;
        };
        if (searchRequestRef.current === requestId) {
          setSearchResults(data.results || []);
          setSearchWarnings(data.warnings || []);
          setQueryVariants(data.queryVariants || []);
          if (typeof data.openAlexConfigured === "boolean") {
            setLocalSettings((current) => ({
              ...current,
              openAlexConfigured: data.openAlexConfigured,
            }));
          }
          if (typeof data.semanticScholarConfigured === "boolean") {
            setLocalSettings((current) => ({
              ...current,
              semanticScholarConfigured:
                data.semanticScholarConfigured,
            }));
          }
        }
      } catch (error) {
        if (
          !(error instanceof DOMException && error.name === "AbortError") &&
          searchRequestRef.current === requestId
        ) {
          setSearchResults([]);
          setSearchWarnings(["暂时无法连接公开学术索引。"]);
          setQueryVariants([]);
        }
      } finally {
        if (searchRequestRef.current === requestId) setSearching(false);
      }
    }, 650);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    addKind,
    addQuery,
    scholarInstitution,
    scholarSearchMode,
    scholarHomepage,
    scholarTopic,
    localSettings.openAlexConfigured,
    localSettings.semanticScholarConfigured,
    searchActive,
  ]);

  async function saveApiKey(
    provider: "openAlex" | "semanticScholar",
    remove = false,
  ) {
    const providerLabel =
      provider === "openAlex" ? "OpenAlex" : "Semantic Scholar";
    const input =
      provider === "openAlex"
        ? openAlexApiKeyInput
        : semanticScholarApiKeyInput;
    const key = remove ? "" : input.trim();
    if (!remove && key.length < 8) {
      showNotice(`请输入完整的 ${providerLabel} API Key`);
      return;
    }
    setApiSettingsSaving(true);
    try {
      const response = await fetch("/api/local-settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ [`${provider}ApiKey`]: key }),
      });
      if (!response.ok) throw new Error("settings unavailable");
      const settings = (await response.json()) as LocalSettingsStatus;
      setLocalSettings(settings);
      if (provider === "openAlex") setOpenAlexApiKeyInput("");
      else setSemanticScholarApiKeyInput("");
      setSearchResults([]);
      setSearchWarnings([]);
      showNotice(
        remove
          ? `已移除 ${providerLabel} API Key`
          : `${providerLabel} API Key 已保存在本地文件夹`,
      );
    } catch {
      showNotice("API Key 保存失败，请确认程序文件夹可写");
    } finally {
      setApiSettingsSaving(false);
    }
  }

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
      const resolvedSubscriptions = Array.isArray(data.scholars)
        ? {
            ...sourceSubscriptions,
            scholar: safeSubscriptions({
              journal: [],
              scholar: data.scholars,
              keyword: [],
            }).scholar,
          }
        : sourceSubscriptions;
      setFeed(data);
      setSubscriptions(resolvedSubscriptions);
      void persistLocalData({
        feed: data,
        subscriptions: resolvedSubscriptions,
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

  function cachedProfileMatches(
    candidate: SearchResult,
    query: SearchResult | Scholar,
  ) {
    const candidateOrcid = cleanOrcid(candidate.orcid);
    const queryOrcid = cleanOrcid(query.orcid);
    if (candidateOrcid && queryOrcid && candidateOrcid !== queryOrcid) {
      return false;
    }
    if (candidateOrcid && candidateOrcid === queryOrcid) return true;
    if (
      (candidate.openAlexIds || []).some((id) =>
        (query.openAlexIds || []).includes(id),
      )
    ) {
      return true;
    }
    if (
      (candidate.semanticScholarIds || []).some((id) =>
        (query.semanticScholarIds || []).includes(id),
      )
    ) {
      return true;
    }
    if (
      candidate.candidateId &&
      "candidateId" in query &&
      candidate.candidateId === query.candidateId
    ) {
      return true;
    }
    return (
      normalizeScholarName(candidate.label) ===
        normalizeScholarName(query.label) &&
      Boolean(
        candidate.institutionalProfileUrl &&
          candidate.institutionalProfileUrl ===
            query.institutionalProfileUrl,
      )
    );
  }

  function findCachedProfile(result: SearchResult | Scholar) {
    return Object.values(localDataRef.current.scholarProfiles).find(
      (item) => cachedProfileMatches(item.candidate, result),
    );
  }

  function saveCachedProfile(
    candidate: SearchResult,
    works: ScholarWork[],
    updatedAt = new Date().toISOString(),
    complete = true,
  ) {
    const existing = findCachedProfile(candidate);
    const sourceWorks = complete
      ? works
      : [...works, ...(existing?.works || [])];
    const mergedWorks = sourceWorks.filter(
      (work, index, all) =>
        all.findIndex(
          (item) =>
            (work.doi && item.doi === work.doi) ||
            item.id === work.id ||
            (item.title.toLowerCase() === work.title.toLowerCase() &&
              item.year === work.year),
        ) === index,
    );
    const key = scholarIdentityKey(candidate);
    const retainedProfiles = Object.fromEntries(
      Object.entries(localDataRef.current.scholarProfiles).filter(
        ([storedKey, profile]) =>
          storedKey === key ||
          !cachedProfileMatches(profile.candidate, candidate),
      ),
    );
    const nextProfiles = {
      ...retainedProfiles,
      [key]: {
        candidate: {
          ...(existing?.candidate || {}),
          ...candidate,
          representativeWorks: mergedWorks.slice(0, 100),
        },
        works: mergedWorks.slice(0, 1000),
        updatedAt,
        complete,
      },
    };
    setScholarProfiles(nextProfiles);
    void persistLocalData({ scholarProfiles: nextProfiles }, true);
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

  function scholarFromResult(result: SearchResult): Scholar {
    const displayLabel = formatScholarDisplayName(result.label);
    const openAlexIds = [
      ...(result.openAlexIds || []),
      ...(result.externalIds?.openAlex
        ? [result.externalIds.openAlex]
        : []),
    ]
      .map((id) => cleanExternalId(id, /^A\d+$/))
      .filter((id, index, all) => Boolean(id) && all.indexOf(id) === index);
    const semanticScholarIds = [
      ...(result.semanticScholarIds || []),
      ...(result.externalIds?.semanticScholar
        ? [result.externalIds.semanticScholar]
        : []),
    ].filter((id, index, all) => Boolean(id) && all.indexOf(id) === index);
    const orcid =
      cleanOrcid(result.orcid || result.externalIds?.orcid) || undefined;
    const institutions = [
      ...(result.institutions || []),
      ...(result.institution ? [result.institution] : []),
    ].filter(
      (item, index, all) => Boolean(item) && all.indexOf(item) === index,
    );
    const subscriptionId =
      result.candidateId ||
      (orcid && `orcid:${orcid}`) ||
      (openAlexIds[0] && `openalex:${openAlexIds[0]}`) ||
      (semanticScholarIds[0] &&
        `semantic:${semanticScholarIds[0]}`) ||
      `limited:${displayLabel.toLowerCase()}:${
        (result.institution || "").toLowerCase()
      }`;
    return {
      subscriptionId,
      label: displayLabel,
      aliases: result.aliases || [],
      openAlexIds,
      semanticScholarIds,
      institution:
        result.institution || institutions[0] || "单位待确认",
      institutions,
      profileUrl: result.profileUrl || result.profileUrls?.[0],
      profileUrls: result.profileUrls,
      institutionalProfileUrl: result.institutionalProfileUrl,
      institutionalProfileVerifiedAt:
        result.institutionalProfileVerifiedAt,
      institutionalEvidence: result.institutionalEvidence || [],
      orcid,
      worksCount: result.worksCount,
      researchAreas: result.researchAreas,
      verifiedWorkDois: [
        ...(result.verifiedWorkDois || []),
        ...(result.representativeWorks || []).map((work) => work.doi || ""),
      ].filter(
        (doi, index, all) => Boolean(doi) && all.indexOf(doi) === index,
      ),
      sources: result.sources,
      trackingStatus:
        openAlexIds.length || semanticScholarIds.length || orcid
          ? "verified"
          : "limited",
      followedAt: new Date().toISOString(),
      identityCheckedAt: new Date().toISOString(),
      mergedRecordCount: result.mergedRecordCount || 1,
      mergeConfidence:
        result.mergeConfidence ||
        (orcid
          ? "verified"
          : openAlexIds.length || semanticScholarIds.length
            ? "high"
            : "unconfirmed"),
      mergeEvidence: result.mergeEvidence || [],
    };
  }

  function scholarRecordsMatch(
    result: SearchResult | Scholar,
    item: Scholar,
  ) {
    const resultOrcid = cleanOrcid(result.orcid);
    const resultOpenAlex = new Set(result.openAlexIds || []);
    const resultSemantic = new Set(result.semanticScholarIds || []);
    if (scholarIdentityKey(item) === scholarIdentityKey(result)) return true;
    if (resultOrcid && cleanOrcid(item.orcid) === resultOrcid) return true;
    if (item.openAlexIds.some((id) => resultOpenAlex.has(id))) return true;
    return (item.semanticScholarIds || []).some((id) =>
      resultSemantic.has(id),
    );
  }

  function isScholarFollowed(result: SearchResult | Scholar) {
    return subscriptions.scholar.some((item) =>
      scholarRecordsMatch(result, item),
    );
  }

  function persistEnrichedScholar(result: SearchResult) {
    const index = subscriptions.scholar.findIndex((item) =>
      scholarRecordsMatch(result, item),
    );
    if (index < 0) return;
    const current = subscriptions.scholar[index];
    const enriched = scholarFromResult(result);
    enriched.subscriptionId = current.subscriptionId;
    enriched.followedAt = current.followedAt;
    enriched.identityCheckedAt = new Date().toISOString();
    enriched.aliases = [...new Set([
      ...(current.aliases || []),
      current.label,
      ...(enriched.aliases || []),
    ])].filter(
      (label) =>
        normalizeScholarName(label) !==
        normalizeScholarName(enriched.label),
    );
    const confirmedOpenAlexIds = enriched.openAlexIds.length
      ? enriched.openAlexIds
      : current.openAlexIds;
    const confirmedSemanticIds = (enriched.semanticScholarIds || []).length
      ? enriched.semanticScholarIds || []
      : current.semanticScholarIds || [];
    enriched.quarantinedOpenAlexIds = [...new Set([
      ...(current.quarantinedOpenAlexIds || []),
      ...current.openAlexIds.filter(
        (id) => !confirmedOpenAlexIds.includes(id),
      ),
    ])];
    enriched.quarantinedSemanticScholarIds = [...new Set([
      ...(current.quarantinedSemanticScholarIds || []),
      ...(current.semanticScholarIds || []).filter(
        (id) => !confirmedSemanticIds.includes(id),
      ),
    ])];
    enriched.openAlexIds = [...new Set(confirmedOpenAlexIds)];
    enriched.semanticScholarIds = [...new Set(confirmedSemanticIds)];
    enriched.identityNeedsReview = false;
    enriched.institutions = [...new Set([
      current.institution,
      ...(current.institutions || []),
      enriched.institution,
      ...(enriched.institutions || []),
    ])];
    enriched.institutionalProfileUrl =
      enriched.institutionalProfileUrl ||
      current.institutionalProfileUrl;
    enriched.institutionalProfileVerifiedAt =
      enriched.institutionalProfileVerifiedAt ||
      current.institutionalProfileVerifiedAt;
    enriched.institutionalEvidence = [...new Set([
      ...(current.institutionalEvidence || []),
      ...(enriched.institutionalEvidence || []),
    ])];
    enriched.verifiedWorkDois = [...new Set([
      ...(current.verifiedWorkDois || []),
      ...(enriched.verifiedWorkDois || []),
    ])];
    enriched.mergeEvidence = [...new Set([
      ...(current.mergeEvidence || []),
      ...(enriched.mergeEvidence || []),
    ])];
    const nextScholars = [...subscriptions.scholar];
    nextScholars[index] = enriched;
    saveSubscriptions({ ...subscriptions, scholar: nextScholars });
  }

  function followScholar(result: SearchResult, closeModal = true) {
    if (isScholarFollowed(result)) {
      showNotice("这位学者已经在关注列表中");
      return;
    }
    const scholar = scholarFromResult(result);
    const next = {
      ...subscriptions,
      scholar: [...subscriptions.scholar, scholar],
    };
    saveSubscriptions(next);
    saveCachedProfile(
      result,
      result.representativeWorks || [],
      new Date().toISOString(),
      false,
    );
    void loadFeed(false, undefined, next);
    if (closeModal) {
      setAddOpen(false);
      setAddQuery("");
      setSearchResults([]);
    }
    showNotice(
      scholar.trackingStatus === "verified"
        ? "已添加到你的关注"
        : "档案已保存；自动更新可能不完整",
    );
  }

  function saveManualScholar() {
    const name = manualScholarName.trim();
    const homepage = scholarHomepage.trim() || addQuery.trim();
    if (name.length < 2 || !/^https?:\/\//i.test(homepage)) {
      showNotice("请填写学者姓名和完整主页网址");
      return;
    }
    followScholar({
      candidateId: `limited:${name.toLowerCase()}:${
        scholarInstitution.trim().toLowerCase()
      }`,
      label: name,
      value: homepage,
      institution: scholarInstitution.trim() || "单位待确认",
      institutions: scholarInstitution.trim()
        ? [scholarInstitution.trim()]
        : [],
      researchAreas: scholarTopic.trim() ? [scholarTopic.trim()] : [],
      profileUrl: homepage,
      profileUrls: [homepage],
      institutionalProfileUrl: homepage,
      institutionalEvidence: ["使用者保存的机构个人主页，尚待在线核验"],
      sources: ["人工核验主页"],
      trackingStatus: "limited",
    });
  }

  async function openScholarProfile(result: SearchResult) {
    const cached = findCachedProfile(result);
    const requestResult = cached?.candidate || result;
    setAddOpen(false);
    setActiveSubscription(null);
    setHistoryScholar(undefined);
    setFilter("scholar");
    if (cached) {
      setProfile({
        candidate: cached.candidate,
        works: cached.works,
      });
      const cachedAt = Date.parse(cached.updatedAt);
      if (
        cached.complete &&
        Number.isFinite(cachedAt) &&
        new Date().getTime() - cachedAt < 24 * 60 * 60 * 1000
      ) {
        setProfileLoading(false);
        return;
      }
    }
    const hasStableIdentity =
      requestResult.openAlexIds?.length ||
      requestResult.semanticScholarIds?.length ||
      requestResult.externalIds?.openAlex ||
      requestResult.externalIds?.semanticScholar ||
      requestResult.orcid ||
      requestResult.externalIds?.orcid;
    if (!hasStableIdentity && requestResult.representativeWorks?.length) {
      saveCachedProfile(
        requestResult,
        requestResult.representativeWorks,
      );
      setProfile({
        candidate: requestResult,
        works: requestResult.representativeWorks,
      });
      return;
    }
    setProfileLoading(!cached);
    setError("");
    try {
      const params = new URLSearchParams();
      const openAlexIds = [
        ...(requestResult.openAlexIds || []),
        ...(requestResult.externalIds?.openAlex
          ? [requestResult.externalIds.openAlex]
          : []),
      ].filter((id, index, all) => Boolean(id) && all.indexOf(id) === index);
      const semanticScholarIds = [
        ...(requestResult.semanticScholarIds || []),
        ...(requestResult.externalIds?.semanticScholar
          ? [requestResult.externalIds.semanticScholar]
          : []),
      ].filter((id, index, all) => Boolean(id) && all.indexOf(id) === index);
      openAlexIds.forEach((id) => params.append("openAlexId", id));
      semanticScholarIds.forEach((id) =>
        params.append("semanticScholarId", id),
      );
      (requestResult.verifiedWorkDois || [])
        .slice(0, 40)
        .forEach((doi) => params.append("workDoi", doi));
      if (requestResult.orcid || requestResult.externalIds?.orcid) {
        params.set(
          "orcid",
          requestResult.orcid ||
            requestResult.externalIds?.orcid ||
            "",
        );
      }
      params.set("name", requestResult.label);
      const response = await fetch(
        `/api/scholar-profile?${params.toString()}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error("profile unavailable");
      const data = (await response.json()) as {
        candidate?: SearchResult | null;
        candidates?: SearchResult[];
        works?: ScholarWork[];
        needsConfirmation?: boolean;
      };
      if (data.candidate) {
        const enrichedCandidate: SearchResult = {
          ...requestResult,
          ...data.candidate,
          institutionalProfileUrl:
            data.candidate.institutionalProfileUrl ||
            requestResult.institutionalProfileUrl,
          institutionalProfileVerifiedAt:
            data.candidate.institutionalProfileVerifiedAt ||
            requestResult.institutionalProfileVerifiedAt,
          institutionalEvidence: [
            ...new Set([
              ...(requestResult.institutionalEvidence || []),
              ...(data.candidate.institutionalEvidence || []),
            ]),
          ],
          profileUrls: [
            ...new Set([
              ...(requestResult.profileUrls || []),
              ...(data.candidate.profileUrls || []),
            ]),
          ],
        };
        persistEnrichedScholar(enrichedCandidate);
        saveCachedProfile(
          enrichedCandidate,
          data.works || enrichedCandidate.representativeWorks || [],
        );
        setProfile({
          candidate: enrichedCandidate,
          works: data.works || enrichedCandidate.representativeWorks || [],
        });
      } else if (data.candidates?.length) {
        setAddKind("scholar");
        setScholarSearchMode("name");
        setAddQuery(requestResult.label);
        setSearchResults(data.candidates);
        setAuthorContextName(requestResult.label);
        setAddOpen(true);
      } else {
        setProfile({
          candidate: requestResult,
          works: requestResult.representativeWorks || [],
        });
        setFilter("scholar");
      }
    } catch {
      if (!cached) {
        setProfile({
          candidate: requestResult,
          works: requestResult.representativeWorks || [],
        });
      }
      setFilter("scholar");
      setError(
        cached
          ? "暂时无法更新，正在显示文件夹中保存的学者档案。"
          : "暂时无法补充学者档案，正在显示已有身份信息。",
      );
    } finally {
      setProfileLoading(false);
    }
  }

  function closeAddModal() {
    setAddOpen(false);
    setAddQuery("");
    setSearchResults([]);
    setSearchWarnings([]);
    setQueryVariants([]);
    setAuthorContextName("");
    setManualScholarName("");
    setScholarHomepage("");
    setApiSettingsOpen(false);
    setOpenAlexApiKeyInput("");
    setSemanticScholarApiKeyInput("");
  }

  async function openArticleAuthor(author: ArticleAuthor, article: Article) {
    const hasStableIdentity =
      author.openAlexId || author.semanticScholarId || author.orcid;
    if (hasStableIdentity) {
      await openScholarProfile({
        candidateId:
          (author.orcid && `orcid:${cleanOrcid(author.orcid)}`) ||
          (author.openAlexId && `openalex:${author.openAlexId}`) ||
          (author.semanticScholarId &&
            `semantic:${author.semanticScholarId}`) ||
          undefined,
        label: author.name,
        value:
          author.openAlexId ||
          author.semanticScholarId ||
          author.orcid ||
          author.name,
        openAlexIds: author.openAlexId ? [author.openAlexId] : [],
        semanticScholarIds: author.semanticScholarId
          ? [author.semanticScholarId]
          : [],
        orcid: author.orcid,
        externalIds: {
          openAlex: author.openAlexId,
          semanticScholar: author.semanticScholarId,
          orcid: author.orcid,
        },
        trackingStatus: "verified",
      });
      return;
    }

    setAddKind("scholar");
    setScholarSearchMode("work");
    setAuthorContextName(author.name);
    setManualScholarName(author.name);
    setAddQuery(article.doi || article.title);
    setSearchResults([]);
    setSearchWarnings([]);
    setAddOpen(true);
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
          {
            label: result.label,
            issn: result.value,
            followedAt: new Date().toISOString(),
          },
        ],
      };
      saveSubscriptions(next);
      void loadFeed(false, undefined, next);
    } else if (addKind === "scholar" && result) {
      followScholar(result);
      return;
    } else {
      return;
    }
    setAddOpen(false);
    setAddQuery("");
    setSearchResults([]);
    showNotice("已添加到你的关注");
  }

  function removeSubscription(kind: MatchKind, label: string, id?: string) {
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
                (item) =>
                  id
                    ? item.subscriptionId !== id
                    : item.label !== label,
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
      (activeSubscription.id
        ? activeSubscription.id === id
        : activeSubscription.label === label)
    ) {
      setActiveSubscription(null);
      setFilter("all");
      setHistoryScholar(undefined);
    }
    void loadFeed(false, undefined, next);
    showNotice("已从关注列表移除");
  }

  async function selectSubscription(
    kind: MatchKind,
    label: string,
    id?: string,
  ) {
    setProfile(null);
    setFilter(kind);
    setActiveSubscription({ kind, label, id });
    if (kind !== "scholar" && historyScholar) {
      setHistoryScholar(undefined);
      await loadFeed();
    }
  }

  async function selectFilter(nextFilter: Filter) {
    setProfile(null);
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
        article.authors.map((author) => author.name).join(" "),
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
              item.subscriptionId === savedScholar.subscriptionId ||
              item.label.toLowerCase() === savedScholar.label.toLowerCase(),
          ) || savedScholar;
        const cachedProfile = Object.values(scholarProfiles).find(
          (item) => cachedProfileMatches(item.candidate, scholar),
        );
        const cachedArticles = (cachedProfile?.works || []).map(
          (work): Article => ({
            id: work.doi || work.id,
            doi: work.doi,
            title: work.title,
            authors: [{ name: scholar.label }],
            venue: work.venue || "发表载体待确认",
            publishedAt: work.year
              ? `${work.year}-01-01`
              : "1900-01-01",
            type: "学术成果",
            url: work.url || (work.doi ? `https://doi.org/${work.doi}` : ""),
            abstract: work.abstract,
            matches: [{ kind: "scholar", label: scholar.label }],
          }),
        );
        const articles = [...(feed?.items || []), ...cachedArticles]
          .filter(
            (article) =>
              !states[article.id]?.ignored &&
              article.matches.some(
                (match) =>
                  match.kind === "scholar" &&
                  match.label.toLowerCase() === scholar.label.toLowerCase(),
              ),
          )
          .filter(
            (article, index, all) =>
              all.findIndex(
                (item) =>
                  item.id === article.id ||
                  (item.doi && item.doi === article.doi),
              ) === index,
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
            article.authors.map((author) => author.name).join(" "),
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
  }, [feed, query, scholarProfiles, states, subscriptions.scholar]);

  const unreadCount = (feed?.items || []).filter(
    (article) =>
      articlePublishedSinceFollow(article, subscriptions) &&
      !states[article.id]?.read &&
      !states[article.id]?.ignored,
  ).length;
  const savedCount = Object.values(states).filter((state) => state.saved).length;
  const currentScholar =
    profile
      ? scholarFromResult(profile.candidate)
      : activeSubscription?.kind === "scholar"
      ? subscriptions.scholar.find(
          (item) =>
            (activeSubscription.id &&
              item.subscriptionId === activeSubscription.id) ||
            (!activeSubscription.id &&
              item.label === activeSubscription.label),
        ) ||
        feed?.scholars?.find(
          (item) =>
            (activeSubscription.id &&
              item.subscriptionId === activeSubscription.id) ||
            (!activeSubscription.id &&
              item.label === activeSubscription.label),
        )
      : undefined;
  const currentProfileFollowed = profile
    ? subscriptions.scholar.find(
        (item) => scholarRecordsMatch(profile.candidate, item),
      )
    : currentScholar;

  async function openScholar(scholar: Scholar) {
    const cached = findCachedProfile(scholar);
    const feedWorks = (feed?.items || [])
      .filter((article) =>
        article.matches.some(
          (match) =>
            match.kind === "scholar" &&
            match.label.toLowerCase() === scholar.label.toLowerCase(),
        ),
      )
      .map((article): ScholarWork => ({
        id: article.id,
        doi: article.doi,
        title: article.title,
        year: Number.parseInt(article.publishedAt.slice(0, 4), 10) || undefined,
        venue: article.venue,
        url: article.url,
        abstract: article.abstract,
      }));
    await openScholarProfile({
      ...scholar,
      candidateId: scholar.subscriptionId,
      value: scholar.subscriptionId,
      representativeWorks: cached?.works.length
        ? cached.works
        : feedWorks,
    });
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
              items={subscriptions.scholar.map((item) => ({
                id: item.subscriptionId,
                label: item.label,
              }))}
              kind="scholar"
              activeId={activeSubscription?.id}
              onSelect={(item) => {
                const scholar = subscriptions.scholar.find(
                  (candidate) => candidate.subscriptionId === item.id,
                );
                if (scholar) void openScholar(scholar);
              }}
              onRemove={(item) =>
                removeSubscription("scholar", item.label, item.id)
              }
            />
            <SubscriptionGroup
              title="期刊"
              items={subscriptions.journal.map((item) => ({
                id: item.label,
                label: item.label,
              }))}
              kind="journal"
              activeId={activeSubscription?.label}
              onSelect={(item) =>
                void selectSubscription("journal", item.label)
              }
              onRemove={(item) =>
                removeSubscription("journal", item.label)
              }
            />
            <SubscriptionGroup
              title="关键词"
              items={subscriptions.keyword.map((item) => ({
                id: keywordGroupLabel(item),
                label: keywordGroupLabel(item),
              }))}
              kind="keyword"
              activeId={activeSubscription?.label}
              onSelect={(item) =>
                void selectSubscription("keyword", item.label)
              }
              onRemove={(item) =>
                removeSubscription("keyword", item.label)
              }
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
                {profile?.candidate.label ||
                  activeSubscription?.label ||
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
                  {profile
                    ? profile.works.length
                    : feed
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
              <div className="scholar-profile-content">
                <p>
                  {currentScholar.trackingStatus === "verified"
                    ? "身份已确认"
                    : "身份仍需核验"}
                </p>
                <h2>{currentScholar.label}</h2>
                <strong>{currentScholar.institution}</strong>
                {(currentScholar.mergedRecordCount || 1) > 1 ? (
                  <small className="merge-summary">
                    已整合 {currentScholar.mergedRecordCount} 条索引记录
                    {currentScholar.mergeEvidence?.length
                      ? `；依据：${currentScholar.mergeEvidence
                          .slice(0, 3)
                          .join("、")}`
                      : ""}
                  </small>
                ) : null}
                <small>
                  公开索引约收录{" "}
                  {currentScholar.worksCount?.toLocaleString("zh-CN") || "—"}{" "}
                  条成果；下方合并展示历史发表与近期更新。
                </small>
                {currentScholar.trackingStatus === "limited" && (
                  <small className="tracking-warning">
                    档案已保存，但尚未确认学术索引 ID 或可解析代表作，自动更新可能不完整。
                  </small>
                )}
                {currentScholar.identityNeedsReview && (
                  <small className="tracking-warning">
                    旧版自动合并出的多个作者 ID 已被隔离。请用代表作或机构个人主页重新搜索并确认；收藏、已读和翻译没有受到影响。
                  </small>
                )}
                {currentScholar.researchAreas?.length ? (
                  <small>
                    研究方向：{currentScholar.researchAreas.join("、")}
                  </small>
                ) : null}
                {currentScholar.institutionalProfileUrl ? (
                  <small className="institutional-verification">
                    {currentScholar.institutionalProfileVerifiedAt
                      ? "机构个人主页已核验"
                      : "已保存机构个人主页"}
                    {currentScholar.institutionalEvidence?.length
                      ? `：${currentScholar.institutionalEvidence.join("、")}`
                      : ""}
                  </small>
                ) : null}
                <nav>
                  {[
                    ...(currentScholar.profileUrls || []),
                    ...(currentScholar.profileUrl
                      ? [currentScholar.profileUrl]
                      : []),
                  ]
                    .filter(
                      (url, index, all) =>
                        /^https?:\/\//i.test(url) &&
                        all.indexOf(url) === index,
                    )
                    .slice(0, 4)
                    .map((url) => (
                      <a href={url} target="_blank" rel="noreferrer" key={url}>
                        {url.includes("openalex.org")
                          ? "OpenAlex ↗"
                          : url.includes("semanticscholar.org")
                            ? "Semantic Scholar ↗"
                            : url ===
                                currentScholar.institutionalProfileUrl
                              ? "机构个人主页 ↗"
                              : "外部档案 ↗"}
                      </a>
                    ))}
                  {currentScholar.orcid && (
                    <a
                      href={`https://orcid.org/${cleanOrcid(currentScholar.orcid)}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      ORCID ↗
                    </a>
                  )}
                </nav>
              </div>
              {profile && (
                <div className="scholar-profile-actions">
                  {currentProfileFollowed ? (
                    <button
                      className="secondary-button"
                      onClick={() =>
                        removeSubscription(
                          "scholar",
                          currentProfileFollowed.label,
                          currentProfileFollowed.subscriptionId,
                        )
                      }
                    >
                      取消关注
                    </button>
                  ) : (
                    <button
                      className="primary-button"
                      onClick={() => followScholar(profile.candidate, false)}
                    >
                      关注
                    </button>
                  )}
                </div>
              )}
            </section>
          )}

          {error && <div className="error-banner">{error}</div>}
          {feed?.warnings?.map((warning) => (
            <div className="error-banner" key={warning}>{warning}</div>
          ))}

          {profileLoading ? (
            <div className="loading-list" aria-label="正在载入学者档案">
              {[0, 1, 2].map((item) => (
                <div className="loading-card" key={item}>
                  <span /><span /><span />
                </div>
              ))}
            </div>
          ) : profile ? (
            profile.works.length ? (
              <section className="profile-publications">
                <div className="profile-publications-heading">
                  <div>
                    <p>聚合档案</p>
                    <h2>最新发表与历史成果</h2>
                  </div>
                  <span>{profile.works.length} 条</span>
                </div>
                <ol>
                  {profile.works.map((work, index) => {
                    const abstractKey = `profile:${work.id || `${work.title}-${index}`}`;
                    const abstractExpanded = Boolean(expanded[abstractKey]);
                    return (
                    <li key={work.id || `${work.title}-${index}`}>
                      <div>
                        <span>{work.year || "年份待确认"}</span>
                        {work.venue && <em>{work.venue}</em>}
                      </div>
                      <h3>
                        {work.url ? (
                          <a href={work.url} target="_blank" rel="noreferrer">
                            {work.title}
                          </a>
                        ) : (
                          work.title
                        )}
                      </h3>
                      {work.doi && <small>DOI: {work.doi}</small>}
                      {work.abstract ? (
                        <div className="profile-abstract">
                          <button
                            type="button"
                            aria-expanded={abstractExpanded}
                            onClick={() =>
                              setExpanded((current) => ({
                                ...current,
                                [abstractKey]: !current[abstractKey],
                              }))
                            }
                          >
                            {abstractExpanded ? "收起摘要" : "展开摘要"}
                          </button>
                          {abstractExpanded ? <p>{work.abstract}</p> : null}
                        </div>
                      ) : null}
                    </li>
                    );
                  })}
                </ol>
              </section>
            ) : (
              <div className="empty-state">
                <span>◎</span>
                <h2>已找到身份档案，暂未取得可展示的发表</h2>
                <p>可使用代表作、DOI 或外部档案链接再次核验。</p>
              </div>
            )
          ) : loading && !feed ? (
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
                      key={scholar.subscriptionId}
                      role="button"
                      tabIndex={0}
                      aria-label={`查看 ${scholar.label} 的全部发表`}
                      onClick={() => void openScholar(scholar)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          void openScholar(scholar);
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
                const publishedSinceFollow = articlePublishedSinceFollow(
                  article,
                  subscriptions,
                );
                const isExpanded = expanded[article.id];
                const keywordMatches = article.matches
                  .filter((match) => match.kind === "keyword")
                  .flatMap((match) => match.terms || [match.label]);
                return (
                  <article
                    className={`article-card ${
                      state.read || !publishedSinceFollow ? "is-read" : ""
                    }`}
                    key={article.id}
                  >
                    <div className="article-meta">
                      <span className="venue">{article.venue}</span>
                      <span>·</span>
                      <time>{relativeDate(article.publishedAt)}</time>
                      {!publishedSinceFollow && (
                        <span className="before-follow-pill">关注前发表</span>
                      )}
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

                    <div className="authors" aria-label="作者">
                      {article.authors.length ? (
                        article.authors.slice(0, 8).map((author, index) => (
                          <span key={`${author.name}-${index}`}>
                            <button
                              className="author-link"
                              onClick={() =>
                                void openArticleAuthor(author, article)
                              }
                              title={`查看 ${author.name} 的学者档案`}
                            >
                              {author.name}
                            </button>
                            {index < Math.min(article.authors.length, 8) - 1
                              ? ","
                              : ""}
                          </span>
                        ))
                      ) : (
                        <span>作者信息暂缺</span>
                      )}
                    </div>

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
        </aside>
      </div>

      {addOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={closeAddModal}>
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
              <button aria-label="关闭" onClick={closeAddModal}>×</button>
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
                    setSearchWarnings([]);
                    setQueryVariants([]);
                    setAuthorContextName("");
                    setManualScholarName("");
                    setScholarHomepage("");
                  }}
                >
                  {kindLabel(kind)}
                </button>
              ))}
            </div>
            {addKind === "scholar" && (
              <div className="scholar-search-modes" aria-label="学者搜索方式">
                <button
                  className={scholarSearchMode === "name" ? "active" : ""}
                  onClick={() => {
                    setScholarSearchMode("name");
                    setAddQuery("");
                    setSearchResults([]);
                    setAuthorContextName("");
                  }}
                >
                  按姓名
                </button>
                <button
                  className={scholarSearchMode === "work" ? "active" : ""}
                  onClick={() => {
                    setScholarSearchMode("work");
                    setAddQuery("");
                    setSearchResults([]);
                  }}
                >
                  按代表作
                </button>
              </div>
            )}
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
                      ? scholarSearchMode === "name"
                        ? "接受中文和拼音，但尽量使用英文"
                        : "输入论文或书名、DOI、ISBN、ORCID 或档案链接"
                      : "输入需要重点标注的关键词"
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter" && addKind === "keyword") {
                    addSubscription();
                  }
                }}
              />
            </label>
            {addKind === "scholar" && (
              <>
                <div className="scholar-search-filters">
                  <label>
                    <span>单位（可选）</span>
                    <input
                      value={scholarInstitution}
                      onChange={(event) =>
                        setScholarInstitution(event.target.value)
                      }
                      placeholder="例如 浙江大学"
                    />
                  </label>
                  <label>
                    <span>研究方向（可选）</span>
                    <input
                      value={scholarTopic}
                      onChange={(event) => setScholarTopic(event.target.value)}
                      placeholder="例如 人类学"
                    />
                  </label>
                  <label className="homepage-filter">
                    <span>机构个人主页（推荐）</span>
                    <input
                      value={scholarHomepage}
                      onChange={(event) =>
                        setScholarHomepage(event.target.value)
                      }
                      placeholder="https://大学或研究机构的个人主页"
                    />
                  </label>
                </div>
                <p className="scholar-search-help">
                  {scholarSearchMode === "name"
                    ? "输入至少两个字符即可获得姓名联想；不区分大小写，并允许常见拼写错误。机构主页可用于排除同名者。"
                    : "可解析期刊论文、书籍与章节，再列出作者供确认；ISBN 适合核验专著。"}
                </p>
                <div className="api-access-row">
                  <span>
                    OpenAlex：
                    <strong>
                      {localSettings.openAlexConfigured
                        ? `已配置 ${localSettings.openAlexKeyHint || ""}`
                        : "免配置降级模式"}
                    </strong>
                    {" · "}Semantic Scholar：
                    <strong>
                      {localSettings.semanticScholarConfigured
                        ? `已配置 ${localSettings.semanticScholarKeyHint || ""}`
                        : "免配置基础额度"}
                    </strong>
                  </span>
                  <button
                    type="button"
                    onClick={() => setApiSettingsOpen((open) => !open)}
                  >
                    {apiSettingsOpen ? "收起设置" : "接口设置"}
                  </button>
                </div>
                {apiSettingsOpen ? (
                  <section className="api-settings-panel">
                    <div className="api-provider-settings">
                      <div>
                        <strong>OpenAlex 免费 API Key</strong>
                        <p>
                          配置后启用接近 1.0.0 的稳定作者主档案搜索、错拼容错、单位和主题信息。
                          Key 只保存在当前解压文件夹的 data 目录。
                        </p>
                        <a
                          href="https://openalex.org/settings/api"
                          target="_blank"
                          rel="noreferrer"
                        >
                          免费获取 OpenAlex API Key ↗
                        </a>
                      </div>
                      <label>
                        <span>OpenAlex API Key</span>
                        <input
                          type="password"
                          autoComplete="off"
                          value={openAlexApiKeyInput}
                          onChange={(event) =>
                            setOpenAlexApiKeyInput(event.target.value)
                          }
                          placeholder={
                            localSettings.openAlexConfigured
                              ? "输入新 Key 可替换当前配置"
                              : "粘贴 OpenAlex API Key"
                          }
                        />
                      </label>
                      <div className="api-settings-actions">
                        {localSettings.openAlexConfigured ? (
                          <button
                            type="button"
                            className="remove-api-key"
                            disabled={apiSettingsSaving}
                            onClick={() => void saveApiKey("openAlex", true)}
                          >
                            移除 Key
                          </button>
                        ) : null}
                        <button
                          type="button"
                          disabled={
                            apiSettingsSaving ||
                            openAlexApiKeyInput.trim().length < 8
                          }
                          onClick={() => void saveApiKey("openAlex")}
                        >
                          {apiSettingsSaving ? "正在保存…" : "保存到本地"}
                        </button>
                      </div>
                    </div>
                    <div className="api-provider-settings">
                      <div>
                        <strong>Semantic Scholar 免费 API Key（可选）</strong>
                        <p>
                          未配置 OpenAlex 时，系统会用 Semantic Scholar
                          作为基础检索；配置其免费 Key 可减少频繁查询时的限流。
                        </p>
                        <a
                          href="https://www.semanticscholar.org/product/api"
                          target="_blank"
                          rel="noreferrer"
                        >
                          申请 Semantic Scholar API Key ↗
                        </a>
                      </div>
                      <label>
                        <span>Semantic Scholar API Key</span>
                        <input
                          type="password"
                          autoComplete="off"
                          value={semanticScholarApiKeyInput}
                          onChange={(event) =>
                            setSemanticScholarApiKeyInput(event.target.value)
                          }
                          placeholder={
                            localSettings.semanticScholarConfigured
                              ? "输入新 Key 可替换当前配置"
                              : "粘贴 Semantic Scholar API Key"
                          }
                        />
                      </label>
                      <div className="api-settings-actions">
                        {localSettings.semanticScholarConfigured ? (
                        <button
                          type="button"
                          className="remove-api-key"
                          disabled={apiSettingsSaving}
                            onClick={() =>
                              void saveApiKey("semanticScholar", true)
                            }
                        >
                          移除 Key
                        </button>
                      ) : null}
                      <button
                        type="button"
                        disabled={
                            apiSettingsSaving ||
                            semanticScholarApiKeyInput.trim().length < 8
                        }
                          onClick={() => void saveApiKey("semanticScholar")}
                      >
                        {apiSettingsSaving ? "正在保存…" : "保存到本地"}
                      </button>
                      </div>
                    </div>
                  </section>
                ) : null}
              </>
            )}

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
                {addKind === "scholar" &&
                scholarSearchMode === "name" &&
                !localSettings.openAlexConfigured ? (
                  <div className="api-key-callout">
                    <span>
                      当前仍可使用基础姓名搜索；部分姓名、缩写、错拼和最近发表可能不完整。
                    </span>
                    <button type="button" onClick={() => setApiSettingsOpen(true)}>
                      配置免费 Key
                    </button>
                  </div>
                ) : null}
                {visibleSearching && <p className="search-hint">正在搜索公开学术索引…</p>}
                {addKind === "scholar" && queryVariants.length > 1 && (
                  <p className="query-variants">
                    已同时尝试：{queryVariants.slice(0, 6).join(" · ")}
                  </p>
                )}
                {searchWarnings.map((warning) => (
                  <p className="search-warning" key={warning}>
                    {warning}
                  </p>
                ))}
                {!visibleSearching && addQuery.trim().length < 2 && (
                  <p className="search-hint">
                    输入至少两个字符，结果会随输入自动推荐。
                  </p>
                )}
                {!visibleSearching &&
                  addQuery.trim().length >= 2 &&
                  visibleSearchResults.length === 0 && (
                    <p className="search-hint">
                      没有找到结果。可补充单位或研究方向，或切换到“按代表作”。
                    </p>
                  )}
                {visibleSearchResults.map((result) =>
                  addKind === "scholar" ? (
                    <article
                      className="scholar-search-result"
                      key={result.candidateId || `${result.label}-${result.value}`}
                    >
                      <div className="scholar-result-heading">
                        <div>
                          <strong>{result.label}</strong>
                          {result.aliases?.length ? (
                            <small>
                              别名：{result.aliases.slice(0, 5).join("、")}
                            </small>
                          ) : null}
                        </div>
                        <span>
                          {result.scoreReasons?.includes("最可能的主档案")
                            ? "最可能的主档案"
                            : result.trackingStatus === "limited"
                            ? "需进一步核验"
                            : "可自动追踪"}
                        </span>
                      </div>
                      <p>
                        {(result.institutions?.length
                          ? result.institutions
                          : [result.institution || result.detail]
                        )
                          .filter(Boolean)
                          .slice(0, 3)
                          .join(" · ") || "单位待确认"}
                      </p>
                      {result.researchAreas?.length ? (
                        <p className="research-preview">
                          研究方向：{result.researchAreas.slice(0, 6).join("、")}
                        </p>
                      ) : null}
                      {result.identityWarnings?.map((warning) => (
                        <p className="identity-warning" key={warning}>
                          {warning}
                        </p>
                      ))}
                      {(result.mergedRecordCount || 1) > 1 ? (
                        <p className="identity-merge-note">
                          <strong>
                            已整合 {result.mergedRecordCount} 条索引记录
                          </strong>
                          {result.mergeEvidence?.length
                            ? `：${result.mergeEvidence
                                .slice(0, 3)
                                .join("、")}`
                            : ""}
                        </p>
                      ) : null}
                      {result.representativeWorks?.length ? (
                        <>
                          <div className="latest-work-preview">
                            <small>
                              最近发表
                              {result.representativeWorks[0].year
                                ? ` · ${result.representativeWorks[0].year}`
                                : ""}
                            </small>
                            <strong>{result.representativeWorks[0].title}</strong>
                            {result.representativeWorks[0].venue ? (
                              <span>{result.representativeWorks[0].venue}</span>
                            ) : null}
                          </div>
                          {result.representativeWorks.length > 1 ? (
                          <ol className="representative-works">
                          {result.representativeWorks.slice(1, 3).map((work) => (
                            <li key={work.id || work.title}>
                              <span>{work.title}</span>
                              {work.year && <time>{work.year}</time>}
                            </li>
                          ))}
                          </ol>
                          ) : null}
                        </>
                      ) : null}
                      <div className="scholar-result-meta">
                        <span>
                          {typeof result.worksCount === "number"
                            ? `${result.worksCount.toLocaleString("zh-CN")} 项成果`
                            : "成果数待确认"}
                        </span>
                        <span>
                          来源：{result.sources?.join("、") || "公开索引"}
                        </span>
                      </div>
                      <div className="scholar-result-actions">
                        <button
                          className="secondary-button"
                          onClick={() => void openScholarProfile(result)}
                        >
                          查看档案
                        </button>
                        <button
                          className="primary-button"
                          disabled={isScholarFollowed(result)}
                          onClick={() => followScholar(result)}
                        >
                          {isScholarFollowed(result) ? "已关注" : "关注"}
                        </button>
                      </div>
                    </article>
                  ) : (
                    <button
                      className="search-result"
                      key={`${result.label}-${result.value}`}
                      onClick={() => addSubscription(result)}
                    >
                      <span>
                        <strong>{result.label}</strong>
                        <small>{result.detail || result.value}</small>
                      </span>
                      <em>添加</em>
                    </button>
                  ),
                )}
                {addKind === "scholar" &&
                  scholarSearchMode === "work" &&
                  /^https?:\/\//i.test(addQuery.trim()) &&
                  !visibleSearching &&
                  visibleSearchResults.length === 0 && (
                    <section className="manual-scholar">
                      <strong>保存人工核验主页</strong>
                      <p>
                        如果这是机构主页，可先保存；未确认索引 ID 或代表作时，自动更新可能不完整。
                      </p>
                      <label>
                        <span>学者姓名</span>
                        <input
                          value={manualScholarName}
                          onChange={(event) =>
                            setManualScholarName(event.target.value)
                          }
                          placeholder="请输入姓名"
                        />
                      </label>
                      <button onClick={saveManualScholar}>保存档案</button>
                    </section>
                  )}
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
  activeId,
  onSelect,
  onRemove,
}: {
  title: string;
  items: { id: string; label: string }[];
  kind: MatchKind;
  activeId?: string;
  onSelect: (item: { id: string; label: string }) => void;
  onRemove: (item: { id: string; label: string }) => void;
}) {
  return (
    <details open className="subscription-group">
      <summary>
        <span><i className={kind} />{title}</span>
        <em>{items.length}</em>
      </summary>
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <button
              className={`subscription-name ${activeId === item.id ? "active" : ""}`}
              onClick={() => onSelect(item)}
              title={`只看 ${item.label}`}
            >
              {item.label}
            </button>
            <button
              className="subscription-remove"
              aria-label={`移除 ${item.label}`}
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
