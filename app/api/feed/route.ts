import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type MatchKind = "journal" | "scholar" | "keyword";
type Match = { kind: MatchKind; label: string; terms?: string[] };
type Journal = { label: string; issn: string };
type KeywordGroup = { root: string; variants: string[] };
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
    author?: { id?: string; display_name?: string };
  }[];
  primary_location?: {
    source?: { display_name?: string; issn_l?: string };
    landing_page_url?: string;
  };
  keywords?: { display_name?: string }[];
  topics?: { display_name?: string }[];
  concepts?: { display_name?: string }[];
};

type OpenAlexAuthor = {
  id?: string;
  display_name?: string;
  orcid?: string;
  works_count?: number;
  last_known_institutions?: { display_name?: string }[];
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
  }[];
  published?: { "date-parts"?: number[][] };
  issued?: { "date-parts"?: number[][] };
  created?: { "date-time"?: string };
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

function legacyScholar(name: string): Scholar {
  const known = DEFAULT_SCHOLARS.find((item) => {
    const normalized = name.toLowerCase().replace(/^c\.\s*/, "");
    return item.label.toLowerCase().replace(/^c\.\s*/, "") === normalized;
  });
  return known || {
    label: name,
    openAlexIds: [],
    institution: "单位待确认",
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
          return {
            label,
            openAlexIds: ids,
            institution: clean(value.institution) || "单位待确认",
            profileUrl: clean(value.profileUrl, 300) || undefined,
            orcid: clean(value.orcid, 120) || undefined,
            worksCount:
              typeof value.worksCount === "number" ? value.worksCount : undefined,
            researchAreas: Array.isArray(value.researchAreas)
              ? value.researchAreas
                  .slice(0, 8)
                  .map((area) => clean(area, 160))
                  .filter(Boolean)
              : undefined,
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
    authors: (work.authorships || [])
      .map((item) => normalizeText(item.author?.display_name))
      .filter(Boolean),
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
      "user-agent": "AnthropologyCanteen/0.6",
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
  const authors = (work.author || [])
    .map((author) =>
      normalizeText(
        author.name || [author.given, author.family].filter(Boolean).join(" "),
      ),
    )
    .filter(Boolean);
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
      "user-agent": "AnthropologyCanteen/0.6",
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

async function resolveScholar(scholar: Scholar): Promise<Scholar> {
  if (scholar.openAlexIds.length) return scholar;
  const url = new URL("https://api.openalex.org/authors");
  url.searchParams.set("search", scholar.label);
  url.searchParams.set("per-page", "5");
  const data = await openAlex<{ results?: OpenAlexAuthor[] }>(url);
  const candidate = (data.results || [])[0];
  const id = openAlexId(candidate?.id);
  if (!id) return scholar;
  return {
    ...scholar,
    label: normalizeText(candidate.display_name) || scholar.label,
    openAlexIds: [id],
    institution:
      (candidate.last_known_institutions || [])
        .map((item) => normalizeText(item.display_name))
        .filter(Boolean)
        .join("；") || scholar.institution,
    orcid: candidate.orcid || scholar.orcid,
    worksCount: candidate.works_count,
  };
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
  const resolvedScholars = await Promise.all(
    subscriptions.scholar.map((scholar) =>
      resolveScholar(scholar).catch(() => scholar),
    ),
  );

  if (historyScholar) {
    const scholar = resolvedScholars.find(
      (item) => item.label.toLowerCase() === historyScholar.toLowerCase(),
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
        (item) => item.label.toLowerCase() === historyScholar.toLowerCase(),
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
