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
  abstract?: string;
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
  institutionalProfileUrl?: string;
  institutionalProfileVerifiedAt?: string;
  institutionalEvidence: string[];
  worksCount?: number;
  sources: string[];
  identityWarnings: string[];
  coauthorNames: string[];
  mergedRecordCount: number;
  mergeConfidence: "verified" | "high" | "unconfirmed";
  mergeEvidence: string[];
  score: number;
  scoreReasons: string[];
  providerRank?: number;
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
  abstract_inverted_index?: Record<string, number[]>;
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
  publicationDate?: string;
  venue?: string;
  url?: string;
  abstract?: string;
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
  abstract?: string;
  published?: { "date-parts"?: number[][] };
  issued?: { "date-parts"?: number[][] };
};

type OpenAlexAutocompleteAuthor = {
  id?: string;
  display_name?: string;
  hint?: string;
  external_id?: string;
  works_count?: number;
};

type OpenLibraryDocument = {
  key?: string;
  title?: string;
  author_name?: string[];
  author_key?: string[];
  first_publish_year?: number;
  isbn?: string[];
  publisher?: string[];
};

const USER_AGENT = "AnthropologyCanteen/1.3.1";
const RESPONSE_CACHE_TTL = 15 * 60 * 1000;
const responseCache = new Map<
  string,
  { expiresAt: number; value?: unknown; pending?: Promise<unknown> }
>();

export function configuredOpenAlexApiKey() {
  return typeof process !== "undefined"
    ? clean(process.env.OPENALEX_API_KEY, 240)
    : "";
}

export function configuredSemanticScholarApiKey() {
  return typeof process !== "undefined"
    ? clean(process.env.SEMANTIC_SCHOLAR_API_KEY, 240)
    : "";
}

function addOpenAlexApiKey(url: URL) {
  if (url.hostname !== "api.openalex.org") return url;
  const apiKey = configuredOpenAlexApiKey();
  if (apiKey && !url.searchParams.has("api_key")) {
    url.searchParams.set("api_key", apiKey);
  }
  return url;
}

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

function titleCasePersonName(value: unknown) {
  const source = clean(value, 180);
  if (!source || hasHan(source)) return source;
  return source
    .toLocaleLowerCase("en")
    .replace(/(^|[\s\-‐‑‒–—'’])([a-z])/g, (_match, separator, letter) =>
      `${separator}${letter.toLocaleUpperCase("en")}`,
    )
    .replace(/\b([A-Z])\b(?!\.)/g, "$1.");
}

function canonicalDisplayName(value: unknown) {
  const source = clean(value, 180);
  if (!source || hasHan(source)) return source;
  const letters = source.replace(/[^A-Za-z]/g, "");
  if (!letters) return source;
  const isUniformCase =
    letters === letters.toLocaleLowerCase("en") ||
    letters === letters.toLocaleUpperCase("en");
  return isUniformCase ? titleCasePersonName(source) : source;
}

function canonicalPersonName(value: unknown) {
  return normalizeName(value).split(/\s+/).filter(Boolean).sort().join(" ");
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

function abstractFromIndex(index?: Record<string, number[]>) {
  if (!index) return undefined;
  const positioned = Object.entries(index).flatMap(([word, positions]) =>
    (positions || []).map((position) => ({ word, position })),
  );
  positioned.sort((left, right) => left.position - right.position);
  return clean(positioned.map((item) => item.word).join(" "), 12_000) || undefined;
}

function cleanAbstract(value: unknown) {
  const text = clean(value, 12_000)
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"');
  return clean(text, 12_000) || undefined;
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
    abstract: abstractFromIndex(work.abstract_inverted_index),
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
    year:
      typeof work.year === "number"
        ? work.year
        : Number.parseInt(clean(work.publicationDate).slice(0, 4), 10) ||
          undefined,
    venue: clean(work.venue) || undefined,
    url:
      clean(work.url, 1000) ||
      (work.paperId
        ? `https://www.semanticscholar.org/paper/${work.paperId}`
        : undefined),
    abstract: cleanAbstract(work.abstract),
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
    abstract: cleanAbstract(work.abstract),
    familyIds: crossrefFamilyIds(work),
  };
}

async function fetchJson<T>(url: URL, source: string): Promise<T> {
  addOpenAlexApiKey(url);
  const key = url.toString();
  const cached = responseCache.get(key);
  if (cached?.value && cached.expiresAt > Date.now()) {
    return cached.value as T;
  }
  if (cached?.pending) return cached.pending as Promise<T>;
  const pending = (async () => {
    const headers: Record<string, string> = {
      accept: "application/json",
      "user-agent": USER_AGENT,
    };
    if (url.hostname === "api.semanticscholar.org") {
      const apiKey = configuredSemanticScholarApiKey();
      if (apiKey) headers["x-api-key"] = apiKey;
    }
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`${source} ${response.status}`);
    const value = (await response.json()) as T;
    responseCache.set(key, {
      expiresAt: Date.now() + RESPONSE_CACHE_TTL,
      value,
    });
    return value;
  })();
  responseCache.set(key, {
    expiresAt: Date.now() + RESPONSE_CACHE_TTL,
    pending,
  });
  try {
    return await pending;
  } catch (error) {
    responseCache.delete(key);
    throw error;
  }
}

function normalizeIsbn(value: unknown) {
  const isbn = clean(value, 80).toUpperCase().replace(/[^0-9X]/g, "");
  return /^(?:\d{9}[\dX]|97[89]\d{10})$/.test(isbn) ? isbn : "";
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
    institutionalEvidence: [],
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
  const label = canonicalDisplayName(author.display_name);
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
    candidate.identityWarnings = [
      "该索引档案的署名或任职经历较多；请用最近发表和机构信息确认后再关注。",
    ];
  }
  return candidate;
}

function semanticCandidate(author: SemanticScholarAuthor): ScholarCandidate | null {
  const label = canonicalDisplayName(author.name);
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
  const indexedWorks = (author.papers || [])
    .map(scholarWorkFromSemantic)
    .filter((item): item is ScholarWork => Boolean(item))
    .sort(
      (left, right) =>
        (right.year || 0) - (left.year || 0) ||
        left.title.localeCompare(right.title),
    );
  candidate.representativeWorks = indexedWorks.slice(0, 3);
  candidate.verifiedWorkDois = unique(
    indexedWorks.map((work) => work.doi),
  ).slice(0, 120);
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

function initialExpandedName(indexedName: string, query: string) {
  const indexed = normalizeName(indexedName).split(/\s+/).filter(Boolean);
  const requested = normalizeName(query).split(/\s+/).filter(Boolean);
  if (indexed.length < 2 || indexed.length !== requested.length) return "";
  const compatible = indexed.every((token, index) => {
    const wanted = requested[index];
    return (
      token === wanted ||
      (token.length === 1 && wanted.length > 1 && token[0] === wanted[0])
    );
  });
  return compatible ? titleCasePersonName(query) : "";
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
      const key = orcid
        ? `crossref:${canonicalName}:orcid:${orcid}`
        : `crossref:${canonicalName}:${representative.doi || representative.id}`;
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

function crossrefAuthorMatchesName(author: CrossrefAuthor, name: string) {
  const indexed = canonicalPersonName(crossrefAuthorName(author));
  const requested = canonicalPersonName(name);
  return Boolean(indexed && requested && indexed === requested);
}

function hasAnthropologyIdentityEvidence(
  work: CrossrefWork,
  author: CrossrefAuthor,
) {
  const evidence = normalizeName([
    ...(work.title || []),
    ...(work["container-title"] || []),
    ...(work.subject || []),
    work.publisher || "",
    ...(author.affiliation || []).map((item) => item.name || ""),
  ].join(" "));
  return /anthropolog|ethnolog|phenomenolog|\bethos\b|american ethnologist|journal of the royal anthropological|critical inquiry|contributions to indian sociology|annual review of anthropology|social change/.test(
    evidence,
  );
}

async function supplementSemanticCandidateFromCrossref(
  candidate: ScholarCandidate,
  fullName: string,
) {
  const name = canonicalDisplayName(fullName);
  if (normalizeName(name).split(/\s+/).filter(Boolean).length < 2) {
    return candidate;
  }
  try {
    const url = new URL("https://api.crossref.org/works");
    url.searchParams.set("query.author", name);
    url.searchParams.set("rows", "100");
    const data = await fetchJson<{
      message?: { items?: CrossrefWork[] };
    }>(url, "Crossref");
    const knownDois = new Set(candidateDois(candidate));
    const accepted = (data.message?.items || []).flatMap((work) => {
      const matchingAuthor = (work.author || []).find((author) =>
        crossrefAuthorMatchesName(author, name),
      );
      if (!matchingAuthor) return [];
      const doi = normalizeDoi(work.DOI);
      const authorOrcid = normalizeOrcid(matchingAuthor.ORCID);
      const affiliations = (matchingAuthor.affiliation || [])
        .map((item) => clean(item.name))
        .filter(Boolean);
      const verifiedByDoi = Boolean(doi && knownDois.has(doi));
      const verifiedByOrcid = Boolean(
        candidate.orcid && authorOrcid === candidate.orcid,
      );
      const verifiedByInstitution = candidate.institutions.some(
        (institution) =>
          affiliations.some((affiliation) =>
            institutionMatchesAny(affiliation, [institution]),
          ),
      );
      if (
        !verifiedByDoi &&
        !verifiedByOrcid &&
        !verifiedByInstitution &&
        !hasAnthropologyIdentityEvidence(work, matchingAuthor)
      ) {
        return [];
      }
      const normalized = scholarWorkFromCrossref(work);
      return normalized ? [normalized] : [];
    });
    if (!accepted.length) return candidate;
    const works = uniqueSortedWorks([
      ...accepted,
      ...candidate.representativeWorks,
    ]);
    return {
      ...candidate,
      representativeWorks: works,
      verifiedWorkDois: unique([
        ...candidate.verifiedWorkDois,
        ...accepted.map((work) => work.doi),
      ]).slice(0, 120),
      sources: unique([
        ...candidate.sources,
        "Crossref（身份证据筛选）",
      ]),
    };
  } catch {
    return candidate;
  }
}

async function crossrefNameFallback(
  name: string,
  institutionQueries: string[],
  topicQueries: string[],
) {
  const requestedName = canonicalDisplayName(name);
  if (normalizeName(requestedName).split(/\s+/).filter(Boolean).length < 2) {
    return [];
  }
  const url = new URL("https://api.crossref.org/works");
  url.searchParams.set("query.author", requestedName);
  url.searchParams.set("rows", "100");
  const data = await fetchJson<{
    message?: { items?: CrossrefWork[] };
  }>(url, "Crossref");
  const accepted: Array<{
    work: CrossrefWork;
    author: CrossrefAuthor;
  }> = [];
  for (const work of data.message?.items || []) {
    const matchingAuthor = (work.author || []).find(
      (author) =>
        nameSimilarity(crossrefAuthorName(author), requestedName) >= 0.94,
    );
    if (!matchingAuthor) continue;
    const affiliations = (matchingAuthor.affiliation || [])
      .map((item) => clean(item.name))
      .filter(Boolean);
    const institutionMatch = affiliations.some((affiliation) =>
      institutionMatchesAny(affiliation, institutionQueries),
    );
    const topicMatch = [
      ...(work.title || []),
      ...(work["container-title"] || []),
      ...(work.subject || []),
      ...affiliations,
    ].some((value) => textMatchesAny(value, topicQueries));
    if (
      !institutionMatch &&
      !topicMatch &&
      !hasAnthropologyIdentityEvidence(work, matchingAuthor)
    ) {
      continue;
    }
    accepted.push({ work, author: matchingAuthor });
  }
  if (!accepted.length) return [];
  const authorNames = unique(
    accepted.map((item) => crossrefAuthorName(item.author)),
  );
  const orcids = unique(
    accepted.map((item) => normalizeOrcid(item.author.ORCID)),
  );
  const orcid = orcids.length === 1 ? orcids[0] : "";
  const label = bestDisplayName([requestedName, ...authorNames]);
  const candidate = emptyCandidate(label, "Crossref（限流降级）", {
    orcid,
  });
  const works = uniqueSortedWorks(
    accepted
      .map((item) => scholarWorkFromCrossref(item.work))
      .filter((item): item is ScholarWork => Boolean(item)),
  );
  candidate.candidateId = orcid
    ? `orcid:${orcid}`
    : `crossref-name:${canonicalPersonName(label)}`;
  candidate.value = candidate.candidateId;
  candidate.institutions = unique(
    accepted.flatMap((item) =>
      (item.author.affiliation || []).map((affiliation) => affiliation.name),
    ),
  );
  candidate.institution = candidate.institutions[0] || "单位待确认";
  candidate.researchAreas = unique(
    accepted.flatMap((item) => item.work.subject || []),
  ).slice(0, 8);
  candidate.representativeWorks = works;
  candidate.verifiedWorkDois = unique(works.map((work) => work.doi)).slice(
    0,
    120,
  );
  candidate.worksCount = works.length;
  candidate.coauthorNames = unique(
    accepted.flatMap((item) =>
      (item.work.author || [])
        .map(crossrefAuthorName)
        .filter(
          (authorName) =>
            canonicalPersonName(authorName) !== canonicalPersonName(label),
        ),
    ),
  ).slice(0, 30);
  candidate.trackingStatus = orcid ? "verified" : "limited";
  candidate.mergeConfidence = orcid ? "verified" : "unconfirmed";
  candidate.identityWarnings = orcid
    ? []
    : [
        "公开作者索引当前被限流；这是按完整姓名和人类学证据筛选的临时档案，稍后可重新核验稳定作者 ID。",
      ];
  return [candidate];
}

function fuzzyAuthorQuery(value: string) {
  return normalizeName(value)
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => (token.length >= 3 ? `${token}~1` : token))
    .join(" ");
}

async function openAlexAutocompleteAuthorSearch(variants: string[]) {
  const latinVariants = variants.filter(
    (item) => !hasHan(item) && /[a-z]/i.test(item),
  );
  const originalUsesHan = hasHan(variants[0] || "");
  const queries = unique(
    originalUsesHan
      ? latinVariants.slice(0, 2)
      : [variants[0] || latinVariants[0]],
  );
  const settled = await Promise.allSettled(
    queries.map(async (query) => {
      const url = new URL("https://api.openalex.org/autocomplete/authors");
      url.searchParams.set("q", query);
      const data = await fetchJson<{
        results?: OpenAlexAutocompleteAuthor[];
      }>(url, "OpenAlex autocomplete");
      return data.results || [];
    }),
  );
  const suggestions = new Map<string, OpenAlexAutocompleteAuthor>();
  for (const result of settled) {
    if (result.status !== "fulfilled") continue;
    for (const suggestion of result.value) {
      const id = entityId(suggestion.id, /^A\d+$/);
      if (id && !suggestions.has(id)) suggestions.set(id, suggestion);
    }
  }
  if (!suggestions.size && settled.every((item) => item.status === "rejected")) {
    throw new Error("OpenAlex autocomplete unavailable");
  }
  const orderedSuggestions = [...suggestions.entries()].slice(0, 10);
  if (!orderedSuggestions.length) return [];

  let detailedAuthors: OpenAlexAuthor[] = [];
  try {
    const detailsUrl = new URL("https://api.openalex.org/authors");
    detailsUrl.searchParams.set(
      "filter",
      `openalex:${orderedSuggestions.map(([id]) => id).join("|")}`,
    );
    detailsUrl.searchParams.set("per-page", String(orderedSuggestions.length));
    const details = await fetchJson<{ results?: OpenAlexAuthor[] }>(
      detailsUrl,
      "OpenAlex authors",
    );
    detailedAuthors = details.results || [];
  } catch {
    // Autocomplete suggestions remain useful even if detail hydration fails.
  }

  const detailsById = new Map(
    detailedAuthors.map((author) => [
      entityId(author.id, /^A\d+$/),
      author,
    ]),
  );
  const candidates = orderedSuggestions.flatMap(([id, suggestion], index) => {
    const detailed = detailsById.get(id);
    const candidate = detailed
      ? openAlexCandidate(detailed)
      : openAlexCandidate({
          id: suggestion.id,
          display_name: suggestion.display_name,
          orcid: suggestion.external_id,
          works_count: suggestion.works_count,
          last_known_institutions: suggestion.hint
            ? [{ display_name: suggestion.hint }]
            : [],
        });
    return candidate ? [{ ...candidate, providerRank: index }] : [];
  });
  await attachOpenAlexWorks(candidates);
  return candidates;
}

async function openAlexAuthorSearch(
  variants: string[],
  { fuzzy = false }: { fuzzy?: boolean } = {},
) {
  const latinVariants = variants.filter(
    (item) => !hasHan(item) && /[a-z]/i.test(item),
  );
  const originalUsesHan = hasHan(variants[0] || "");
  const baseQueries = unique(
    originalUsesHan
      ? latinVariants.slice(0, 2)
      : [latinVariants[0] || variants[0]],
  );
  const queries = unique([
    ...baseQueries,
    ...(fuzzy ? baseQueries.map(fuzzyAuthorQuery) : []),
  ]).slice(0, originalUsesHan ? 4 : 2);
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
    .slice(0, 18)
    .map((candidate, index) => ({ ...candidate, providerRank: index }));
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
  url.searchParams.set("per-page", "100");
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
  const preferred =
    variants.find((item) => !hasHan(item) && /[a-z]/i.test(item)) ||
    variants[0];
  const settled = await Promise.allSettled(
    [preferred].filter(Boolean).map(async (query) => {
      const url = new URL(
        "https://api.semanticscholar.org/graph/v1/author/search",
      );
      url.searchParams.set("query", query);
      url.searchParams.set("limit", "8");
      url.searchParams.set(
        "fields",
        "name,affiliations,paperCount,hIndex,url,externalIds,papers.title,papers.year,papers.publicationDate,papers.venue,papers.url,papers.externalIds",
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
  const candidates = [...authors.values()]
    .map(semanticCandidate)
    .filter((item): item is ScholarCandidate => Boolean(item));
  const expandedCandidates = candidates.map((candidate, index) => {
    const expanded = initialExpandedName(candidate.label, preferred);
    return {
      ...candidate,
      label: expanded || candidate.label,
      aliases: expanded
        ? unique([candidate.label, ...candidate.aliases])
        : candidate.aliases,
      providerRank: index,
    };
  });
  const mainCandidate = expandedCandidates
    .filter(
      (candidate) => nameSimilarity(candidate.label, preferred) >= 0.78,
    )
    .sort(
      (left, right) =>
        (right.worksCount || 0) - (left.worksCount || 0),
    )[0];
  if (mainCandidate && (mainCandidate.worksCount || 0) >= 8) {
    const supplemented = await supplementSemanticCandidateFromCrossref(
      mainCandidate,
      initialExpandedName(mainCandidate.label, preferred) || preferred,
    );
    const index = expandedCandidates.findIndex(
      (candidate) => candidate.candidateId === mainCandidate.candidateId,
    );
    if (index >= 0) expandedCandidates[index] = supplemented;
  }
  return expandedCandidates;
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
    const isbn = normalizeIsbn(query);
    if (workMode && isbn) {
      const url = new URL("https://api.crossref.org/works");
      url.searchParams.set("filter", `isbn:${isbn}`);
      url.searchParams.set("rows", "12");
      const data = await fetchJson<{
        message?: { items?: CrossrefWork[] };
      }>(url, "Crossref");
      works = data.message?.items || [];
      return crossrefCandidates(
        works,
        queries,
        institutionQueries,
        topicQueries,
        workMode,
      );
    }
    const variants = unique(queries).slice(0, workMode ? 1 : 1);
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
            workMode ? "query.bibliographic" : "query.author",
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

  // Contextual similarity is useful for ranking candidates, but it is not an
  // identity anchor. Never merge two provider records from a name,
  // institution, topic, coauthor network, book family, or homepage alone.
  return { connect: false, confidence: "high", evidence: [] };
}

function mergeCandidate(
  target: ScholarCandidate,
  incoming: ScholarCandidate,
): ScholarCandidate {
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
  const label = bestDisplayName([
    target.label,
    ...target.aliases,
    incoming.label,
    ...incoming.aliases,
  ]);
  return {
    ...target,
    label,
    aliases: unique([
      target.label,
      ...target.aliases,
      incoming.label,
      ...incoming.aliases,
    ]).filter(
      (item) =>
        normalizeName(item) !== normalizeName(label),
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
    institutionalProfileUrl:
      target.institutionalProfileUrl ||
      incoming.institutionalProfileUrl,
    institutionalProfileVerifiedAt:
      target.institutionalProfileVerifiedAt ||
      incoming.institutionalProfileVerifiedAt,
    institutionalEvidence: unique([
      ...target.institutionalEvidence,
      ...incoming.institutionalEvidence,
    ]),
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
  const letters = value.replace(/[^A-Za-z]/g, "");
  const hasNaturalCase =
    !letters ||
    (letters !== letters.toLocaleLowerCase("en") &&
      letters !== letters.toLocaleUpperCase("en"));
  const initialCount = (value.match(/(?:^|\s)[A-Z]\.?\b/g) || []).length;
  return (
    (/,/.test(value) ? 0 : 4) +
    (/^[\x00-\x7F]+$/.test(value) ? 3 : 0) +
    (/-/.test(value) ? 2 : 0) +
    (hasNaturalCase ? 8 : 0) +
    Math.max(0, 4 - initialCount * 2) +
    Math.min(value.length, 40) / 100
  );
}

function uniqueSortedWorks(works: ScholarWork[], limit = 1000) {
  return works
    .filter(
      (work, index, all) =>
        all.findIndex((item) => sameScholarWork(item, work)) === index,
    )
    .sort(
      (left, right) =>
        (right.year || 0) - (left.year || 0) ||
        left.title.localeCompare(right.title),
    )
    .slice(0, limit);
}

function bestDisplayName(values: string[]) {
  return (
    unique(values)
      .map(canonicalDisplayName)
      .sort((left, right) => labelQuality(right) - labelQuality(left))[0] ||
    ""
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
  const labels = unique([candidate.label, ...candidate.aliases])
    .map(canonicalDisplayName)
    .sort(
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
  const componentOrcids = candidates.map((candidate) =>
    new Set(normalizeOrcid(candidate.orcid) ? [normalizeOrcid(candidate.orcid)] : []),
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
    const joinedOrcids = new Set([
      ...componentOrcids[leftRoot],
      ...componentOrcids[rightRoot],
    ]);
    if (joinedOrcids.size > 1) return;
    const root = Math.min(leftRoot, rightRoot);
    const child = Math.max(leftRoot, rightRoot);
    parents[child] = root;
    componentOrcids[root] = joinedOrcids;
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

const INSTITUTION_TRANSLATIONS: Record<string, string[]> = {
  浙江大学: ["Zhejiang University", "ZJU"],
  哈佛大学: ["Harvard University", "Harvard"],
  芝加哥大学: ["University of Chicago"],
  南加州大学: ["University of Southern California", "USC"],
  加州大学洛杉矶分校: ["University of California, Los Angeles", "UCLA"],
  北京大学: ["Peking University"],
  清华大学: ["Tsinghua University"],
  复旦大学: ["Fudan University"],
  南京大学: ["Nanjing University"],
  中山大学: ["Sun Yat-sen University"],
  香港中文大学: ["Chinese University of Hong Kong", "CUHK"],
};

function institutionContextVariants(institution: string) {
  const normalized = clean(institution, 120);
  if (!normalized) return [];
  const translated = Object.entries(INSTITUTION_TRANSLATIONS)
    .filter(([key]) => normalized.includes(key))
    .flatMap(([, values]) => values);
  return unique([normalized, ...translated]);
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

function institutionMatchesAny(value: string, queries: string[]) {
  const normalized = normalizeName(value);
  if (!normalized) return false;
  const stopwords = new Set([
    "university",
    "college",
    "institute",
    "institution",
    "department",
    "school",
    "faculty",
    "center",
    "centre",
  ]);
  return queries.some((query) => {
    const normalizedQuery = normalizeName(query);
    if (!normalizedQuery) return false;
    if (normalized === normalizedQuery) return true;
    const distinctiveTokens = normalizedQuery
      .split(/\s+/)
      .filter((token) => token.length >= 3 && !stopwords.has(token));
    return (
      distinctiveTokens.length > 0 &&
      distinctiveTokens.every((token) => normalized.includes(token))
    );
  });
}

function safeInstitutionalProfileUrl(value: string) {
  try {
    const url = new URL(clean(value, 1000));
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== "https:") return "";
    if (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      /^(?:127|10|0)\./.test(hostname) ||
      /^192\.168\./.test(hostname) ||
      /^172\.(?:1[6-9]|2\d|3[01])\./.test(hostname) ||
      hostname === "::1" ||
      /(?:^|\.)(?:openalex|orcid|semanticscholar|researchgate)\.org$/.test(
        hostname,
      ) ||
      hostname === "scholar.google.com"
    ) {
      return "";
    }
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

async function openLibraryWorkAuthorSearch(query: string) {
  const isbn = normalizeIsbn(query);
  const url = new URL("https://openlibrary.org/search.json");
  url.searchParams.set(isbn ? "q" : "title", isbn ? `isbn:${isbn}` : query);
  url.searchParams.set(
    "fields",
    "key,title,author_name,author_key,first_publish_year,isbn,publisher",
  );
  url.searchParams.set("limit", "6");
  const data = await fetchJson<{ docs?: OpenLibraryDocument[] }>(
    url,
    "Open Library",
  );
  const candidates = new Map<string, ScholarCandidate>();
  for (const document of data.docs || []) {
    const title = clean(document.title, 1000);
    if (!title) continue;
    const work: ScholarWork = {
      id: clean(document.key, 300) || `openlibrary:${normalizeName(title)}`,
      title,
      year: document.first_publish_year,
      venue: clean(document.publisher?.[0]) || "Open Library",
      url: document.key
        ? `https://openlibrary.org${document.key}`
        : undefined,
      familyIds: unique(
        (document.isbn || []).map((item) => {
          const normalized = normalizeIsbn(item);
          return normalized ? `isbn:${normalized}` : undefined;
        }),
      ),
    };
    (document.author_name || []).forEach((authorName, index) => {
      const label = clean(authorName, 180);
      if (!label) return;
      const authorKey = clean(document.author_key?.[index], 100);
      const key = authorKey
        ? `openlibrary:${authorKey}`
        : `openlibrary:${canonicalPersonName(label)}:${work.id}`;
      let candidate = candidates.get(key);
      if (!candidate) {
        candidate = emptyCandidate(label, "Open Library", {});
        candidate.candidateId = key;
        candidate.value = key;
        candidate.profileUrls = authorKey
          ? [`https://openlibrary.org/authors/${authorKey}`]
          : [];
        candidate.profileUrl = candidate.profileUrls[0];
        candidate.identityWarnings = [
          "图书馆作者记录用于核验书籍作者；关注前建议再用姓名和单位确认身份。",
        ];
        candidates.set(key, candidate);
      }
      if (
        !candidate.representativeWorks.some((item) =>
          sameScholarWork(item, work),
        )
      ) {
        candidate.representativeWorks.push(work);
      }
      candidate.worksCount = candidate.representativeWorks.length;
    });
  }
  return [...candidates.values()];
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
  const adjustedSimilarity = initialExpandedName(candidate.label, query)
    ? Math.max(similarity, 0.9)
    : similarity;
  const queryTokens = normalizeName(query).split(/\s+/).filter(Boolean);
  const prefixMatch = names.some((name) => {
    const nameTokens = normalizeName(name).split(/\s+/).filter(Boolean);
    return (
      queryTokens.length > 0 &&
      queryTokens.every((queryToken) =>
        nameTokens.some((nameToken) => nameToken.startsWith(queryToken)),
      )
    );
  });
  let score = Math.round(Math.max(adjustedSimilarity, prefixMatch ? 0.94 : 0) * 100);
  const reasons: string[] = [];
  let institution = candidate.institution;
  if (similarity >= 0.96) reasons.push("姓名高度吻合");
  else if (similarity >= 0.72) reasons.push("姓名近似");
  const matchingInstitution = institutionQueries.length
    ? candidate.institutions.find((item) =>
        institutionMatchesAny(item, institutionQueries),
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
  if (typeof candidate.providerRank === "number") {
    score += Math.max(0, 12 - candidate.providerRank * 2);
    if (candidate.providerRank === 0) reasons.push("作者索引首选结果");
  }
  if (typeof candidate.worksCount === "number" && candidate.worksCount > 0) {
    score += Math.min(
      32,
      Math.round(Math.log10(candidate.worksCount + 1) * 13),
    );
  }
  const latestYear = candidate.representativeWorks[0]?.year || 0;
  if (latestYear >= new Date().getUTCFullYear() - 2) {
    score += 5;
    reasons.push("含最近发表");
  }
  if (candidate.sources.length > 1) {
    score += 6;
    reasons.push("多个索引相互印证");
  }
  if (candidate.institutionalProfileUrl) {
    score += 45;
    reasons.push("机构个人主页已核验");
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
  homepage = "",
}: {
  query: string;
  mode?: "name" | "work";
  institution?: string;
  topic?: string;
  homepage?: string;
}) {
  const cleanQuery = clean(query, 180);
  const variants = scholarQueryVariants(cleanQuery);
  const providerVariants = unique([
    ...variants.filter(
      (item) => !hasHan(item) && /[a-z]/i.test(item),
    ),
    ...variants,
  ]);
  const institutionQueries = institutionContextVariants(institution);
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
  const candidates: ScholarCandidate[] = [];
  const warnings: string[] = [];
  const openAlexConfigured = Boolean(configuredOpenAlexApiKey());
  const semanticScholarConfigured = Boolean(
    configuredSemanticScholarApiKey(),
  );
  let discoverySource = workMode ? "works" : "semantic-scholar";

  if (workMode) {
    const jobs: Promise<ScholarCandidate[]>[] = [
      crossrefWorkSearch(
        [cleanQuery],
        institutionQueries,
        topicQueries,
        true,
      ),
    ];
    if (directOpenAlexId || directOrcid) {
      jobs.push(
        getOpenAlexProfile(directOpenAlexId || directOrcid).then((candidate) =>
          candidate ? [candidate] : [],
        ),
      );
    } else if (directSemanticId) {
      jobs.push(
        getSemanticProfile(directSemanticId).then((candidate) =>
          candidate ? [candidate] : [],
        ),
      );
    } else {
      jobs.push(openAlexWorkAuthorSearch(cleanQuery));
      jobs.push(semanticPaperAuthorSearch(cleanQuery));
      jobs.push(openLibraryWorkAuthorSearch(cleanQuery));
    }
    const settled = await Promise.allSettled(jobs);
    for (const result of settled) {
      if (result.status === "fulfilled") candidates.push(...result.value);
      else {
        warnings.push(
          clean(result.reason?.message) || "一个作品索引暂时不可用",
        );
      }
    }
  } else if (directOpenAlexId || directOrcid) {
    try {
      const candidate = await getOpenAlexProfile(
        directOpenAlexId || directOrcid,
      );
      if (candidate) candidates.push(candidate);
    } catch (error) {
      warnings.push(clean((error as Error)?.message) || "OpenAlex 暂时不可用");
    }
  } else if (directSemanticId) {
    try {
      const candidate = await getSemanticProfile(directSemanticId);
      if (candidate) candidates.push(candidate);
    } catch (error) {
      warnings.push(
        clean((error as Error)?.message) || "Semantic Scholar 暂时不可用",
      );
    }
  } else {
    // v1.0.0 treated one OpenAlex author record as one selectable identity.
    // Keep that stable-ID model and use autocomplete only as a partial-name
    // fallback; never infer that two same-name records are the same person.
    if (openAlexConfigured) {
      let openAlexError = "";
      try {
        candidates.push(
          ...(await openAlexAuthorSearch(variants)),
        );
        discoverySource = "openalex-search";
      } catch (error) {
        openAlexError =
          clean((error as Error)?.message) || "OpenAlex 姓名搜索暂时不可用";
      }
      if (!candidates.length) {
        try {
          candidates.push(
            ...(await openAlexAutocompleteAuthorSearch(variants)),
          );
          discoverySource = "openalex-autocomplete";
        } catch (error) {
          openAlexError =
            clean((error as Error)?.message) || "OpenAlex 联想搜索暂时不可用";
        }
      }
      if (!candidates.length) {
        try {
          candidates.push(
            ...(await openAlexAuthorSearch(variants, { fuzzy: true })),
          );
          discoverySource = "openalex-fuzzy";
        } catch (error) {
          openAlexError =
            clean((error as Error)?.message) || "OpenAlex 模糊搜索暂时不可用";
        }
      }
      if (!candidates.length && openAlexError) warnings.push(openAlexError);
    }
    if (!candidates.length) {
      try {
        candidates.push(...(await semanticAuthorSearch(providerVariants)));
        discoverySource = "semantic-scholar";
      } catch (error) {
        warnings.push(
          clean((error as Error)?.message) ||
            "Semantic Scholar 暂时不可用",
        );
      }
    }
    if (!candidates.length) {
      try {
        candidates.push(
          ...(await crossrefNameFallback(
            providerVariants[0] || cleanQuery,
            institutionQueries,
            topicQueries,
          )),
        );
        if (candidates.length) discoverySource = "crossref-fallback";
      } catch (error) {
        warnings.push(
          clean((error as Error)?.message) || "Crossref 降级检索暂时不可用",
        );
      }
    }
  }

  const safeHomepage = safeInstitutionalProfileUrl(homepage);
  if (homepage && !safeHomepage) {
    warnings.push("机构主页必须是公开的 HTTPS 地址。该链接未保存。");
  } else if (safeHomepage) {
    warnings.push("机构主页仅作为人工核验链接保存；程序不会自动抓取或据此合并作者档案。");
  }
  const verifiedCandidates = safeHomepage
    ? candidates.map((candidate) => ({
        ...candidate,
        institutionalProfileUrl: safeHomepage,
        profileUrls: unique([safeHomepage, ...candidate.profileUrls]),
      }))
    : candidates;
  const identityCandidates = workMode
    ? consolidateScholarCandidates(verifiedCandidates)
    : verifiedCandidates
        .filter(
          (candidate, index, all) =>
            all.findIndex(
              (item) => item.candidateId === candidate.candidateId,
            ) === index,
        )
        .map((candidate) =>
          finalizeCandidate(candidate, [], candidate.mergeConfidence),
        );

  const ranked = identityCandidates
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
    .slice(0, 12)
    .map((candidate, index) => ({
      ...candidate,
      scoreReasons:
        !workMode && index === 0
          ? unique(["最可能的主档案", ...candidate.scoreReasons])
          : candidate.scoreReasons,
    }));

  return {
    results: ranked,
    queryVariants: variants,
    warnings: unique(warnings),
    openAlexConfigured,
    semanticScholarConfigured,
    discoverySource,
    message:
      ranked.length === 0
        ? "没有找到可确认的学者。可改用论文或书籍题目、DOI、ISBN、ORCID 或机构主页。"
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
    "title,year,venue,url,abstract,externalIds,authors.authorId,authors.name",
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

async function fetchOpenAlexAuthorWorks(
  authorIds: string[],
  maximum = 600,
) {
  const ids = unique(authorIds)
    .map((item) => entityId(item, /^A\d+$/))
    .filter(Boolean);
  if (!ids.length) {
    return { works: [] as ScholarWork[], records: [] as OpenAlexWork[] };
  }
  const records: OpenAlexWork[] = [];
  let cursor = "*";
  for (let page = 0; page < 4 && records.length < maximum; page += 1) {
    const url = new URL("https://api.openalex.org/works");
    url.searchParams.set(
      "filter",
      `authorships.author.id:${ids.join("|")}`,
    );
    url.searchParams.set("per-page", "200");
    url.searchParams.set("sort", "publication_date:desc");
    url.searchParams.set("cursor", cursor);
    const data = await fetchJson<{
      results?: OpenAlexWork[];
      meta?: { next_cursor?: string | null };
    }>(url, "OpenAlex works");
    const pageRecords = data.results || [];
    records.push(...pageRecords);
    const nextCursor = clean(data.meta?.next_cursor, 1000);
    if (!nextCursor || !pageRecords.length || nextCursor === cursor) break;
    cursor = nextCursor;
  }
  return {
    records,
    works: uniqueSortedWorks(
      records
        .map(scholarWorkFromOpenAlex)
        .filter((item): item is ScholarWork => Boolean(item)),
      maximum,
    ),
  };
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
  const worksData = await fetchOpenAlexAuthorWorks(candidate.openAlexIds);
  candidate.representativeWorks = worksData.works;
  candidate.coauthorNames = unique(
    worksData.records.flatMap((work) =>
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
  ).slice(0, 120);
  return candidate;
}

async function getOpenAlexGroupProfile(
  requestedIds: string[],
  requestedOrcid?: string,
  fallbackName?: string,
) {
  const ids = unique(requestedIds)
    .map((item) => entityId(item, /^A\d+$/))
    .filter(Boolean)
    .slice(0, 30);
  const orcid = normalizeOrcid(requestedOrcid);
  const lookup = ids[0] || orcid;
  if (!lookup) return null;
  let authors: OpenAlexAuthor[] = [];
  try {
    if (ids.length > 1) {
      const authorsUrl = new URL("https://api.openalex.org/authors");
      authorsUrl.searchParams.set("filter", `openalex:${ids.join("|")}`);
      authorsUrl.searchParams.set("per-page", String(ids.length));
      const data = await fetchJson<{ results?: OpenAlexAuthor[] }>(
        authorsUrl,
        "OpenAlex authors",
      );
      authors = data.results || [];
    } else {
      const authorUrl = new URL(
        `https://api.openalex.org/authors/${encodeURIComponent(lookup)}`,
      );
      authors = [
        await fetchJson<OpenAlexAuthor>(authorUrl, "OpenAlex author"),
      ];
    }
  } catch {
    // A saved stable ID can still be used when author metadata is unavailable.
  }

  const compatibleAuthors = authors
    .filter((author) => {
      const authorOrcid = normalizeOrcid(author.orcid);
      if (orcid && authorOrcid && authorOrcid !== orcid) return false;
      if (!fallbackName) return true;
      return nameSimilarity(author.display_name, fallbackName) >= 0.78;
    })
    .sort(
      (left, right) =>
        (right.works_count || 0) - (left.works_count || 0),
    );
  const orcidAnchored = orcid
    ? compatibleAuthors.filter(
        (author) => normalizeOrcid(author.orcid) === orcid,
      )
    : [];
  const trustedAuthors = orcidAnchored.length
    ? orcidAnchored
    : compatibleAuthors.slice(0, 1);
  const primaryAuthor = trustedAuthors[0] || authors[0];
  let candidate = primaryAuthor ? openAlexCandidate(primaryAuthor) : null;
  if (!candidate && fallbackName) {
    candidate = emptyCandidate(
      canonicalDisplayName(fallbackName),
      "OpenAlex 已保存档案",
      { openAlex: ids[0], orcid },
    );
  }
  if (!candidate) return null;

  const trustedIds = unique(
    trustedAuthors.length
      ? trustedAuthors.map((author) => entityId(author.id, /^A\d+$/))
      : candidate.openAlexIds.length
        ? candidate.openAlexIds
        : ids.slice(0, 1),
  );
  const excludedIds = ids.filter((id) => !trustedIds.includes(id));
  candidate.openAlexIds = trustedIds;
  candidate.externalIds.openAlex = trustedIds[0];
  candidate.orcid = normalizeOrcid(candidate.orcid) || orcid || undefined;
  candidate.externalIds.orcid = candidate.orcid;
  candidate.mergedRecordCount = Math.max(trustedIds.length, 1);
  candidate.mergeEvidence = trustedIds.length > 1
    ? unique([...candidate.mergeEvidence, "相同 ORCID"])
    : [];
  if (excludedIds.length) {
    candidate.identityWarnings = unique([
      ...candidate.identityWarnings,
      `已停止沿用 ${excludedIds.length} 条旧版自动合并记录；当前只追踪经过稳定身份锚定的主档案。`,
    ]);
  }
  if (!trustedIds.length) return candidate;
  const worksData = await fetchOpenAlexAuthorWorks(trustedIds);
  candidate.representativeWorks = worksData.works;
  const ownIds = new Set(trustedIds);
  candidate.coauthorNames = unique(
    worksData.records.flatMap((work) =>
      (work.authorships || [])
        .filter(
          (item) =>
            !ownIds.has(entityId(item.author?.id, /^A\d+$/)),
        )
        .map((item) => item.author?.display_name),
    ),
  ).slice(0, 50);
  candidate.verifiedWorkDois = unique(
    candidate.representativeWorks.map((item) => item.doi),
  ).slice(0, 120);
  candidate.worksCount = Math.max(
    candidate.worksCount || 0,
    candidate.representativeWorks.length,
  );
  return candidate;
}

async function getSemanticProfile(id: string, preferredName = "") {
  const authorId = clean(id, 160);
  if (!authorId) return null;
  const url = new URL(
    `https://api.semanticscholar.org/graph/v1/author/${encodeURIComponent(authorId)}`,
  );
  url.searchParams.set(
    "fields",
    "name,affiliations,paperCount,hIndex,url,externalIds",
  );
  const author = await fetchJson<SemanticScholarAuthor>(
    url,
    "Semantic Scholar author",
  );
  const papersUrl = new URL(
    `https://api.semanticscholar.org/graph/v1/author/${encodeURIComponent(authorId)}/papers`,
  );
  papersUrl.searchParams.set("limit", "1000");
  papersUrl.searchParams.set(
    "fields",
    "title,year,publicationDate,venue,url,abstract,externalIds,authors",
  );
  const papers = await fetchJson<{ data?: SemanticScholarPaper[] }>(
    papersUrl,
    "Semantic Scholar papers",
  );
  author.authorId = author.authorId || authorId;
  author.papers = papers.data || [];
  let candidate = semanticCandidate(author);
  if (!candidate) return null;
  candidate.representativeWorks = uniqueSortedWorks(
    (author.papers || [])
      .map(scholarWorkFromSemantic)
      .filter((item): item is ScholarWork => Boolean(item)),
  );
  candidate.verifiedWorkDois = unique(
    candidate.representativeWorks.map((item) => item.doi),
  ).slice(0, 40);
  candidate = await supplementSemanticCandidateFromCrossref(
    candidate,
    preferredName || candidate.label,
  );
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
  if (openAlexIds.length || orcid) {
    jobs.push(getOpenAlexGroupProfile(openAlexIds, orcid, name));
  }
  const primarySemanticId = unique(semanticScholarIds)[0];
  if (primarySemanticId && !openAlexIds.length && !orcid) {
    jobs.push(getSemanticProfile(primarySemanticId, name));
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
  let candidate = candidates[0] || null;
  const works = uniqueSortedWorks(candidate?.representativeWorks || []);
  if (candidate) {
    const expanded = name
      ? initialExpandedName(candidate.label, name)
      : "";
    candidate = {
      ...candidate,
      label: canonicalDisplayName(expanded || candidate.label),
      aliases: expanded
        ? unique([candidate.label, ...candidate.aliases])
        : candidate.aliases,
      verifiedWorkDois: unique([
        ...candidate.verifiedWorkDois,
        ...verifiedWorkDois.map(normalizeDoi),
      ]).slice(0, 120),
      worksCount:
        Math.max(candidate.worksCount || 0, works.length) || undefined,
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
    ]),
  };
}
