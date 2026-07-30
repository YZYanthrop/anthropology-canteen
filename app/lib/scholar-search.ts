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
  familyIds?: string[];
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
  coauthorNames: string[];
  mergedRecordCount: number;
  mergeConfidence: "verified" | "high" | "unconfirmed";
  mergeEvidence: string[];
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
  authors?: { authorId?: string; name?: string }[];
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
  type?: string;
  ISBN?: string[];
  relation?: Record<string, { id?: string; "id-type"?: string }[]>;
  publisher?: string;
  "container-title"?: string[];
  subject?: string[];
  published?: { "date-parts"?: number[][] };
  issued?: { "date-parts"?: number[][] };
};

const USER_AGENT = "AnthropologyCanteen/1.1.1";

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

function doiFamilyIds(value: unknown) {
  const doi = normalizeDoi(value);
  if (!doi) return [];
  const families: string[] = [];
  const isbn = doi.match(/(?:^|[/._-])(97[89]\d{10})(?=$|[._-])/i)?.[1];
  if (isbn) families.push(`isbn:${isbn}`);
  const componentParent = isbn
    ? doi.replace(/-(?:fm|bm|\d{1,4})$/i, "")
    : doi.replace(/\.[a-z]$/i, "");
  if (componentParent !== doi) families.push(`doi-family:${componentParent}`);
  return unique(families);
}

function crossrefFamilyIds(work: CrossrefWork) {
  const related = Object.values(work.relation || {})
    .flat()
    .flatMap((item) => {
      const value = clean(item.id, 320);
      if (!value) return [];
      return item["id-type"]?.toLowerCase() === "doi"
        ? [`doi-family:${normalizeDoi(value)}`]
        : [`relation:${normalizeName(value)}`];
    });
  return unique([
    ...doiFamilyIds(work.DOI),
    ...(work.ISBN || []).map((isbn) => `isbn:${clean(isbn).replace(/\D/g, "")}`),
    ...related,
  ]);
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
  const hasCompoundSurname =
    /[\p{L}]{2,}[-‐‑‒–—][\p{L}]{4,}/u.test(clean(value, 180));
  return (
    tokens.length >= 2 &&
    tokens.join("").length >= 10 &&
    (tokens.some((token) => token.length >= 8) || hasCompoundSurname)
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
    familyIds: doiFamilyIds(doi),
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
    familyIds: doiFamilyIds(doi),
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
    familyIds: crossrefFamilyIds(work),
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
    coauthorNames: [],
    mergedRecordCount: 1,
    mergeConfidence: orcid
      ? "verified"
      : openAlex || semanticScholar
        ? "high"
        : "unconfirmed",
    mergeEvidence: orcid ? ["ORCID 身份锚点"] : [],
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
  candidate.coauthorNames = unique(
    (author.papers || []).flatMap((paper) =>
      (paper.authors || [])
        .map((item) => item.name)
        .filter(
          (name) =>
            name &&
            canonicalPersonName(name) !== canonicalPersonName(label),
        ),
    ),
  ).slice(0, 30);
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
      const key = orcid
        ? `crossref:${canonicalName}:orcid:${orcid}`
        : nameCluster
          ? `crossref:${canonicalName}:unidentified`
          :
          `crossref:${canonicalName}:${representative.doi || representative.id}`;
      let candidate = candidates.get(key);
      if (!candidate) {
        candidate = emptyCandidate(label, "Crossref", { orcid });
        candidate.candidateId = key;
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
      }
      candidate.researchAreas = unique([
        ...candidate.researchAreas,
        ...(work.subject || []),
        ...(work["container-title"] || []),
      ]).slice(0, 8);
      candidate.coauthorNames = unique([
        ...candidate.coauthorNames,
        ...(work.author || [])
          .map(crossrefAuthorName)
          .filter(
            (name) =>
              name &&
              canonicalPersonName(name) !== canonicalPersonName(label),
          ),
      ]).slice(0, 30);
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
        .slice(0, 100),
      worksCount: candidate.representativeWorks.length,
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
        if (candidate) {
          if (normalized.doi) {
            candidate.verifiedWorkDois = unique([
              ...candidate.verifiedWorkDois,
              normalized.doi,
            ]);
          }
          candidate.coauthorNames = unique([
            ...candidate.coauthorNames,
            ...(work.authorships || [])
              .filter(
                (item) =>
                  entityId(item.author?.id, /^A\d+$/) !== authorId,
              )
              .map((item) => item.author?.display_name),
          ]).slice(0, 30);
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
        "name,aliases,affiliations,paperCount,hIndex,url,externalIds,papers.title,papers.year,papers.venue,papers.url,papers.externalIds,papers.authors",
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
    const variants = unique(queries).slice(0, workMode ? 1 : 3);
    const requests = variants.map((variant) => ({
      variant,
      institution: "",
    }));
    if (!workMode && institutionQueries.length && variants[0]) {
      const translatedInstitution =
        institutionQueries.find((item) => /^[\x00-\x7F]+$/.test(item)) ||
        institutionQueries[0];
      requests.push({
        variant: variants[0],
        institution: translatedInstitution,
      });
    }
    const settled = await Promise.allSettled(
      requests.map(async ({ variant, institution }) => {
          const url = new URL("https://api.crossref.org/works");
          url.searchParams.set(
            workMode ? "query.title" : "query.author",
            variant,
          );
          if (institution) {
            url.searchParams.set(
              "query.affiliation",
              institution,
            );
          }
          url.searchParams.set("rows", workMode ? "8" : "50");
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

function candidateNames(candidate: ScholarCandidate) {
  return unique([candidate.label, ...candidate.aliases]);
}

function sharedCanonicalName(
  left: ScholarCandidate,
  right: ScholarCandidate,
) {
  const rightNames = new Set(
    candidateNames(right).map(canonicalPersonName).filter(Boolean),
  );
  return (
    candidateNames(left)
      .map(canonicalPersonName)
      .find((name) => name && rightNames.has(name)) || ""
  );
}

function scholarWorkKey(work: ScholarWork) {
  const doi = normalizeDoi(work.doi);
  if (doi) return `doi:${doi}`;
  return `title:${normalizeName(work.title)}:${work.year || ""}`;
}

function sameScholarWork(left: ScholarWork, right: ScholarWork) {
  const leftDoi = normalizeDoi(left.doi);
  const rightDoi = normalizeDoi(right.doi);
  if (leftDoi && rightDoi) return leftDoi === rightDoi;
  return (
    normalizeName(left.title) === normalizeName(right.title) &&
    (!left.year || !right.year || left.year === right.year)
  );
}

function candidateDois(candidate: ScholarCandidate) {
  return unique([
    ...candidate.verifiedWorkDois.map(normalizeDoi),
    ...candidate.representativeWorks.map((item) => normalizeDoi(item.doi)),
  ]);
}

function candidateWorkFamilies(candidate: ScholarCandidate) {
  return unique(
    candidate.representativeWorks.flatMap((work) => [
      ...(work.familyIds || []),
      ...doiFamilyIds(work.doi),
    ]),
  );
}

function candidateWorkSignatures(candidate: ScholarCandidate) {
  return unique(
    candidate.representativeWorks.map(
      (work) => `${normalizeName(work.title)}:${work.year || ""}`,
    ),
  );
}

function meaningfulEvidenceText(value: string, kind: "institution" | "topic") {
  const normalized = normalizeName(value);
  if (!normalized || /未收录|待确认|unknown|not recorded/.test(normalized)) {
    return "";
  }
  if (
    kind === "topic" &&
    [
      "social sciences",
      "arts and humanities",
      "science",
      "humanities",
    ].includes(normalized)
  ) {
    return "";
  }
  return normalized;
}

function evidenceCollectionsOverlap(
  left: string[],
  right: string[],
  kind: "institution" | "topic",
) {
  const leftValues = left
    .map((item) => meaningfulEvidenceText(item, kind))
    .filter(Boolean);
  const rightValues = right
    .map((item) => meaningfulEvidenceText(item, kind))
    .filter(Boolean);
  return leftValues.some((leftValue) =>
    rightValues.some((rightValue) => {
      if (leftValue === rightValue) return true;
      const shorter =
        leftValue.length <= rightValue.length ? leftValue : rightValue;
      const longer =
        leftValue.length > rightValue.length ? leftValue : rightValue;
      if (shorter.length >= 8 && longer.includes(shorter)) return true;
      const leftTokens = new Set(
        leftValue.split(" ").filter((token) => token.length >= 7),
      );
      return rightValue
        .split(" ")
        .filter((token) => token.length >= 7)
        .some((token) => leftTokens.has(token));
    }),
  );
}

function coauthorOverlap(left: ScholarCandidate, right: ScholarCandidate) {
  const leftNames = new Set(
    left.coauthorNames.map(canonicalPersonName).filter(Boolean),
  );
  return right.coauthorNames
    .map(canonicalPersonName)
    .some((name) => name && leftNames.has(name));
}

type IdentityLink = {
  connect: boolean;
  confidence: "verified" | "high";
  evidence: string[];
};

function identityLink(
  left: ScholarCandidate,
  right: ScholarCandidate,
): IdentityLink {
  if (left.orcid && right.orcid && left.orcid !== right.orcid) {
    return { connect: false, confidence: "high", evidence: [] };
  }
  const sharedName = sharedCanonicalName(left, right);
  const compatibleName =
    Boolean(sharedName) ||
    nameSimilarity(left.label, right.label) >= 0.96;
  if (!compatibleName) {
    return { connect: false, confidence: "high", evidence: [] };
  }

  const verifiedEvidence: string[] = [];
  if (left.orcid && right.orcid && left.orcid === right.orcid) {
    verifiedEvidence.push("相同 ORCID");
  }
  if (overlap(left.openAlexIds, right.openAlexIds)) {
    verifiedEvidence.push("相同 OpenAlex ID");
  }
  if (overlap(left.semanticScholarIds, right.semanticScholarIds)) {
    verifiedEvidence.push("相同 Semantic Scholar ID");
  }
  if (overlap(candidateDois(left), candidateDois(right))) {
    verifiedEvidence.push("共同作品 DOI");
  }
  if (verifiedEvidence.length) {
    return {
      connect: true,
      confidence: "verified",
      evidence: verifiedEvidence,
    };
  }

  if (
    !sharedName ||
    (!distinctivePersonName(left.label) &&
      !distinctivePersonName(right.label))
  ) {
    return { connect: false, confidence: "high", evidence: [] };
  }
  const contextualEvidence: string[] = [];
  if (
    evidenceCollectionsOverlap(
      left.institutions,
      right.institutions,
      "institution",
    )
  ) {
    contextualEvidence.push("姓名与任职单位一致");
  }
  if (
    evidenceCollectionsOverlap(
      left.researchAreas,
      right.researchAreas,
      "topic",
    )
  ) {
    contextualEvidence.push("姓名与研究方向一致");
  }
  if (coauthorOverlap(left, right)) {
    contextualEvidence.push("共同作者网络一致");
  }
  if (overlap(candidateWorkFamilies(left), candidateWorkFamilies(right))) {
    contextualEvidence.push("属于同一专著或作品系列");
  }
  if (overlap(candidateWorkSignatures(left), candidateWorkSignatures(right))) {
    contextualEvidence.push("共同作品题名与年份一致");
  }
  if (contextualEvidence.length) {
    return {
      connect: true,
      confidence: "high",
      evidence: contextualEvidence,
    };
  }

  const anchored = [left, right].find(
    (candidate) =>
      candidate.orcid &&
      (candidate.sources.length > 1 ||
        candidate.verifiedWorkDois.length > 0),
  );
  const fragment = anchored === left ? right : anchored === right ? left : null;
  if (
    anchored &&
    fragment &&
    fragment.sources.length > 1 &&
    fragment.verifiedWorkDois.length > 0
  ) {
    return {
      connect: true,
      confidence: "high",
      evidence: ["独特姓名的跨机构发表轨迹一致"],
    };
  }
  if (
    anchored &&
    fragment &&
    (fragment.worksCount || fragment.representativeWorks.length) <= 1
  ) {
    return {
      connect: true,
      confidence: "high",
      evidence: ["独特姓名与单项索引碎片一致"],
    };
  }
  return { connect: false, confidence: "high", evidence: [] };
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
    if (!works.some((item) => sameScholarWork(item, work))) {
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
      target.label,
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
    worksCount:
      Math.max(
        works.length,
        target.worksCount || 0,
        incoming.worksCount || 0,
      ) || undefined,
    sources: unique([...target.sources, ...incoming.sources]),
    identityWarnings: unique([
      ...target.identityWarnings,
      ...incoming.identityWarnings,
    ]),
    coauthorNames: unique([
      ...target.coauthorNames,
      ...incoming.coauthorNames,
    ]).slice(0, 50),
    mergedRecordCount:
      target.mergedRecordCount + incoming.mergedRecordCount,
    mergeConfidence:
      target.mergeConfidence === "verified" ||
      incoming.mergeConfidence === "verified"
        ? "verified"
        : target.mergeConfidence === "high" ||
            incoming.mergeConfidence === "high"
          ? "high"
          : "unconfirmed",
    mergeEvidence: unique([
      ...target.mergeEvidence,
      ...incoming.mergeEvidence,
    ]),
    trackingStatus:
      openAlexIds.length || semanticScholarIds.length || orcid
        ? ("verified" as const)
        : ("limited" as const),
  };
}

function labelQuality(value: string) {
  return (
    (/,/.test(value) ? 0 : 4) +
    (/^[\x00-\x7F]+$/.test(value) ? 3 : 0) +
    (/-/.test(value) ? 2 : 0) +
    Math.min(value.length, 40) / 100
  );
}

function finalizeCandidate(
  candidate: ScholarCandidate,
  evidence: string[],
  confidence: "verified" | "high" | "unconfirmed",
) {
  const openAlexIds = unique(candidate.openAlexIds).sort();
  const semanticScholarIds = unique(candidate.semanticScholarIds).sort();
  const orcid = normalizeOrcid(candidate.orcid) || undefined;
  const labels = unique([candidate.label, ...candidate.aliases]).sort(
    (left, right) =>
      labelQuality(right) - labelQuality(left),
  );
  const label = labels[0] || candidate.label;
  const candidateId =
    (orcid && `orcid:${orcid}`) ||
    (openAlexIds[0] && `openalex:${openAlexIds[0]}`) ||
    (semanticScholarIds[0] &&
      `semantic:${semanticScholarIds[0]}`) ||
    candidate.candidateId;
  const works = [...candidate.representativeWorks]
    .filter(
      (work, index, all) =>
        all.findIndex((item) => sameScholarWork(item, work)) === index,
    )
    .sort(
      (left, right) =>
        (right.year || 0) - (left.year || 0) ||
        scholarWorkKey(left).localeCompare(scholarWorkKey(right)),
    )
    .slice(0, 100);
  const mergeEvidence = unique([
    ...candidate.mergeEvidence,
    ...evidence,
  ]);
  const mergeConfidence =
    orcid || confidence === "verified"
      ? ("verified" as const)
      : candidate.mergedRecordCount > 1 || confidence === "high"
        ? ("high" as const)
        : candidate.mergeConfidence;
  return {
    ...candidate,
    candidateId,
    value:
      openAlexIds[0] ||
      semanticScholarIds[0] ||
      orcid ||
      candidateId,
    label,
    aliases: labels.slice(1),
    representativeWorks: works,
    verifiedWorkDois: unique([
      ...candidate.verifiedWorkDois.map(normalizeDoi),
      ...works.map((work) => normalizeDoi(work.doi)),
    ]).slice(0, 120),
    openAlexIds,
    semanticScholarIds,
    orcid,
    externalIds: {
      openAlex: openAlexIds[0],
      semanticScholar: semanticScholarIds[0],
      orcid,
    },
    worksCount:
      Math.max(candidate.worksCount || 0, works.length) || undefined,
    mergedRecordCount: Math.max(candidate.mergedRecordCount, 1),
    mergeConfidence,
    mergeEvidence:
      candidate.mergedRecordCount > 1
        ? mergeEvidence
        : candidate.mergeEvidence,
    trackingStatus:
      openAlexIds.length || semanticScholarIds.length || orcid
        ? ("verified" as const)
        : ("limited" as const),
  };
}

export function consolidateScholarCandidates(
  candidates: ScholarCandidate[],
) {
  const parents = candidates.map((_, index) => index);
  const componentEvidence = candidates.map(() => [] as string[]);
  const componentConfidence = candidates.map(
    (candidate) => candidate.mergeConfidence,
  );
  const find = (index: number): number => {
    if (parents[index] !== index) parents[index] = find(parents[index]);
    return parents[index];
  };
  const union = (
    left: number,
    right: number,
    link: IdentityLink,
  ) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot === rightRoot) {
      componentEvidence[leftRoot] = unique([
        ...componentEvidence[leftRoot],
        ...link.evidence,
      ]);
      return;
    }
    const root = Math.min(leftRoot, rightRoot);
    const child = Math.max(leftRoot, rightRoot);
    parents[child] = root;
    componentEvidence[root] = unique([
      ...componentEvidence[root],
      ...componentEvidence[child],
      ...link.evidence,
    ]);
    componentConfidence[root] =
      link.confidence === "verified" ||
      componentConfidence[root] === "verified" ||
      componentConfidence[child] === "verified"
        ? "verified"
        : "high";
  };

  for (let left = 0; left < candidates.length; left += 1) {
    for (let right = left + 1; right < candidates.length; right += 1) {
      const link = identityLink(candidates[left], candidates[right]);
      if (link.connect) union(left, right, link);
    }
  }

  const groups = new Map<number, ScholarCandidate[]>();
  candidates.forEach((candidate, index) => {
    const root = find(index);
    groups.set(root, [...(groups.get(root) || []), candidate]);
  });
  return [...groups.entries()].map(([root, group]) => {
    const combined = group
      .slice()
      .sort((left, right) =>
        left.candidateId.localeCompare(right.candidateId),
      )
      .reduce((target, incoming) =>
        target ? mergeCandidate(target, incoming) : incoming,
      );
    return finalizeCandidate(
      combined,
      componentEvidence[find(root)],
      componentConfidence[find(root)],
    );
  });
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
  let institution = candidate.institution;
  if (similarity >= 0.96) reasons.push("姓名高度吻合");
  else if (similarity >= 0.72) reasons.push("姓名近似");
  const matchingInstitution = institutionQueries.length
    ? candidate.institutions.find((item) =>
        textMatchesAny(item, institutionQueries),
      )
    : undefined;
  if (matchingInstitution) {
    score += 35;
    reasons.push("单位吻合");
    institution = matchingInstitution;
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
  if (candidate.mergedRecordCount > 1) {
    reasons.push(`已整合 ${candidate.mergedRecordCount} 条索引记录`);
  }
  if (
    candidate.identityWarnings.some((warning) =>
      /混合|混杂|冲突/.test(warning),
    )
  ) {
    score -= 45;
    reasons.push("索引身份可能混杂");
  }
  return {
    ...candidate,
    institution,
    score,
    scoreReasons: unique(reasons),
  };
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

  const merged = consolidateScholarCandidates(candidates);

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
  candidate.coauthorNames = unique(
    (worksData.results || []).flatMap((work) =>
      (work.authorships || [])
        .filter(
          (item) =>
            entityId(item.author?.id, /^A\d+$/) !==
            candidate.openAlexIds[0],
        )
        .map((item) => item.author?.display_name),
    ),
  ).slice(0, 40);
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
    "title,year,venue,url,externalIds,authors",
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
  verifiedWorkDois = [],
  orcid,
  name,
}: {
  openAlexIds?: string[];
  semanticScholarIds?: string[];
  verifiedWorkDois?: string[];
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
  const additionalWarnings: string[] = [];
  if (name) {
    try {
      candidates.push(
        ...(await crossrefWorkSearch([name], [], [], false)).filter(
          (candidate) =>
            canonicalPersonName(candidate.label) ===
            canonicalPersonName(name),
        ),
      );
    } catch (error) {
      additionalWarnings.push(
        clean((error as Error)?.message) || "Crossref 暂时不可用",
      );
    }
  }
  if (
    name &&
    (openAlexIds.length ||
      semanticScholarIds.length ||
      verifiedWorkDois.length ||
      orcid)
  ) {
    const bridge = emptyCandidate(name, "已确认本地档案", { orcid });
    bridge.openAlexIds = unique(openAlexIds);
    bridge.semanticScholarIds = unique(semanticScholarIds);
    bridge.verifiedWorkDois = unique(
      verifiedWorkDois.map(normalizeDoi),
    );
    bridge.externalIds = {
      openAlex: bridge.openAlexIds[0],
      semanticScholar: bridge.semanticScholarIds[0],
      orcid: normalizeOrcid(orcid) || undefined,
    };
    bridge.sources = [];
    bridge.mergedRecordCount = 0;
    bridge.mergeConfidence = "verified";
    bridge.mergeEvidence = ["已关注档案中的确认 ID"];
    candidates.push(bridge);
  }
  const candidateGroups = consolidateScholarCandidates(candidates);
  const requestedOpenAlex = unique(openAlexIds);
  const requestedSemantic = unique(semanticScholarIds);
  const requestedOrcid = normalizeOrcid(orcid);
  candidateGroups.sort((left, right) => {
    const identityScore = (candidate: ScholarCandidate) =>
      (requestedOrcid && candidate.orcid === requestedOrcid ? 1000 : 0) +
      candidate.openAlexIds.filter((id) =>
        requestedOpenAlex.includes(id),
      ).length *
        100 +
      candidate.semanticScholarIds.filter((id) =>
        requestedSemantic.includes(id),
      ).length *
        100 +
      (name &&
      canonicalPersonName(candidate.label) === canonicalPersonName(name)
        ? 20
        : 0) +
      (candidate.worksCount || candidate.representativeWorks.length);
    return identityScore(right) - identityScore(left);
  });
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
    warnings: unique([
      ...settled
        .filter((result) => result.status === "rejected")
        .map((result) =>
          result.status === "rejected"
            ? clean(result.reason?.message) || "一个索引暂时不可用"
            : "",
        )
        .filter(Boolean),
      ...additionalWarnings,
    ]),
  };
}
