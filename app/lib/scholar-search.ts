import { pinyin } from "pinyin-pro";

export type ScholarExternalIds = {
  openAlex?: string;
  semanticScholar?: string;
  orcid?: string;
};

export type ScholarWork = {
  id: string;
  doi?: string;
  title: string;
  year?: number;
  venue?: string;
  url?: string;
};

export type ScholarCandidate = {
  candidateId: string;
  label: string;
  value: string;
  aliases: string[];
  institutions: string[];
  institution: string;
  researchAreas: string[];
  representativeWorks: ScholarWork[];
  verifiedWorkDois: string[];
  externalIds: ScholarExternalIds;
  openAlexIds: string[];
  semanticScholarIds: string[];
  orcid?: string;
  profileUrls: string[];
  profileUrl?: string;
  worksCount?: number;
  sources: string[];
  identityWarnings: string[];
  score: number;
  scoreReasons: string[];
  trackingStatus: "verified" | "limited";
};

type OpenAlexInstitution = {
  id?: string;
  display_name?: string;
  display_name_acronyms?: string[];
  display_name_alternatives?: string[];
};

type OpenAlexAuthor = {
  id?: string;
  display_name?: string;
  display_name_alternatives?: string[];
  raw_author_names?: string[];
  orcid?: string;
  works_count?: number;
  cited_by_count?: number;
  last_known_institutions?: OpenAlexInstitution[];
  affiliations?: {
    institution?: OpenAlexInstitution;
    years?: number[];
  }[];
  topics?: {
    display_name?: string;
    count?: number;
    subfield?: { display_name?: string };
    field?: { display_name?: string };
  }[];
};

type OpenAlexWork = {
  id?: string;
  doi?: string;
  title?: string;
  display_name?: string;
  publication_year?: number;
  publication_date?: string;
  primary_location?: {
    landing_page_url?: string;
    source?: { display_name?: string };
  };
  authorships?: {
    author?: { id?: string; display_name?: string; orcid?: string };
    institutions?: OpenAlexInstitution[];
    raw_author_name?: string;
    raw_affiliation_strings?: string[];
  }[];
  topics?: {
    display_name?: string;
    subfield?: { display_name?: string };
    field?: { display_name?: string };
  }[];
};

type SemanticScholarPaper = {
  paperId?: string;
  title?: string;
  year?: number;
  venue?: string;
  url?: string;
  externalIds?: { DOI?: string; CorpusId?: number };
};

type SemanticScholarAuthor = {
  authorId?: string;
  name?: string;
  aliases?: string[];
  affiliations?: string[];
  paperCount?: number;
  hIndex?: number;
  url?: string;
  externalIds?: { ORCID?: string };
  papers?: SemanticScholarPaper[];
};

type CrossrefAuthor = {
  given?: string;
  family?: string;
  name?: string;
  ORCID?: string;
  affiliation?: { name?: string }[];
};

type CrossrefWork = {
  DOI?: string;
  URL?: string;
  title?: string[];
  author?: CrossrefAuthor[];
  publisher?: string;
  "container-title"?: string[];
  subject?: string[];
  published?: { "date-parts"?: number[][] };
  issued?: { "date-parts"?: number[][] };
};

const USER_AGENT = "AnthropologyCanteen/1.1.0";

function clean(value: unknown, max = 500) {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, max)
    : "";
}

function unique(values: (string | undefined)[]) {
  return [
    ...new Set(values.map((value) => clean(value)).filter(Boolean)),
  ];
}

export function entityId(value: unknown, prefix?: RegExp) {
  const id = clean(value, 160).split("/").filter(Boolean).at(-1) || "";
  return !prefix || prefix.test(id) ? id : "";
}

export function normalizeOrcid(value: unknown) {
  const id = clean(value, 160)
    .replace(/^https?:\/\/orcid\.org\//i, "")
    .toUpperCase();
  return /^\d{4}-\d{4}-\d{4}-[\dX]{4}$/.test(id) ? id : "";
}

function normalizeDoi(value: unknown) {
  return clean(value, 320)
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .toLowerCase();
}

export function normalizeName(value: unknown) {
  return clean(value, 180)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’'`´.-]+/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .toLowerCase()
    .trim();
}

function canonicalPersonName(value: unknown) {
  return normalizeName(value).split(/\s+/).filter(Boolean).sort().join(" ");
}

function distinctivePersonName(value: unknown) {
  const tokens = canonicalPersonName(value).split(/\s+/).filter(Boolean);
  return (
    tokens.length >= 2 &&
    tokens.join("").length >= 10 &&
    tokens.some((token) => token.length >= 8)
  );
}

function comparableName(value: unknown) {
  const tokens = normalizeName(value)
    .split(/\s+/)
    .filter((token) => token.length > 1);
  return tokens.length ? tokens.join(" ") : normalizeName(value);
}

function levenshtein(left: string, right: string) {
  if (left === right) return 0;
  if (!left) return right.length;
  if (!right) return left.length;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    let diagonal = previous[0];
    previous[0] = row;
    for (let column = 1; column <= right.length; column += 1) {
      const above = previous[column];
      previous[column] = Math.min(
        previous[column] + 1,
        previous[column - 1] + 1,
        diagonal + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[right.length];
}

export function nameSimilarity(left: unknown, right: unknown) {
  const a = comparableName(left);
  const b = comparableName(right);
  if (!a || !b) return 0;
  const direct = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  const sortedA = a.split(" ").sort().join(" ");
  const sortedB = b.split(" ").sort().join(" ");
  const reordered =
    1 -
    levenshtein(sortedA, sortedB) /
      Math.max(sortedA.length, sortedB.length);
  return Math.max(direct, reordered);
}

function hasHan(value: string) {
  return /\p{Script=Han}/u.test(value);
}

export function scholarQueryVariants(input: string) {
  const raw = clean(input, 100);
  if (!raw) return [];
  const variants = [raw];
  if (hasHan(raw)) {
    const syllables = pinyin(raw.replace(/[^\p{Script=Han}]/gu, ""), {
      toneType: "none",
      type: "array",
    })
      .map((item) => clean(item))
      .filter(Boolean);
    if (syllables.length) {
      const capitalized = syllables.map(
        (item) => `${item[0]?.toUpperCase() || ""}${item.slice(1)}`,
      );
      const surnameFirst = capitalized.join(" ");
      const givenFirst = [
        ...capitalized.slice(1),
        capitalized[0],
      ].join(" ");
      const compactGiven = capitalized.slice(1).join("");
      variants.push(
        [capitalized[0], compactGiven].filter(Boolean).join(" "),
        [compactGiven, capitalized[0]].filter(Boolean).join(" "),
        surnameFirst,
        givenFirst,
      );
    }
  } else {
    const normalized = normalizeName(raw);
    if (normalized) {
      variants.push(normalized);
      const tokens = normalized.split(" ").filter(Boolean);
      const withoutInitials = tokens.filter((token) => token.length > 1);
      if (withoutInitials.length >= 2) {
        variants.push(withoutInitials.join(" "));
      }
    }
  }
  return unique(variants).slice(0, 6);
}

function fuzzyOpenAlexQuery(value: string) {
  return normalizeName(value)
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => (token.length >= 4 ? `${token}~1` : token))
    .join(" ");
}

function scholarWorkFromOpenAlex(work: OpenAlexWork): ScholarWork | null {
  const title = clean(work.title || work.display_name, 1000);
  if (!title) return null;
  const doi = normalizeDoi(work.doi) || undefined;
  return {
    id: doi || entityId(work.id) || title.toLowerCase(),
    doi,
    title,
    year:
      typeof work.publication_year === "number"
        ? work.publication_year
        : Number.parseInt(clean(work.publication_date).slice(0, 4), 10) ||
          undefined,
    venue: clean(work.primary_location?.source?.display_name) || undefined,
    url:
      clean(work.doi, 1000) ||
      clean(work.primary_location?.landing_page_url, 1000) ||
      clean(work.id, 1000) ||
      undefined,
  };
}

function scholarWorkFromSemantic(work: SemanticScholarPaper): ScholarWork | null {
  const title = clean(work.title, 1000);
  if (!title) return null;
  const doi = normalizeDoi(work.externalIds?.DOI) || undefined;
  return {
    id: doi || clean(work.paperId, 160) || title.toLowerCase(),
    doi,
    title,
    year: typeof work.year === "number" ? work.year : undefined,
    venue: clean(work.venue) || undefined,
    url:
      clean(work.url, 1000) ||
      (work.paperId
        ? `https://www.semanticscholar.org/paper/${work.paperId}`
        : undefined),
  };
}

function crossrefYear(work: CrossrefWork) {
  const parts =
    work.published?.["date-parts"]?.[0] ||
    work.issued?.["date-parts"]?.[0];
  const year = parts?.[0];
  return typeof year === "number" ? year : undefined;
}

function scholarWorkFromCrossref(work: CrossrefWork): ScholarWork | null {
  const title = clean(work.title?.[0], 1000);
  if (!title) return null;
  const doi = normalizeDoi(work.DOI) || undefined;
  return {
    id: doi || clean(work.URL, 1000) || title.toLowerCase(),
    doi,
    title,
    year: crossrefYear(work),
    venue: clean(work["container-title"]?.[0]) || undefined,
    url: doi ? `https://doi.org/${doi}` : clean(work.URL, 1000) || undefined,
  };
}

async function fetchJson<T>(url: URL, source: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": USER_AGENT,
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`${source} ${response.status}`);
  return response.json() as Promise<T>;
}

function emptyCandidate(
  label: string,
  source: string,
  externalIds: ScholarExternalIds,
): ScholarCandidate {
  const openAlex = entityId(externalIds.openAlex, /^A\d+$/);
  const semanticScholar = clean(externalIds.semanticScholar, 160);
  const orcid = normalizeOrcid(externalIds.orcid);
  const candidateId =
    (orcid && `orcid:${orcid}`) ||
    (openAlex && `openalex:${openAlex}`) ||
    (semanticScholar && `semantic:${semanticScholar}`) ||
    `${source.toLowerCase()}:${normalizeName(label)}`;
  return {
    candidateId,
    label,
    value: openAlex || semanticScholar || orcid || candidateId,
    aliases: [],
    institutions: [],
    institution: "未收录单位",
    researchAreas: [],
    representativeWorks: [],
    verifiedWorkDois: [],
    externalIds: {
      openAlex: openAlex || undefined,
      semanticScholar: semanticScholar || undefined,
      orcid: orcid || undefined,
    },
    openAlexIds: openAlex ? [openAlex] : [],
    semanticScholarIds: semanticScholar ? [semanticScholar] : [],
    orcid: orcid || undefined,
    profileUrls: [],
    worksCount: undefined,
    sources: [source],
    identityWarnings: [],
    score: 0,
    scoreReasons: [],
    trackingStatus:
      openAlex || semanticScholar || orcid ? "verified" : "limited",
  };
}

function openAlexCandidate(author: OpenAlexAuthor): ScholarCandidate | null {
  const label = clean(author.display_name);
  const openAlex = entityId(author.id, /^A\d+$/);
  if (!label || !openAlex) return null;
  const candidate = emptyCandidate(label, "OpenAlex", {
    openAlex,
    orcid: author.orcid,
  });
  const affiliations = (author.affiliations || [])
    .slice()
    .sort(
      (left, right) =>
        Math.max(...(right.years || [0])) -
        Math.max(...(left.years || [0])),
    )
    .map((item) => clean(item.institution?.display_name));
  candidate.aliases = unique([
    ...(author.display_name_alternatives || []),
    ...(author.raw_author_names || []),
  ]).filter(
    (item) => normalizeName(item) !== normalizeName(label),
  );
  candidate.institutions = unique([
    ...(author.last_known_institutions || []).map((item) => item.display_name),
    ...affiliations,
  ]);
  candidate.institution = candidate.institutions[0] || "未收录单位";
  candidate.researchAreas = unique(
    (author.topics || [])
      .slice()
      .sort((left, right) => (right.count || 0) - (left.count || 0))
      .flatMap((item) => [
        item.display_name,
        item.subfield?.display_name,
        item.field?.display_name,
      ]),
  ).slice(0, 6);
  candidate.worksCount = author.works_count;
  candidate.profileUrls = unique([
    author.id,
    candidate.orcid ? `https://orcid.org/${candidate.orcid}` : undefined,
  ]);
  candidate.profileUrl = candidate.profileUrls[0];
  const divergentAliases = candidate.aliases.filter(
    (alias) => nameSimilarity(alias, label) < 0.55,
  );
  const likelyMixedIdentity =
    candidate.institutions.length > 12 ||
    divergentAliases.length > 2 ||
    (candidate.aliases.length > 14 && (candidate.worksCount || 0) > 100);
  if (likelyMixedIdentity) {
    candidate.candidateId = `openalex-suspect:${openAlex}:${normalizeName(label)}`;
    candidate.value = candidate.candidateId;
    candidate.openAlexIds = [];
    candidate.orcid = undefined;
    candidate.externalIds = {};
    candidate.trackingStatus = "limited";
    candidate.sources = ["OpenAlex（疑似混合同名记录）"];
    candidate.identityWarnings = [
      "该索引档案包含大量互不相干的姓名、单位或学科，已阻止自动绑定。",
    ];
    candidate.worksCount = undefined;
  }
  return candidate;
}

function semanticCandidate(author: SemanticScholarAuthor): ScholarCandidate | null {
  const label = clean(author.name);
  const semanticScholar = clean(author.authorId, 160);
  if (!label || !semanticScholar) return null;
  const candidate = emptyCandidate(label, "Semantic Scholar", {
    semanticScholar,
    orcid: author.externalIds?.ORCID,
  });
  candidate.aliases = unique(author.aliases || []).filter(
    (item) => normalizeName(item) !== normalizeName(label),
  );
  candidate.institutions = unique(author.affiliations || []);
  candidate.institution = candidate.institutions[0] || "未收录单位";
  candidate.representativeWorks = (author.papers || [])
    .map(scholarWorkFromSemantic)
    .filter((item): item is ScholarWork => Boolean(item))
    .sort((left, right) => (right.year || 0) - (left.year || 0))
    .slice(0, 3);
  candidate.worksCount = author.paperCount;
  candidate.profileUrls = unique([
    author.url,
    `https://www.semanticscholar.org/author/${semanticScholar}`,
    candidate.orcid ? `https://orcid.org/${candidate.orcid}` : undefined,
  ]);
  candidate.profileUrl = candidate.profileUrls[0];
  return candidate;
}

function crossrefAuthorName(author: CrossrefAuthor) {
  return clean(author.name || [author.given, author.family].filter(Boolean).join(" "));
}

function crossrefCandidates(
  works: CrossrefWork[],
  queries: string[],
  institutionQueries: string[],
  topicQueries: string[],
  workMode: boolean,
) {
  const candidates = new Map<string, ScholarCandidate>();
  for (const work of works) {
    const representative = scholarWorkFromCrossref(work);
    if (!representative) continue;
    for (const author of work.author || []) {
      const label = crossrefAuthorName(author);
      if (!label) continue;
      if (
        !workMode &&
        Math.max(...queries.map((query) => nameSimilarity(label, query)), 0) <
          0.48
      ) {
        continue;
      }
      const orcid = normalizeOrcid(author.ORCID);
      const canonicalName = canonicalPersonName(label);
      const authorInstitutions = (author.affiliation || [])
        .map((item) => clean(item.name))
        .filter(Boolean);
      const contextualNameCluster =
        !workMode &&
        Math.max(...queries.map((query) => nameSimilarity(label, query)), 0) >=
          0.96 &&
        authorInstitutions.some((item) =>
          textMatchesAny(item, institutionQueries),
        ) &&
        textMatchesAny(
          [
            ...(work.subject || []),
            ...(work.title || []),
            ...(work["container-title"] || []),
          ].join(" "),
          topicQueries,
        );
      const nameCluster =
        distinctivePersonName(label) || contextualNameCluster;
      const key = nameCluster
        ? `crossref:${canonicalName}`
        : (orcid && `orcid:${orcid}`) ||
          `crossref:${canonicalName}:${representative.doi || representative.id}`;
      let candidate = candidates.get(key);
      if (!candidate) {
        candidate = emptyCandidate(label, "Crossref", { orcid });
        if (!orcid || nameCluster) candidate.candidateId = key;
        candidate.institutions = unique(authorInstitutions);
        candidate.institution =
          candidate.institutions[0] || "Crossref 未收录单位";
        candidate.profileUrls = candidate.orcid
          ? [`https://orcid.org/${candidate.orcid}`]
          : [];
        candidate.profileUrl = candidate.profileUrls[0];
        candidates.set(key, candidate);
      } else {
        candidate.institutions = unique([
          ...candidate.institutions,
          ...authorInstitutions,
        ]);
        candidate.institution =
          candidate.institutions[0] || candidate.institution;
        if (orcid && !candidate.orcid) {
          candidate.orcid = orcid;
          candidate.externalIds.orcid = orcid;
          candidate.profileUrls = unique([
            ...candidate.profileUrls,
            `https://orcid.org/${orcid}`,
          ]);
          candidate.profileUrl ||= candidate.profileUrls[0];
          candidate.trackingStatus = "verified";
        } else if (orcid && candidate.orcid && candidate.orcid !== orcid) {
          candidate.identityWarnings.push(
            "同名作品带有互相冲突的 ORCID，未据此自动合并。",
          );
        }
      }
      candidate.researchAreas = unique([
        ...candidate.researchAreas,
        ...(work.subject || []),
        ...(work["container-title"] || []),
      ]).slice(0, 8);
      if (representative.doi) {
        candidate.verifiedWorkDois = unique([
          ...candidate.verifiedWorkDois,
          representative.doi,
        ]).slice(0, 30);
      }
      if (
        !candidate.representativeWorks.some(
          (item) =>
            (item.doi && item.doi === representative.doi) ||
            item.id === representative.id,
        )
      ) {
        candidate.representativeWorks.push(representative);
      }
    }
  }
  return [...candidates.values()].map((candidate) => ({
      ...candidate,
      representativeWorks: candidate.representativeWorks
        .sort((left, right) => (right.year || 0) - (left.year || 0))
        .slice(0, 3),
  }));
}

async function openAlexAuthorSearch(variants: string[]) {
  const queries = unique([
    ...variants.slice(0, 3),
    fuzzyOpenAlexQuery(variants.find((item) => !hasHan(item)) || variants[0]),
  ]).slice(0, 4);
  const settled = await Promise.allSettled(
    queries.map(async (query) => {
      const url = new URL("https://api.openalex.org/authors");
      url.searchParams.set("search", query);
      url.searchParams.set("per-page", "12");
      const data = await fetchJson<{ results?: OpenAlexAuthor[] }>(
        url,
        "OpenAlex",
      );
      return data.results || [];
    }),
  );
  const authors = new Map<string, OpenAlexAuthor>();
  for (const result of settled) {
    if (result.status !== "fulfilled") continue;
    for (const author of result.value) {
      const id = entityId(author.id, /^A\d+$/);
      if (id && !authors.has(id)) authors.set(id, author);
    }
  }
  if (!authors.size && settled.every((item) => item.status === "rejected")) {
    throw new Error("OpenAlex unavailable");
  }
  const candidates = [...authors.values()]
    .map(openAlexCandidate)
    .filter((item): item is ScholarCandidate => Boolean(item))
    .slice(0, 18);
  await attachOpenAlexWorks(candidates);
  return candidates;
}

async function attachOpenAlexWorks(candidates: ScholarCandidate[]) {
  const ids = unique(
    candidates.flatMap((candidate) => candidate.openAlexIds),
  ).slice(0, 12);
  if (!ids.length) return;
  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("filter", `authorships.author.id:${ids.join("|")}`);
  url.searchParams.set("per-page", "50");
  url.searchParams.set("sort", "publication_date:desc");
  try {
    const data = await fetchJson<{ results?: OpenAlexWork[] }>(
      url,
      "OpenAlex works",
    );
    const byId = new Map(candidates.map((item) => [item.openAlexIds[0], item]));
    for (const work of data.results || []) {
      const normalized = scholarWorkFromOpenAlex(work);
      if (!normalized) continue;
      for (const authorship of work.authorships || []) {
        const authorId = entityId(authorship.author?.id, /^A\d+$/);
        const candidate = byId.get(authorId);
        if (
          candidate &&
          candidate.representativeWorks.length < 3 &&
          !candidate.representativeWorks.some(
            (item) => item.id === normalized.id,
          )
        ) {
          candidate.representativeWorks.push(normalized);
        }
      }
    }
  } catch {
    // Search results remain usable without representative works.
  }
}

async function semanticAuthorSearch(variants: string[]) {
  const settled = await Promise.allSettled(
    variants.slice(0, 3).map(async (query) => {
      const url = new URL(
        "https://api.semanticscholar.org/graph/v1/author/search",
      );
      url.searchParams.set("query", query);
      url.searchParams.set("limit", "12");
      url.searchParams.set(
        "fields",
        "name,aliases,affiliations,paperCount,hIndex,url,externalIds,papers.title,papers.year,papers.venue,papers.url,papers.externalIds",
      );
      const data = await fetchJson<{ data?: SemanticScholarAuthor[] }>(
        url,
        "Semantic Scholar",
      );
      return data.data || [];
    }),
  );
  const authors = new Map<string, SemanticScholarAuthor>();
  for (const result of settled) {
    if (result.status !== "fulfilled") continue;
    for (const author of result.value) {
      const id = clean(author.authorId, 160);
      if (id && !authors.has(id)) authors.set(id, author);
    }
  }
  if (!authors.size && settled.every((item) => item.status === "rejected")) {
    throw new Error("Semantic Scholar unavailable");
  }
  return [...authors.values()]
    .map(semanticCandidate)
    .filter((item): item is ScholarCandidate => Boolean(item));
}

async function crossrefWorkSearch(
  queries: string[],
  institutionQueries: string[],
  topicQueries: string[],
  workMode: boolean,
) {
  const query = queries[0] || "";
  const doi = normalizeDoi(query);
  let works: CrossrefWork[] = [];
  if (/^10\.\d{4,9}\//i.test(doi)) {
    const url = new URL(
      `https://api.crossref.org/works/${encodeURIComponent(doi)}`,
    );
    const data = await fetchJson<{ message?: CrossrefWork }>(url, "Crossref");
    if (data.message) works = [data.message];
  } else {
    const settled = await Promise.allSettled(
      unique(queries)
        .slice(0, workMode ? 1 : 3)
        .map(async (variant) => {
          const url = new URL("https://api.crossref.org/works");
          url.searchParams.set(
            workMode ? "query.title" : "query.author",
            variant,
          );
          if (!workMode && institutionQueries.length) {
            const translatedInstitution =
              institutionQueries.find((item) => /^[\x00-\x7F]+$/.test(item)) ||
              institutionQueries[0];
            url.searchParams.set(
              "query.affiliation",
              translatedInstitution,
            );
          }
          url.searchParams.set("rows", workMode ? "8" : "30");
          const data = await fetchJson<{
            message?: { items?: CrossrefWork[] };
          }>(url, "Crossref");
          return data.message?.items || [];
        }),
    );
    works = settled.flatMap((result) =>
      result.status === "fulfilled" ? result.value : [],
    );
    if (
      !works.length &&
      settled.length &&
      settled.every((result) => result.status === "rejected")
    ) {
      throw new Error("Crossref unavailable");
    }
  }
  return crossrefCandidates(
    works,
    queries,
    institutionQueries,
    topicQueries,
    workMode,
  );
}

function overlap(left: string[], right: string[]) {
  const set = new Set(left.filter(Boolean));
  return right.some((item) => item && set.has(item));
}

function sameStableIdentity(left: ScholarCandidate, right: ScholarCandidate) {
  if (left.orcid && right.orcid && left.orcid === right.orcid) return true;
  if (overlap(left.openAlexIds, right.openAlexIds)) return true;
  if (overlap(left.semanticScholarIds, right.semanticScholarIds)) return true;
  const leftDois = unique([
    ...left.verifiedWorkDois,
    ...left.representativeWorks.map((item) => item.doi),
  ]);
  const rightDois = unique([
    ...right.verifiedWorkDois,
    ...right.representativeWorks.map((item) => item.doi),
  ]);
  return (
    canonicalPersonName(left.label) === canonicalPersonName(right.label) &&
    overlap(leftDois, rightDois)
  );
}

function sameLikelyCareerIdentity(
  left: ScholarCandidate,
  right: ScholarCandidate,
) {
  if (
    canonicalPersonName(left.label) !== canonicalPersonName(right.label) ||
    !distinctivePersonName(left.label)
  ) {
    return false;
  }
  if (left.orcid && right.orcid && left.orcid !== right.orcid) return false;
  const anchored = [left, right].find(
    (candidate) =>
      candidate.orcid &&
      candidate.sources.length > 1 &&
      candidate.verifiedWorkDois.length > 1,
  );
  const fragment = anchored === left ? right : anchored === right ? left : null;
  return Boolean(
    anchored &&
      fragment &&
      (fragment.worksCount || fragment.representativeWorks.length) <= 1,
  );
}

function sameContextualWorkIdentity(
  left: ScholarCandidate,
  right: ScholarCandidate,
) {
  if (
    canonicalPersonName(left.label) !== canonicalPersonName(right.label) ||
    left.orcid ||
    right.orcid ||
    !left.verifiedWorkDois.length ||
    !right.verifiedWorkDois.length
  ) {
    return false;
  }
  const institutionMatch = left.institutions.some((institution) =>
    textMatchesAny(institution, right.institutions),
  );
  const topicMatch = left.researchAreas.some((area) =>
    textMatchesAny(area, right.researchAreas),
  );
  return institutionMatch && topicMatch;
}

function mergeCandidate(
  target: ScholarCandidate,
  incoming: ScholarCandidate,
) {
  const openAlexIds = unique([
    ...target.openAlexIds,
    ...incoming.openAlexIds,
  ]);
  const semanticScholarIds = unique([
    ...target.semanticScholarIds,
    ...incoming.semanticScholarIds,
  ]);
  const orcid = target.orcid || incoming.orcid;
  const works = [...target.representativeWorks];
  for (const work of incoming.representativeWorks) {
    if (
      !works.some(
        (item) =>
          item.id === work.id ||
          Boolean(item.doi && work.doi && item.doi === work.doi),
      )
    ) {
      works.push(work);
    }
  }
  return {
    ...target,
    label:
      target.label.length >= incoming.label.length
        ? target.label
        : incoming.label,
    aliases: unique([
      ...target.aliases,
      incoming.label,
      ...incoming.aliases,
    ]).filter(
      (item) =>
        normalizeName(item) !==
        normalizeName(
          target.label.length >= incoming.label.length
            ? target.label
            : incoming.label,
        ),
    ),
    institutions: unique([
      ...target.institutions,
      ...incoming.institutions,
    ]),
    institution:
      target.institution !== "未收录单位"
        ? target.institution
        : incoming.institution,
    researchAreas: unique([
      ...target.researchAreas,
      ...incoming.researchAreas,
    ]).slice(0, 8),
    representativeWorks: works
      .sort((left, right) => (right.year || 0) - (left.year || 0))
      .slice(0, 100),
    verifiedWorkDois: unique([
      ...target.verifiedWorkDois,
      ...incoming.verifiedWorkDois,
    ]).slice(0, 40),
    externalIds: {
      openAlex: openAlexIds[0],
      semanticScholar: semanticScholarIds[0],
      orcid,
    },
    openAlexIds,
    semanticScholarIds,
    orcid,
    profileUrls: unique([
      ...target.profileUrls,
      ...incoming.profileUrls,
    ]),
    profileUrl: target.profileUrl || incoming.profileUrl,
    worksCount: Math.max(
      target.worksCount || 0,
      incoming.worksCount || 0,
    ) || undefined,
    sources: unique([...target.sources, ...incoming.sources]),
    identityWarnings: unique([
      ...target.identityWarnings,
      ...incoming.identityWarnings,
    ]),
    trackingStatus:
      openAlexIds.length || semanticScholarIds.length || orcid
        ? ("verified" as const)
        : ("limited" as const),
  };
}

function consolidateCandidates(candidates: ScholarCandidate[]) {
  const merged: ScholarCandidate[] = [];
  for (const candidate of candidates) {
    let combined = candidate;
    let mergedAnother = true;
    while (mergedAnother) {
      mergedAnother = false;
      for (let index = merged.length - 1; index >= 0; index -= 1) {
        if (
          sameStableIdentity(merged[index], combined) ||
          sameLikelyCareerIdentity(merged[index], combined) ||
          sameContextualWorkIdentity(merged[index], combined)
        ) {
          combined = mergeCandidate(merged[index], combined);
          merged.splice(index, 1);
          mergedAnother = true;
        }
      }
    }
    merged.push(combined);
  }
  return merged;
}

const TOPIC_TRANSLATIONS: Record<string, string[]> = {
  人类学: ["anthropology", "social anthropology", "cultural anthropology"],
  社会人类学: ["social anthropology", "anthropology"],
  文化人类学: ["cultural anthropology", "anthropology"],
  社会学: ["sociology", "social science"],
  宗教: ["religion", "religious studies"],
  宗教研究: ["religious studies", "religion"],
  伦理学: ["ethics", "morality"],
  科学技术研究: ["science and technology studies", "sts"],
  科学社会学: ["sociology of science", "science studies"],
  医学人类学: ["medical anthropology", "anthropology"],
  政治学: ["political science", "politics"],
  历史学: ["history", "historical studies"],
  心理学: ["psychology"],
};

function topicContextVariants(topic: string) {
  const normalized = clean(topic, 120);
  const translated = Object.entries(TOPIC_TRANSLATIONS)
    .filter(([key]) => normalized.includes(key))
    .flatMap(([, values]) => values);
  return unique([normalized, ...translated]);
}

async function institutionContextVariants(institution: string) {
  const normalized = clean(institution, 120);
  if (!normalized) return [];
  const variants = [normalized];
  try {
    const url = new URL("https://api.openalex.org/institutions");
    url.searchParams.set("search", normalized);
    url.searchParams.set("per-page", "5");
    url.searchParams.set(
      "select",
      "id,display_name,display_name_acronyms,display_name_alternatives",
    );
    const data = await fetchJson<{ results?: OpenAlexInstitution[] }>(
      url,
      "OpenAlex institutions",
    );
    const exact =
      (data.results || []).find((item) =>
        [item.display_name, ...(item.display_name_alternatives || [])].some(
          (name) => normalizeName(name) === normalizeName(normalized),
        ),
      ) || data.results?.[0];
    if (exact) {
      variants.push(
        clean(exact.display_name),
        ...(exact.display_name_acronyms || []),
        ...(exact.display_name_alternatives || []),
      );
    }
  } catch {
    if (normalized.includes("浙江大学")) {
      variants.push("Zhejiang University", "ZJU");
    }
  }
  return unique(variants);
}

function textMatchesAny(value: string, queries: string[]) {
  const normalized = normalizeName(value);
  if (!normalized) return false;
  return queries.some((query) => {
    const normalizedQuery = normalizeName(query);
    if (
      normalizedQuery &&
      (normalized.includes(normalizedQuery) ||
        normalizedQuery.includes(normalized))
    ) {
      return true;
    }
    return normalizedQuery
      .split(/\s+/)
      .filter((token) => token.length >= 7)
      .map((token) =>
        token.endsWith("y")
          ? token.slice(0, -1)
          : token.replace(/(?:ical|ically|ist|ists)$/i, ""),
      )
      .some((stem) => stem.length >= 6 && normalized.includes(stem));
  });
}

function rankCandidate(
  candidate: ScholarCandidate,
  query: string,
  institutionQueries: string[],
  topicQueries: string[],
  workMode: boolean,
) {
  const names = [candidate.label, ...candidate.aliases];
  const similarity = Math.max(
    ...names.map((name) => nameSimilarity(name, query)),
    0,
  );
  let score = Math.round(similarity * 100);
  const reasons: string[] = [];
  if (similarity >= 0.96) reasons.push("姓名高度吻合");
  else if (similarity >= 0.72) reasons.push("姓名近似");
  if (
    institutionQueries.length &&
    candidate.institutions.some((item) =>
      textMatchesAny(item, institutionQueries),
    )
  ) {
    score += 35;
    reasons.push("单位吻合");
  }
  if (
    topicQueries.length &&
    [
      ...candidate.researchAreas,
      ...candidate.representativeWorks.map((item) => item.title),
    ].some((item) => textMatchesAny(item, topicQueries))
  ) {
    score += 25;
    reasons.push("研究方向吻合");
  }
  if (workMode && candidate.representativeWorks.length) {
    score += 30;
    reasons.push("由代表作确认");
  }
  if (candidate.orcid) {
    score += 5;
    reasons.push("有 ORCID");
  }
  if (candidate.sources.length > 1) {
    score += 6;
    reasons.push("多个索引相互印证");
  }
  if (
    candidate.identityWarnings.some((warning) =>
      /混合|混杂|冲突/.test(warning),
    )
  ) {
    score -= 45;
    reasons.push("索引身份可能混杂");
  }
  return { ...candidate, score, scoreReasons: unique(reasons) };
}

export async function searchScholars({
  query,
  mode = "name",
  institution = "",
  topic = "",
}: {
  query: string;
  mode?: "name" | "work";
  institution?: string;
  topic?: string;
}) {
  const cleanQuery = clean(query, 180);
  const variants = scholarQueryVariants(cleanQuery);
  const institutionQueries = await institutionContextVariants(institution);
  const topicQueries = topicContextVariants(topic);
  const workMode = mode === "work";
  const directOpenAlexId = entityId(
    cleanQuery.match(/A\d+/i)?.[0]?.toUpperCase(),
    /^A\d+$/,
  );
  const directSemanticId =
    cleanQuery.match(/semanticscholar\.org\/author\/(?:[^/]+\/)?([^/?#]+)/i)?.[1] ||
    "";
  const directOrcid = normalizeOrcid(cleanQuery);
  const jobs: Promise<ScholarCandidate[]>[] = [];

  if (directOpenAlexId || directOrcid) {
    jobs.push(
      getOpenAlexProfile(directOpenAlexId || directOrcid).then((candidate) =>
        candidate ? [candidate] : [],
      ),
    );
  } else if (!workMode) {
    jobs.push(openAlexAuthorSearch(variants));
  }

  if (directSemanticId) {
    jobs.push(
      getSemanticProfile(directSemanticId).then((candidate) =>
        candidate ? [candidate] : [],
      ),
    );
  } else if (!workMode) {
    jobs.push(semanticAuthorSearch(variants));
  }

  jobs.push(
    crossrefWorkSearch(
      workMode ? [cleanQuery] : variants,
      institutionQueries,
      topicQueries,
      workMode,
    ),
  );
  if (workMode && !directOpenAlexId && !directSemanticId && !directOrcid) {
    jobs.push(openAlexWorkAuthorSearch(cleanQuery));
    jobs.push(semanticPaperAuthorSearch(cleanQuery));
  }

  const settled = await Promise.allSettled(jobs);
  const candidates: ScholarCandidate[] = [];
  const warnings: string[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") candidates.push(...result.value);
    else warnings.push(clean(result.reason?.message) || "一个索引暂时不可用");
  }

  const merged = consolidateCandidates(candidates);

  const ranked = merged
    .map((candidate) => {
      const identityQuery = workMode
        ? candidate.label
        : variants.reduce(
            (best, variant) =>
              nameSimilarity(candidate.label, variant) >
              nameSimilarity(candidate.label, best)
                ? variant
                : best,
            cleanQuery,
          );
      return rankCandidate(
        candidate,
        identityQuery,
        institutionQueries,
        topicQueries,
        workMode,
      );
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.label.localeCompare(right.label, "zh-CN"),
    )
    .slice(0, 24);

  return {
    results: ranked,
    queryVariants: variants,
    warnings: unique(warnings),
    message:
      ranked.length === 0
        ? "没有找到可确认的学者。可改用论文题目、DOI、ORCID 或学术档案链接。"
        : undefined,
  };
}

async function openAlexWorkAuthorSearch(query: string) {
  const doi = normalizeDoi(query);
  const url = /^10\.\d{4,9}\//i.test(doi)
    ? new URL(`https://api.openalex.org/works/doi:${encodeURIComponent(doi)}`)
    : new URL("https://api.openalex.org/works");
  if (!/^10\.\d{4,9}\//i.test(doi)) {
    url.searchParams.set("search", query);
    url.searchParams.set("per-page", "5");
  }
  const data = await fetchJson<
    OpenAlexWork | { results?: OpenAlexWork[] }
  >(url, "OpenAlex works");
  const works =
    "results" in data ? data.results || [] : [data as OpenAlexWork];
  const authors = new Map<string, ScholarCandidate>();
  for (const work of works) {
    const representative = scholarWorkFromOpenAlex(work);
    if (!representative) continue;
    for (const authorship of work.authorships || []) {
      const id = entityId(authorship.author?.id, /^A\d+$/);
      const label = clean(
        authorship.raw_author_name || authorship.author?.display_name,
      );
      if (!label) continue;
      const key = `${canonicalPersonName(label)}:${representative.doi || representative.id}`;
      let candidate = authors.get(key);
      if (!candidate) {
        candidate = emptyCandidate(label, "OpenAlex 作品记录", {});
        candidate.candidateId = `work:${key}`;
        candidate.value = candidate.candidateId;
        candidate.institutions = unique([
          ...(authorship.institutions || []).map((item) => item.display_name),
          ...(authorship.raw_affiliation_strings || []),
        ]);
        candidate.institution =
          candidate.institutions[0] || "作品未收录单位";
        candidate.researchAreas = unique(
          (work.topics || []).flatMap((item) => [
            item.display_name,
            item.subfield?.display_name,
            item.field?.display_name,
          ]),
        ).slice(0, 8);
        candidate.profileUrls = id ? [`https://openalex.org/${id}`] : [];
        candidate.profileUrl = candidate.profileUrls[0];
        candidate.identityWarnings = id
          ? [
              "作者 ID 仅来自单篇作品，尚未通过姓名、单位与学科交叉核验，暂不自动绑定。",
            ]
          : [];
        authors.set(key, candidate);
      }
      candidate.representativeWorks.push(representative);
      if (representative.doi) {
        candidate.verifiedWorkDois = unique([
          ...candidate.verifiedWorkDois,
          representative.doi,
        ]);
      }
    }
  }
  return [...authors.values()];
}

async function semanticPaperAuthorSearch(query: string) {
  const doi = normalizeDoi(query);
  const direct = /^10\.\d{4,9}\//i.test(doi);
  const url = direct
    ? new URL(
        `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(doi)}`,
      )
    : new URL(
        "https://api.semanticscholar.org/graph/v1/paper/search",
      );
  if (!direct) {
    url.searchParams.set("query", query);
    url.searchParams.set("limit", "5");
  }
  url.searchParams.set(
    "fields",
    "title,year,venue,url,externalIds,authors.authorId,authors.name",
  );
  type PaperWithAuthors = SemanticScholarPaper & {
    authors?: { authorId?: string; name?: string }[];
  };
  const data = await fetchJson<
    PaperWithAuthors | { data?: PaperWithAuthors[] }
  >(url, "Semantic Scholar papers");
  const papers = "data" in data ? data.data || [] : [data as PaperWithAuthors];
  const authors = new Map<string, ScholarCandidate>();
  for (const paper of papers) {
    const representative = scholarWorkFromSemantic(paper);
    if (!representative) continue;
    for (const author of paper.authors || []) {
      const id = clean(author.authorId, 160);
      const label = clean(author.name);
      if (!id || !label) continue;
      let candidate = authors.get(id);
      if (!candidate) {
        candidate = emptyCandidate(label, "Semantic Scholar", {
          semanticScholar: id,
        });
        candidate.profileUrls = [
          `https://www.semanticscholar.org/author/${id}`,
        ];
        candidate.profileUrl = candidate.profileUrls[0];
        authors.set(id, candidate);
      }
      candidate.representativeWorks.push(representative);
      if (representative.doi) {
        candidate.verifiedWorkDois = unique([
          ...candidate.verifiedWorkDois,
          representative.doi,
        ]);
      }
    }
  }
  return [...authors.values()];
}

async function getOpenAlexProfile(idOrOrcid: string) {
  const id = entityId(idOrOrcid, /^A\d+$/) || normalizeOrcid(idOrOrcid);
  if (!id) return null;
  const url = new URL(
    `https://api.openalex.org/authors/${encodeURIComponent(id)}`,
  );
  const author = await fetchJson<OpenAlexAuthor>(url, "OpenAlex author");
  const candidate = openAlexCandidate(author);
  if (!candidate) return null;
  const worksUrl = new URL("https://api.openalex.org/works");
  worksUrl.searchParams.set(
    "filter",
    `authorships.author.id:${candidate.openAlexIds[0]}`,
  );
  worksUrl.searchParams.set("per-page", "100");
  worksUrl.searchParams.set("sort", "publication_date:desc");
  const worksData = await fetchJson<{ results?: OpenAlexWork[] }>(
    worksUrl,
    "OpenAlex works",
  );
  candidate.representativeWorks = (worksData.results || [])
    .map(scholarWorkFromOpenAlex)
    .filter((item): item is ScholarWork => Boolean(item));
  candidate.verifiedWorkDois = unique(
    candidate.representativeWorks.map((item) => item.doi),
  ).slice(0, 40);
  return candidate;
}

async function getSemanticProfile(id: string) {
  const authorId = clean(id, 160);
  if (!authorId) return null;
  const url = new URL(
    `https://api.semanticscholar.org/graph/v1/author/${encodeURIComponent(authorId)}`,
  );
  url.searchParams.set(
    "fields",
    "name,aliases,affiliations,paperCount,hIndex,url,externalIds",
  );
  const author = await fetchJson<SemanticScholarAuthor>(
    url,
    "Semantic Scholar author",
  );
  const papersUrl = new URL(
    `https://api.semanticscholar.org/graph/v1/author/${encodeURIComponent(authorId)}/papers`,
  );
  papersUrl.searchParams.set("limit", "100");
  papersUrl.searchParams.set(
    "fields",
    "title,year,venue,url,externalIds",
  );
  const papers = await fetchJson<{ data?: SemanticScholarPaper[] }>(
    papersUrl,
    "Semantic Scholar papers",
  );
  author.authorId = author.authorId || authorId;
  author.papers = papers.data || [];
  const candidate = semanticCandidate(author);
  if (!candidate) return null;
  candidate.representativeWorks = (author.papers || [])
    .map(scholarWorkFromSemantic)
    .filter((item): item is ScholarWork => Boolean(item));
  candidate.verifiedWorkDois = unique(
    candidate.representativeWorks.map((item) => item.doi),
  ).slice(0, 40);
  return candidate;
}

export async function getScholarProfile({
  openAlexIds = [],
  semanticScholarIds = [],
  orcid,
  name,
}: {
  openAlexIds?: string[];
  semanticScholarIds?: string[];
  orcid?: string;
  name?: string;
}) {
  const jobs: Promise<ScholarCandidate | null>[] = [];
  for (const openAlexId of unique(openAlexIds)) {
    jobs.push(getOpenAlexProfile(openAlexId));
  }
  if (!openAlexIds.length && orcid) {
    jobs.push(getOpenAlexProfile(orcid));
  }
  for (const semanticScholarId of unique(semanticScholarIds)) {
    jobs.push(getSemanticProfile(semanticScholarId));
  }
  if (!jobs.length && name) {
    const search = await searchScholars({ query: name, mode: "name" });
    return {
      candidate: null,
      candidates: search.results,
      works: [],
      needsConfirmation: true,
      warnings: search.warnings,
    };
  }
  const settled = await Promise.allSettled(jobs);
  const candidates = settled
    .filter(
      (result): result is PromiseFulfilledResult<ScholarCandidate | null> =>
        result.status === "fulfilled",
    )
    .map((result) => result.value)
    .filter((item): item is ScholarCandidate => Boolean(item));
  const candidateGroups = consolidateCandidates(candidates);
  let candidate = candidateGroups[0] || null;
  const works = candidate?.representativeWorks || [];
  if (candidate) {
    candidate = {
      ...candidate,
      representativeWorks: works.slice(0, 3),
    };
  }
  return {
    candidate,
    candidates: [],
    works,
    needsConfirmation: !candidate,
    warnings: settled
      .filter((result) => result.status === "rejected")
      .map((result) =>
        result.status === "rejected"
          ? clean(result.reason?.message) || "一个索引暂时不可用"
          : "",
      )
      .filter(Boolean),
  };
}
