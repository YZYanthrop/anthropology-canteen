import { NextRequest, NextResponse } from "next/server";
import {
  searchScholars,
  type ScholarCandidate,
} from "../../lib/scholar-search";

export const dynamic = "force-dynamic";

type MatchKind = "journal" | "scholar" | "keyword";
type Match = { kind: MatchKind; label: string; terms?: string[] };
type Journal = { label: string; issn: string; followedAt?: string };
type KeywordGroup = { root: string; variants: string[] };
type Scholar = {
  subscriptionId: string;
  label: string;
  aliases?: string[];
  openAlexIds: string[];
  semanticScholarIds?: string[];
  institution: string;
  institutions?: string[];
  profileUrl?: string;
  profileUrls?: string[];
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

type OpenAlexWork = {
  id?: string;
  doi?: string;
  title?: string;
  display_name?: string;
  publication_date?: string;
  publication_year?: number;
  type?: string;
  type_crossref?: string;
  abstract_inverted_index?: Record<string, number[]>;
  authorships?: {
    author?: {
      id?: string;
      display_name?: string;
      orcid?: string;
    };
  }[];
  primary_location?: {
    source?: { display_name?: string; issn_l?: string };
    landing_page_url?: string;
  };
  keywords?: { display_name?: string }[];
  topics?: { display_name?: string }[];
  concepts?: { display_name?: string }[];
};

type CrossrefWork = {
  DOI?: string;
  URL?: string;
  title?: string[];
  abstract?: string;
  type?: string;
  publisher?: string;
  "container-title"?: string[];
  subject?: string[];
  author?: {
    given?: string;
    family?: string;
    name?: string;
    ORCID?: string;
    affiliation?: { name?: string }[];
  }[];
  published?: { "date-parts"?: number[][] };
  issued?: { "date-parts"?: number[][] };
  created?: { "date-time"?: string };
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

type ArticleAuthor = {
  name: string;
  openAlexId?: string;
  semanticScholarId?: string;
  orcid?: string;
};

type SemanticScholarPaper = {
  paperId?: string;
  title?: string;
  abstract?: string;
  year?: number;
  publicationDate?: string;
  venue?: string;
  url?: string;
  publicationTypes?: string[];
  externalIds?: { DOI?: string };
  fieldsOfStudy?: string[];
  authors?: {
    authorId?: string;
    name?: string;
    externalIds?: { ORCID?: string };
  }[];
};

const DEFAULT_SCHOLARS: Scholar[] = [];

const DEFAULT_SUBSCRIPTIONS: Subscriptions = {
  journal: [],
  scholar: [],
  keyword: [],
};

const CURATED_PROFILE_WORKS: Record<string, Omit<Article, "matches">[]> = {};

function curatedWorks(scholar: Scholar) {
  return (CURATED_PROFILE_WORKS[scholar.label] || []).map((item) => ({
    ...item,
    matches: [{ kind: "scholar" as const, label: scholar.label }],
  }));
}

function clean(value: unknown, max = 160) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function cleanTimestamp(value: unknown) {
  const timestamp = clean(value, 80);
  return Number.isFinite(Date.parse(timestamp))
    ? timestamp
    : new Date().toISOString();
}

function canonicalKeywordRoot(input: string) {
  const value = clean(input, 80).toLowerCase().replace(/\s+/g, " ");
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

function generatedKeywordVariants(root: string) {
  if (!/^[a-z]+$/.test(root)) return [root];
  if (root.endsWith("ic")) {
    return [root, `${root}s`, `${root}al`, `${root}ally`];
  }
  if (root.endsWith("y") && root.length > 3) {
    const stem = root.slice(0, -1);
    return [root, `${stem}ies`, `${stem}ical`, `${stem}ically`];
  }
  if (root.endsWith("e") && root.length > 3) {
    const stem = root.slice(0, -1);
    return [root, `${root}s`, `${root}d`, `${stem}ing`, `${root}ful`];
  }
  return [root, `${root}s`, `${root}ed`, `${root}ing`, `${root}al`];
}

function validateKeywordGroup(value: unknown): KeywordGroup | null {
  const candidate =
    typeof value === "string"
      ? { root: value, variants: [value] }
      : value && typeof value === "object"
        ? (value as Partial<KeywordGroup>)
        : null;
  if (!candidate) return null;
  const root = canonicalKeywordRoot(clean(candidate.root, 80));
  if (!root) return null;
  const variants = Array.isArray(candidate.variants)
    ? candidate.variants.map((item) => clean(item, 80).toLowerCase()).filter(Boolean)
    : [];
  return {
    root,
    variants: [
      ...new Set([root, ...variants, ...generatedKeywordVariants(root)]),
    ].slice(0, 10),
  };
}

function keywordGroupLabel(group: KeywordGroup) {
  return group.variants.join(" / ");
}

function openAlexId(value: unknown) {
  const id = clean(value, 80).split("/").at(-1) || "";
  return /^A\d+$/.test(id) ? id : "";
}

function semanticScholarId(value: unknown) {
  return clean(value, 160);
}

function orcidId(value: unknown) {
  const id = clean(value, 160)
    .replace(/^https?:\/\/orcid\.org\//i, "")
    .toUpperCase();
  return /^\d{4}-\d{4}-\d{4}-[\dX]{4}$/.test(id) ? id : "";
}

function scholarSubscriptionId(value: Partial<Scholar>, label: string) {
  const stored = clean(value.subscriptionId, 220);
  if (stored) return stored;
  const openAlex = Array.isArray(value.openAlexIds)
    ? value.openAlexIds.map(openAlexId).find(Boolean)
    : "";
  const semantic = Array.isArray(value.semanticScholarIds)
    ? value.semanticScholarIds.map(semanticScholarId).find(Boolean)
    : "";
  const orcid = orcidId(value.orcid);
  return (
    (orcid && `orcid:${orcid}`) ||
    (openAlex && `openalex:${openAlex}`) ||
    (semantic && `semantic:${semantic}`) ||
    `legacy:${label.toLowerCase()}:${clean(value.institution).toLowerCase()}`
  );
}

function legacyScholar(name: string): Scholar {
  const known = DEFAULT_SCHOLARS.find((item) => {
    const normalized = name.toLowerCase().replace(/^c\.\s*/, "");
    return item.label.toLowerCase().replace(/^c\.\s*/, "") === normalized;
  });
  return known || {
    subscriptionId: `legacy:${name.toLowerCase()}`,
    label: name,
    openAlexIds: [],
    semanticScholarIds: [],
    institution: "单位待确认",
    institutions: [],
    aliases: [],
    trackingStatus: "limited",
    followedAt: new Date().toISOString(),
  };
}

function validateSubscriptions(input: unknown): Subscriptions {
  if (!input || typeof input !== "object") return DEFAULT_SUBSCRIPTIONS;
  const value = input as Partial<Subscriptions>;
  const journal = Array.isArray(value.journal)
    ? value.journal
        .slice(0, 20)
        .map((item) => ({
          label: clean(item?.label),
          issn: clean(item?.issn, 30),
          followedAt: cleanTimestamp(item?.followedAt),
        }))
        .filter((item) => item.label && item.issn)
    : [];
  const scholar = Array.isArray(value.scholar)
    ? value.scholar
        .slice(0, 30)
        .map((item) => {
          if (typeof item === "string") return legacyScholar(clean(item));
          const value = item as Partial<Scholar>;
          const label = clean(value.label);
          if (!label) return null;
          const ids = Array.isArray(value.openAlexIds)
            ? value.openAlexIds.map(openAlexId).filter(Boolean)
            : [];
          const semanticIds = Array.isArray(value.semanticScholarIds)
            ? value.semanticScholarIds
                .map(semanticScholarId)
                .filter(Boolean)
            : [];
          const orcid = orcidId(value.orcid) || undefined;
          const institutions = Array.isArray(value.institutions)
            ? value.institutions
                .slice(0, 12)
                .map((item) => clean(item, 240))
                .filter(Boolean)
            : [];
          const institution =
            clean(value.institution) ||
            institutions[0] ||
            "单位待确认";
          return {
            subscriptionId: scholarSubscriptionId(value, label),
            label,
            aliases: Array.isArray(value.aliases)
              ? value.aliases
                  .slice(0, 16)
                  .map((item) => clean(item, 180))
                  .filter(Boolean)
              : [],
            openAlexIds: ids,
            semanticScholarIds: semanticIds,
            institution,
            institutions: [
              ...new Set([institution, ...institutions].filter(Boolean)),
            ],
            profileUrl: clean(value.profileUrl, 300) || undefined,
            profileUrls: Array.isArray(value.profileUrls)
              ? value.profileUrls
                  .slice(0, 12)
                  .map((item) => clean(item, 600))
                  .filter(Boolean)
              : undefined,
            orcid,
            worksCount:
              typeof value.worksCount === "number" ? value.worksCount : undefined,
            researchAreas: Array.isArray(value.researchAreas)
              ? value.researchAreas
                  .slice(0, 8)
                  .map((area) => clean(area, 160))
                  .filter(Boolean)
              : undefined,
            verifiedWorkDois: Array.isArray(value.verifiedWorkDois)
              ? value.verifiedWorkDois
                  .slice(0, 120)
                  .map((item) =>
                    clean(item, 300)
                      .replace(/^https?:\/\/doi\.org\//i, "")
                      .toLowerCase(),
                  )
                  .filter(Boolean)
              : undefined,
            sources: Array.isArray(value.sources)
              ? value.sources
                  .slice(0, 8)
                  .map((item) => clean(item, 80))
                  .filter(Boolean)
              : undefined,
            trackingStatus:
              ids.length || semanticIds.length || orcid
                ? "verified"
                : "limited",
            followedAt: cleanTimestamp(value.followedAt),
            identityCheckedAt:
              clean(value.identityCheckedAt) &&
              Number.isFinite(Date.parse(clean(value.identityCheckedAt)))
                ? clean(value.identityCheckedAt)
                : undefined,
            mergedRecordCount:
              typeof value.mergedRecordCount === "number"
                ? Math.max(1, Math.floor(value.mergedRecordCount))
                : 1,
            mergeConfidence:
              value.mergeConfidence === "verified" ||
              value.mergeConfidence === "high" ||
              value.mergeConfidence === "unconfirmed"
                ? value.mergeConfidence
                : orcid
                  ? "verified"
                  : ids.length || semanticIds.length
                    ? "high"
                    : "unconfirmed",
            mergeEvidence: Array.isArray(value.mergeEvidence)
              ? value.mergeEvidence
                  .slice(0, 20)
                  .map((item) => clean(item, 160))
                  .filter(Boolean)
              : [],
          };
        })
        .filter((item): item is Scholar => Boolean(item))
    : [];
  const keyword = Array.isArray(value.keyword)
    ? value.keyword
        .slice(0, 30)
        .map(validateKeywordGroup)
        .filter((item): item is KeywordGroup => Boolean(item))
        .filter(
          (item, index, all) =>
            all.findIndex((candidate) => candidate.root === item.root) === index,
        )
    : [];
  return { journal, scholar, keyword };
}

function normalizeText(value: unknown = "") {
  if (typeof value !== "string") return "";
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&#x2010;/gi, "‐")
    .replace(/&#x2013;/gi, "–")
    .replace(/&#x2014;/gi, "—")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedPersonName(value: unknown) {
  return normalizeText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

function distinctivePersonName(value: unknown) {
  const tokens = normalizedPersonName(value).split(/\s+/).filter(Boolean);
  const hasCompoundSurname =
    /[\p{L}]{2,}[-‐‑‒–—][\p{L}]{4,}/u.test(normalizeText(value));
  return (
    tokens.length >= 2 &&
    tokens.join("").length >= 10 &&
    (tokens.some((token) => token.length >= 8) || hasCompoundSurname)
  );
}

function normalizedEvidenceText(value: unknown) {
  return normalizeText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .toLowerCase()
    .trim();
}

function abstractFromIndex(index?: Record<string, number[]>) {
  if (!index || typeof index !== "object") return undefined;
  const positioned: [number, string][] = [];
  for (const [word, positions] of Object.entries(index)) {
    if (!Array.isArray(positions)) continue;
    for (const position of positions) positioned.push([position, word]);
  }
  const abstract = positioned
    .sort((a, b) => a[0] - b[0])
    .map((item) => item[1])
    .join(" ");
  return normalizeText(abstract).slice(0, 6000) || undefined;
}

function typeLabel(value = "") {
  const labels: Record<string, string> = {
    "journal-article": "期刊论文",
    article: "期刊论文",
    book: "专著",
    monograph: "专著",
    "book-chapter": "书籍章节",
    "posted-content": "预印本",
    proceedings: "会议论文",
    "proceedings-article": "会议论文",
    dissertation: "学位论文",
    report: "报告",
  };
  return labels[value] || "学术成果";
}

function toArticle(work: OpenAlexWork, match: Match): Article | null {
  const title = normalizeText(work.title || work.display_name);
  if (!title) return null;
  const doi = work.doi?.replace(/^https?:\/\/doi\.org\//i, "").toLowerCase();
  const url =
    work.doi ||
    work.primary_location?.landing_page_url ||
    work.id ||
    "https://openalex.org";
  const keywords = [
    ...(work.keywords || []),
    ...(work.topics || []),
    ...(work.concepts || []),
  ]
    .map((item) => normalizeText(item.display_name))
    .filter(Boolean)
    .filter((item, index, all) => all.indexOf(item) === index)
    .slice(0, 18);
  return {
    id: doi || work.id || title.toLowerCase(),
    doi,
    title,
    authors: (work.authorships || []).flatMap((item): ArticleAuthor[] => {
        const name = normalizeText(item.author?.display_name);
        if (!name) return [];
        return [{
          name,
          openAlexId: openAlexId(item.author?.id) || undefined,
          orcid: orcidId(item.author?.orcid) || undefined,
        }];
      }),
    venue:
      normalizeText(work.primary_location?.source?.display_name) || match.label,
    publishedAt:
      work.publication_date ||
      (work.publication_year ? `${work.publication_year}-01-01` : "1900-01-01"),
    type: typeLabel(work.type_crossref || work.type),
    url,
    abstract: abstractFromIndex(work.abstract_inverted_index),
    keywords,
    matches: [match],
  };
}

async function openAlex<T>(url: URL): Promise<T> {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "AnthropologyCanteen/1.1.1",
    },
    signal: AbortSignal.timeout(18_000),
  });
  if (!response.ok) throw new Error(`OpenAlex ${response.status}`);
  return response.json() as Promise<T>;
}

async function fetchWorks(url: URL, match: Match) {
  const data = await openAlex<{ results?: OpenAlexWork[] }>(url);
  return (data.results || [])
    .map((work) => {
      try {
        return toArticle(work, match);
      } catch {
        return null;
      }
    })
    .filter((item): item is Article => Boolean(item));
}

function semanticScholarArticle(
  paper: SemanticScholarPaper,
  match: Match,
): Article | null {
  const title = normalizeText(paper.title);
  if (!title) return null;
  const doi = clean(paper.externalIds?.DOI, 300)
    .replace(/^https?:\/\/doi\.org\//i, "")
    .toLowerCase() || undefined;
  const paperId = clean(paper.paperId, 220);
  const publishedAt =
    clean(paper.publicationDate, 40) ||
    (paper.year ? `${paper.year}-01-01` : "1900-01-01");
  return {
    id: doi || paperId || title.toLowerCase(),
    doi,
    title,
    authors: (paper.authors || []).flatMap((author): ArticleAuthor[] => {
        const name = normalizeText(author.name);
        if (!name) return [];
        return [{
          name,
          semanticScholarId: clean(author.authorId, 160) || undefined,
          orcid: orcidId(author.externalIds?.ORCID) || undefined,
        }];
      }),
    venue: normalizeText(paper.venue) || match.label,
    publishedAt,
    type: typeLabel(paper.publicationTypes?.[0]?.toLowerCase()),
    url:
      clean(paper.url, 1000) ||
      (paperId
        ? `https://www.semanticscholar.org/paper/${paperId}`
        : doi
          ? `https://doi.org/${doi}`
          : "https://www.semanticscholar.org"),
    abstract: normalizeText(paper.abstract).slice(0, 6000) || undefined,
    keywords: (paper.fieldsOfStudy || [])
      .map((item) => normalizeText(item))
      .filter(Boolean)
      .slice(0, 18),
    matches: [match],
  };
}

async function fetchSemanticScholarWorks(
  scholar: Scholar,
  semanticId: string,
  limit: number,
) {
  const url = new URL(
    `https://api.semanticscholar.org/graph/v1/author/${encodeURIComponent(semanticId)}/papers`,
  );
  url.searchParams.set("limit", String(Math.min(limit, 100)));
  url.searchParams.set(
    "fields",
    "title,abstract,year,publicationDate,venue,url,publicationTypes,externalIds,fieldsOfStudy,authors.authorId,authors.name",
  );
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "AnthropologyCanteen/1.1.1",
    },
    signal: AbortSignal.timeout(18_000),
  });
  if (!response.ok) throw new Error(`Semantic Scholar ${response.status}`);
  const data = (await response.json()) as {
    data?: SemanticScholarPaper[];
  };
  const match: Match = { kind: "scholar", label: scholar.label };
  return (data.data || [])
    .map((paper) => semanticScholarArticle(paper, match))
    .filter((item): item is Article => Boolean(item));
}

function crossrefDate(work: CrossrefWork) {
  const parts =
    work.published?.["date-parts"]?.[0] ||
    work.issued?.["date-parts"]?.[0];
  if (parts?.length) {
    const [year, month = 1, day = 1] = parts;
    if (Number.isFinite(year)) {
      return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  const created = clean(work.created?.["date-time"], 40);
  return created ? created.slice(0, 10) : "1900-01-01";
}

function crossrefArticle(work: CrossrefWork, match: Match): Article | null {
  const title = normalizeText(work.title?.[0]);
  if (!title) return null;
  const doi = clean(work.DOI, 300).toLowerCase() || undefined;
  const authors = (work.author || []).flatMap((author): ArticleAuthor[] => {
      const name = normalizeText(
        author.name || [author.given, author.family].filter(Boolean).join(" "),
      );
      if (!name) return [];
      return [{
        name,
        orcid: orcidId(author.ORCID) || undefined,
      }];
    });
  return {
    id: doi || clean(work.URL, 800) || title.toLowerCase(),
    doi,
    title,
    authors,
    venue: normalizeText(work["container-title"]?.[0]) || match.label,
    publisher: normalizeText(work.publisher) || undefined,
    publishedAt: crossrefDate(work),
    type: typeLabel(work.type),
    url: doi ? `https://doi.org/${doi}` : clean(work.URL, 1000),
    abstract: normalizeText(work.abstract).slice(0, 6000) || undefined,
    keywords: (work.subject || [])
      .map((item) => normalizeText(item))
      .filter(Boolean)
      .slice(0, 18),
    matches: [match],
  };
}

async function fetchCrossrefJournalWorks(
  journal: Journal,
  fromDate: string,
  match: Match,
) {
  const url = new URL(
    `https://api.crossref.org/journals/${encodeURIComponent(journal.issn)}/works`,
  );
  url.searchParams.set("filter", `from-pub-date:${fromDate}`);
  url.searchParams.set("rows", "20");
  url.searchParams.set("sort", "published");
  url.searchParams.set("order", "desc");
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "AnthropologyCanteen/1.1.1",
    },
    signal: AbortSignal.timeout(18_000),
  });
  if (!response.ok) throw new Error(`Crossref ${response.status}`);
  const data = (await response.json()) as {
    message?: { items?: CrossrefWork[] };
  };
  return (data.message?.items || [])
    .map((work) => {
      try {
        return crossrefArticle(work, match);
      } catch {
        return null;
      }
    })
    .filter((item): item is Article => Boolean(item));
}

function crossrefAuthorName(
  author: NonNullable<CrossrefWork["author"]>[number],
) {
  return normalizeText(
    author.name || [author.given, author.family].filter(Boolean).join(" "),
  );
}

function crossrefWorkMatchesScholar(
  work: CrossrefWork,
  scholar: Scholar,
) {
  const names = [scholar.label, ...(scholar.aliases || [])]
    .map(normalizedPersonName)
    .filter(Boolean);
  const seedDois = new Set(
    (scholar.verifiedWorkDois || []).map((doi) =>
      clean(doi, 300)
        .replace(/^https?:\/\/doi\.org\//i, "")
        .toLowerCase(),
    ),
  );
  const doi = clean(work.DOI, 300).toLowerCase();
  const institutions = (scholar.institutions || [scholar.institution])
    .map(normalizedEvidenceText)
    .filter(
      (item) =>
        item &&
        !["单位待确认", "未收录单位", "作品未收录单位"].some(
          (placeholder) => normalizedEvidenceText(placeholder) === item,
        ),
    );
  const topics = (scholar.researchAreas || [])
    .map(normalizedEvidenceText)
    .filter((item) => item.length >= 4);

  return (work.author || []).some((author) => {
    const authorName = crossrefAuthorName(author);
    const canonical = normalizedPersonName(authorName);
    if (!canonical || !names.includes(canonical)) return false;
    const authorOrcid = orcidId(author.ORCID);
    if (scholar.orcid && authorOrcid) return scholar.orcid === authorOrcid;
    if (doi && seedDois.has(doi)) return true;
    const affiliations = (author.affiliation || [])
      .map((item) => normalizedEvidenceText(item.name))
      .filter(Boolean);
    if (
      institutions.some((institution) =>
        affiliations.some(
          (affiliation) =>
            affiliation.includes(institution) ||
            institution.includes(affiliation),
        ),
      )
    ) {
      return true;
    }
    const subjectText = normalizedEvidenceText([
      ...(work.subject || []),
      ...(work.title || []),
      ...(work["container-title"] || []),
    ].join(" "));
    if (
      topics.some(
        (topic) =>
          subjectText.includes(topic) ||
          topic
            .split(/\s+/)
            .filter((token) => token.length >= 5)
            .some((token) => subjectText.includes(token)),
      )
    ) {
      return true;
    }
    return distinctivePersonName(authorName);
  });
}

async function fetchCrossrefScholarWorks(
  scholar: Scholar,
  limit: number,
) {
  const queries = [
    scholar.label,
    ...(scholar.aliases || []),
  ]
    .map((item) => normalizeText(item))
    .filter((item, index, all) => item && all.indexOf(item) === index)
    .slice(0, 3);
  const settled = await Promise.allSettled(
    queries.map(async (query) => {
      const url = new URL("https://api.crossref.org/works");
      url.searchParams.set("query.author", query);
      url.searchParams.set("rows", String(Math.min(Math.max(limit, 30), 100)));
      url.searchParams.set("sort", "published");
      url.searchParams.set("order", "desc");
      const response = await fetch(url, {
        headers: {
          accept: "application/json",
          "user-agent": "AnthropologyCanteen/1.1.1",
        },
        signal: AbortSignal.timeout(18_000),
      });
      if (!response.ok) throw new Error(`Crossref ${response.status}`);
      const data = (await response.json()) as {
        message?: { items?: CrossrefWork[] };
      };
      return data.message?.items || [];
    }),
  );
  const works = settled.flatMap((result) =>
    result.status === "fulfilled" ? result.value : [],
  );
  if (
    !works.length &&
    settled.length &&
    settled.every((result) => result.status === "rejected")
  ) {
    throw new Error("Crossref unavailable");
  }
  const match: Match = { kind: "scholar", label: scholar.label };
  return works
    .filter((work) => crossrefWorkMatchesScholar(work, scholar))
    .map((work) => crossrefArticle(work, match))
    .filter((article): article is Article => Boolean(article));
}

async function fetchJournalWorks(journal: Journal, fromDate: string) {
  const match: Match = { kind: "journal", label: journal.label };
  let openAlexFailure: unknown;
  try {
    const items = await fetchWorks(
      worksUrl(
        [
          `primary_location.source.issn:${journal.issn}`,
          `from_publication_date:${fromDate}`,
        ],
        20,
      ),
      match,
    );
    if (items.length) return items;
  } catch (error) {
    openAlexFailure = error;
  }

  try {
    return await fetchCrossrefJournalWorks(journal, fromDate, match);
  } catch (crossrefFailure) {
    throw openAlexFailure || crossrefFailure;
  }
}

function stringOverlap(left: string[] = [], right: string[] = []) {
  const values = new Set(left.filter(Boolean));
  return right.some((item) => item && values.has(item));
}

function evidenceListOverlap(left: string[] = [], right: string[] = []) {
  const leftValues = left.map(normalizedEvidenceText).filter(Boolean);
  const rightValues = right.map(normalizedEvidenceText).filter(Boolean);
  return leftValues.some((leftValue) =>
    rightValues.some((rightValue) => {
      const shorter =
        leftValue.length <= rightValue.length ? leftValue : rightValue;
      const longer =
        leftValue.length > rightValue.length ? leftValue : rightValue;
      return (
        leftValue === rightValue ||
        (shorter.length >= 8 && longer.includes(shorter))
      );
    }),
  );
}

function candidateMatchesScholar(
  candidate: ScholarCandidate,
  scholar: Scholar,
) {
  if (
    candidate.orcid &&
    scholar.orcid &&
    candidate.orcid !== scholar.orcid
  ) {
    return false;
  }
  if (candidate.orcid && candidate.orcid === scholar.orcid) return true;
  if (stringOverlap(candidate.openAlexIds, scholar.openAlexIds)) return true;
  if (
    stringOverlap(
      candidate.semanticScholarIds,
      scholar.semanticScholarIds || [],
    )
  ) {
    return true;
  }
  if (
    stringOverlap(
      candidate.verifiedWorkDois,
      scholar.verifiedWorkDois || [],
    )
  ) {
    return true;
  }
  if (
    normalizedPersonName(candidate.label) !==
      normalizedPersonName(scholar.label) ||
    !distinctivePersonName(scholar.label)
  ) {
    return false;
  }
  return (
    evidenceListOverlap(
      candidate.institutions,
      scholar.institutions || [scholar.institution],
    ) ||
    evidenceListOverlap(
      candidate.researchAreas,
      scholar.researchAreas || [],
    )
  );
}

function earliestTimestamp(left?: string, right?: string) {
  const values = [left, right]
    .filter((value): value is string => Boolean(value))
    .filter((value) => Number.isFinite(Date.parse(value)));
  return values.sort(
    (a, b) => Date.parse(a) - Date.parse(b),
  )[0] || new Date().toISOString();
}

function latestTimestamp(left?: string, right?: string) {
  return [left, right]
    .filter((value): value is string => Boolean(value))
    .filter((value) => Number.isFinite(Date.parse(value)))
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
}

function scholarFromCandidate(
  scholar: Scholar,
  candidate: ScholarCandidate,
): Scholar {
  const openAlexIds = [
    ...new Set([...scholar.openAlexIds, ...candidate.openAlexIds]),
  ];
  const semanticScholarIds = [
    ...new Set([
      ...(scholar.semanticScholarIds || []),
      ...candidate.semanticScholarIds,
    ]),
  ];
  const orcid = scholar.orcid || candidate.orcid;
  const institutions = [
    ...new Set([
      scholar.institution,
      ...(scholar.institutions || []),
      ...candidate.institutions,
    ].filter(Boolean)),
  ];
  const subscriptionId =
    (orcid && `orcid:${orcid}`) ||
    (openAlexIds[0] && `openalex:${openAlexIds[0]}`) ||
    (semanticScholarIds[0] &&
      `semantic:${semanticScholarIds[0]}`) ||
    scholar.subscriptionId;
  return {
    ...scholar,
    subscriptionId,
    label: candidate.label || scholar.label,
    aliases: [
      ...new Set([
        ...(scholar.aliases || []),
        scholar.label,
        ...candidate.aliases,
      ].filter(
        (name) =>
          name &&
          normalizedPersonName(name) !==
            normalizedPersonName(candidate.label),
      )),
    ],
    openAlexIds,
    semanticScholarIds,
    institution:
      candidate.institution !== "未收录单位"
        ? candidate.institution
        : scholar.institution,
    institutions,
    profileUrl: candidate.profileUrl || scholar.profileUrl,
    profileUrls: [
      ...new Set([
        ...(scholar.profileUrls || []),
        ...candidate.profileUrls,
      ]),
    ],
    orcid,
    worksCount: Math.max(
      scholar.worksCount || 0,
      candidate.worksCount || 0,
    ) || undefined,
    researchAreas: [
      ...new Set([
        ...(scholar.researchAreas || []),
        ...candidate.researchAreas,
      ]),
    ].slice(0, 12),
    verifiedWorkDois: [
      ...new Set([
        ...(scholar.verifiedWorkDois || []),
        ...candidate.verifiedWorkDois,
      ]),
    ].slice(0, 120),
    sources: [
      ...new Set([...(scholar.sources || []), ...candidate.sources]),
    ],
    trackingStatus:
      openAlexIds.length || semanticScholarIds.length || orcid
        ? "verified"
        : "limited",
    followedAt: scholar.followedAt,
    identityCheckedAt: new Date().toISOString(),
    mergedRecordCount: Math.max(
      scholar.mergedRecordCount || 1,
      candidate.mergedRecordCount,
    ),
    mergeConfidence: candidate.mergeConfidence,
    mergeEvidence: [
      ...new Set([
        ...(scholar.mergeEvidence || []),
        ...candidate.mergeEvidence,
      ]),
    ],
  };
}

async function resolveScholar(scholar: Scholar): Promise<Scholar> {
  const checkedAt = Date.parse(scholar.identityCheckedAt || "");
  if (
    Number.isFinite(checkedAt) &&
    Date.now() - checkedAt < 7 * 24 * 60 * 60 * 1000
  ) {
    return scholar;
  }
  const search = await searchScholars({
    query: scholar.label,
    mode: "name",
    institution: scholar.institution,
    topic: scholar.researchAreas?.[0] || "",
  });
  const candidate = search.results.find((item) =>
    candidateMatchesScholar(item, scholar),
  );
  return candidate ? scholarFromCandidate(scholar, candidate) : scholar;
}

function sameResolvedScholar(left: Scholar, right: Scholar) {
  if (left.orcid && right.orcid && left.orcid !== right.orcid) return false;
  if (left.orcid && left.orcid === right.orcid) return true;
  if (stringOverlap(left.openAlexIds, right.openAlexIds)) return true;
  if (
    stringOverlap(
      left.semanticScholarIds || [],
      right.semanticScholarIds || [],
    )
  ) {
    return true;
  }
  if (
    stringOverlap(
      left.verifiedWorkDois || [],
      right.verifiedWorkDois || [],
    )
  ) {
    return true;
  }
  return (
    normalizedPersonName(left.label) ===
      normalizedPersonName(right.label) &&
    distinctivePersonName(left.label) &&
    (evidenceListOverlap(
      left.institutions || [left.institution],
      right.institutions || [right.institution],
    ) ||
      evidenceListOverlap(
        left.researchAreas || [],
        right.researchAreas || [],
      ))
  );
}

function mergeResolvedScholar(left: Scholar, right: Scholar): Scholar {
  const openAlexIds = [...new Set([
    ...left.openAlexIds,
    ...right.openAlexIds,
  ])];
  const semanticScholarIds = [...new Set([
    ...(left.semanticScholarIds || []),
    ...(right.semanticScholarIds || []),
  ])];
  const orcid = left.orcid || right.orcid;
  const institutions = [...new Set([
    left.institution,
    ...(left.institutions || []),
    right.institution,
    ...(right.institutions || []),
  ].filter(Boolean))];
  return {
    ...left,
    subscriptionId:
      (orcid && `orcid:${orcid}`) ||
      (openAlexIds[0] && `openalex:${openAlexIds[0]}`) ||
      (semanticScholarIds[0] &&
        `semantic:${semanticScholarIds[0]}`) ||
      left.subscriptionId,
    aliases: [...new Set([
      ...(left.aliases || []),
      right.label,
      ...(right.aliases || []),
    ])],
    openAlexIds,
    semanticScholarIds,
    institution:
      left.institution !== "单位待确认"
        ? left.institution
        : right.institution,
    institutions,
    profileUrl: left.profileUrl || right.profileUrl,
    profileUrls: [...new Set([
      ...(left.profileUrls || []),
      ...(right.profileUrls || []),
    ])],
    orcid,
    worksCount: Math.max(left.worksCount || 0, right.worksCount || 0) ||
      undefined,
    researchAreas: [...new Set([
      ...(left.researchAreas || []),
      ...(right.researchAreas || []),
    ])].slice(0, 12),
    verifiedWorkDois: [...new Set([
      ...(left.verifiedWorkDois || []),
      ...(right.verifiedWorkDois || []),
    ])].slice(0, 120),
    sources: [...new Set([
      ...(left.sources || []),
      ...(right.sources || []),
    ])],
    trackingStatus:
      openAlexIds.length || semanticScholarIds.length || orcid
        ? "verified"
        : "limited",
    followedAt: earliestTimestamp(left.followedAt, right.followedAt),
    identityCheckedAt: latestTimestamp(
      left.identityCheckedAt,
      right.identityCheckedAt,
    ),
    mergedRecordCount: Math.max(
      left.mergedRecordCount || 1,
      right.mergedRecordCount || 1,
    ),
    mergeConfidence:
      left.mergeConfidence === "verified" ||
      right.mergeConfidence === "verified"
        ? "verified"
        : "high",
    mergeEvidence: [...new Set([
      ...(left.mergeEvidence || []),
      ...(right.mergeEvidence || []),
    ])],
  };
}

function mergeResolvedScholars(scholars: Scholar[]) {
  const merged: Scholar[] = [];
  for (const scholar of scholars) {
    const index = merged.findIndex((item) =>
      sameResolvedScholar(item, scholar),
    );
    if (index < 0) merged.push(scholar);
    else merged[index] = mergeResolvedScholar(merged[index], scholar);
  }
  return merged;
}

function worksUrl(filters: string[], perPage: number) {
  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("filter", filters.join(","));
  url.searchParams.set("per-page", String(perPage));
  url.searchParams.set("sort", "publication_date:desc");
  return url;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function keywordMatches(text: string, keyword: string) {
  const source = keywordVariantSource(keyword);
  if (!source) return false;
  try {
    return new RegExp(
      `(?<!\\p{L})(?:${source})(?!\\p{L})`,
      "iu",
    ).test(text);
  } catch {
    return text.toLowerCase().includes(keyword.toLowerCase());
  }
}

function mergeArticles(
  groups: Article[][],
  keywords: KeywordGroup[],
  limit = 100,
) {
  const merged = new Map<string, Article>();
  for (const group of groups) {
    for (const article of group) {
      const current = merged.get(article.id);
      if (!current) {
        merged.set(article.id, article);
        continue;
      }
      const matches = [...current.matches];
      for (const match of article.matches) {
        if (
          !matches.some(
            (candidate) =>
              candidate.kind === match.kind && candidate.label === match.label,
          )
        ) {
          matches.push(match);
        }
      }
      merged.set(article.id, {
        ...current,
        abstract: current.abstract || article.abstract,
        authors: [...current.authors, ...article.authors].filter(
          (author, index, all) =>
            all.findIndex(
              (candidate) =>
                (author.orcid &&
                  candidate.orcid === author.orcid) ||
                (author.openAlexId &&
                  candidate.openAlexId === author.openAlexId) ||
                (author.semanticScholarId &&
                  candidate.semanticScholarId === author.semanticScholarId) ||
                (!author.orcid &&
                  !author.openAlexId &&
                  !author.semanticScholarId &&
                  candidate.name.toLowerCase() === author.name.toLowerCase()),
            ) === index,
        ),
        keywords: [...(current.keywords || []), ...(article.keywords || [])]
          .filter((item, index, all) => all.indexOf(item) === index)
          .slice(0, 18),
        matches,
      });
    }
  }

  return [...merged.values()]
    .filter((article) => new Date(article.publishedAt).getUTCFullYear() > 1900)
    .map((article) => {
      const searchable = [
        article.title,
        article.abstract || "",
        ...(article.keywords || []),
      ].join(" ");
      const matches = [...article.matches];
      for (const keyword of keywords) {
        const label = keywordGroupLabel(keyword);
        if (
          keyword.variants.some((variant) =>
            keywordMatches(searchable, variant),
          ) &&
          !matches.some(
            (match) => match.kind === "keyword" && match.label === label,
          )
        ) {
          matches.push({
            kind: "keyword",
            label,
            terms: keyword.variants,
          });
        }
      }
      return { ...article, matches };
    })
    .sort(
      (a, b) =>
        new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
    )
    .slice(0, limit);
}

async function buildFeed(
  subscriptions: Subscriptions,
  historyScholar?: string,
) {
  const jobs: Promise<Article[]>[] = [];
  const resolvedScholars = mergeResolvedScholars(
    await Promise.all(
      subscriptions.scholar.map((scholar) =>
        resolveScholar(scholar).catch(() => scholar),
      ),
    ),
  );

  if (historyScholar) {
    const scholar = resolvedScholars.find(
      (item) =>
        item.subscriptionId === historyScholar ||
        item.label.toLowerCase() === historyScholar.toLowerCase(),
    );
    if (scholar) {
      for (const id of scholar.openAlexIds) {
        jobs.push(
          fetchWorks(worksUrl([`author.id:${id}`], 100), {
            kind: "scholar",
            label: scholar.label,
          }),
        );
      }
      for (const id of scholar.semanticScholarIds || []) {
        jobs.push(fetchSemanticScholarWorks(scholar, id, 100));
      }
      jobs.push(fetchCrossrefScholarWorks(scholar, 100));
    }
  } else {
    const since = new Date();
    since.setUTCMonth(since.getUTCMonth() - 30);
    const fromDate = since.toISOString().slice(0, 10);

    for (const journal of subscriptions.journal) {
      jobs.push(fetchJournalWorks(journal, fromDate));
    }
    for (const scholar of resolvedScholars) {
      for (const id of scholar.openAlexIds) {
        jobs.push(
          fetchWorks(
            worksUrl([`author.id:${id}`], 18),
            { kind: "scholar", label: scholar.label },
          ),
        );
      }
      for (const id of scholar.semanticScholarIds || []) {
        jobs.push(fetchSemanticScholarWorks(scholar, id, 20));
      }
      jobs.push(fetchCrossrefScholarWorks(scholar, 40));
    }
  }

  const settled = await Promise.allSettled(jobs);
  const groups = settled
    .filter(
      (result): result is PromiseFulfilledResult<Article[]> =>
        result.status === "fulfilled",
    )
    .map((result) => result.value);
  const curatedScholars = historyScholar
    ? resolvedScholars.filter(
        (item) =>
          item.subscriptionId === historyScholar ||
          item.label.toLowerCase() === historyScholar.toLowerCase(),
      )
    : resolvedScholars;
  for (const scholar of curatedScholars) {
    const curated = curatedWorks(scholar);
    if (curated.length) groups.push(curated);
  }
  return {
    items: mergeArticles(
      groups,
      subscriptions.keyword,
      historyScholar ? 180 : 120,
    ),
    failures: settled.filter((result) => result.status === "rejected").length,
    scholars: resolvedScholars,
  };
}

function response(
  items: Article[],
  failures: number,
  scholars: Scholar[],
  historyScholar?: string,
) {
  return NextResponse.json(
    {
      items,
      updatedAt: new Date().toISOString(),
      source: "live",
      historyScholar,
      scholars,
      warnings:
        failures > 0
          ? [`${failures} 个数据查询暂时失败，其他来源仍正常显示。`]
          : [],
    },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function GET() {
  const { items, failures, scholars } =
    await buildFeed(DEFAULT_SUBSCRIPTIONS);
  return response(items, failures, scholars);
}

export async function POST(request: NextRequest) {
  let payload: { subscriptions?: unknown; historyScholar?: unknown } = {};
  try {
    payload = await request.json();
  } catch {
    // Use starter subscriptions for malformed bodies.
  }
  const subscriptions = validateSubscriptions(payload.subscriptions);
  const requestedScholar = clean(payload.historyScholar);
  const historyScholar = requestedScholar || undefined;
  const { items, failures, scholars } = await buildFeed(
    subscriptions,
    historyScholar,
  );
  return response(items, failures, scholars, historyScholar);
}
