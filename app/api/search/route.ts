import { NextRequest, NextResponse } from "next/server";
import { searchScholars } from "../../lib/scholar-search";

export const dynamic = "force-dynamic";

type OpenAlexSource = {
  display_name?: string;
  issn_l?: string;
  issn?: string[];
  type?: string;
  works_count?: number;
  host_organization_name?: string;
};

type CrossrefJournal = {
  title?: string;
  ISSN?: string[];
  publisher?: string;
  counts?: {
    current_doaj?: number;
    total_doaj?: number;
  };
};

function clean(value: unknown = "") {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function isIssn(value: unknown = "") {
  if (typeof value !== "string") return false;
  return /^\d{4}-[\dX]{4}$/i.test(value);
}

const ANTHROPOLOGY_JOURNALS = [
  {
    label: "American Anthropologist",
    issn: "0002-7294",
    publisher: "Wiley / American Anthropological Association",
    aliases: ["american anthropologists", "aa journal"],
  },
  {
    label: "HAU: Journal of Ethnographic Theory",
    issn: "2049-1115",
    publisher: "University of Chicago Press / HAU Society",
    aliases: ["hau", "hau journal", "hau journal of ethnographic theory"],
  },
  {
    label: "Ethos",
    issn: "0091-2131",
    publisher: "Wiley / Society for Psychological Anthropology",
    aliases: ["ethos journal"],
  },
  {
    label: "Ethnos",
    issn: "0014-1844",
    publisher: "Taylor & Francis",
    aliases: ["ethnos journal"],
  },
  {
    label: "Current Anthropology",
    issn: "0011-3204",
    publisher: "University of Chicago Press",
    aliases: ["current anthropology journal"],
  },
  {
    label: "American Ethnologist",
    issn: "0094-0496",
    publisher: "Wiley / American Anthropological Association",
    aliases: ["ae journal"],
  },
  {
    label: "Cultural Anthropology",
    issn: "0886-7356",
    publisher: "Society for Cultural Anthropology",
    aliases: ["cultural anthropology journal"],
  },
  {
    label: "Anthropological Quarterly",
    issn: "0003-5491",
    publisher: "George Washington University Institute for Ethnographic Research",
    aliases: ["aq journal"],
  },
  {
    label: "Medical Anthropology Quarterly",
    issn: "0745-5194",
    publisher: "Wiley / Society for Medical Anthropology",
    aliases: ["maq", "medical anthropology quarterly journal"],
  },
  {
    label: "Medical Anthropology",
    issn: "0145-9740",
    publisher: "Taylor & Francis",
    aliases: ["medical anthropology journal"],
  },
  {
    label: "Anthropological Theory",
    issn: "1463-4996",
    publisher: "SAGE",
    aliases: ["anthropological theory journal"],
  },
  {
    label: "Critique of Anthropology",
    issn: "0308-275X",
    publisher: "SAGE",
    aliases: ["critique of anthropology journal"],
  },
  {
    label: "Social Anthropology / Anthropologie Sociale",
    issn: "0964-0282",
    publisher: "Cambridge University Press / European Association of Social Anthropologists",
    aliases: ["social anthropology", "anthropologie sociale"],
  },
  {
    label: "Journal of the Royal Anthropological Institute",
    issn: "1359-0987",
    publisher: "Wiley / Royal Anthropological Institute",
    aliases: ["jrai", "royal anthropological institute journal"],
  },
  {
    label: "Annual Review of Anthropology",
    issn: "0084-6570",
    publisher: "Annual Reviews",
    aliases: ["annual review anthropology"],
  },
  {
    label: "Journal of Linguistic Anthropology",
    issn: "1055-1360",
    publisher: "Wiley / Society for Linguistic Anthropology",
    aliases: ["linguistic anthropology journal"],
  },
  {
    label: "Visual Anthropology Review",
    issn: "1058-7187",
    publisher: "Wiley / Society for Visual Anthropology",
    aliases: ["visual anthropology review"],
  },
  {
    label: "Anthropology & Medicine",
    issn: "1364-8470",
    publisher: "Taylor & Francis",
    aliases: ["anthropology and medicine"],
  },
];

function normalizeSearch(value = "") {
  return clean(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .toLowerCase()
    .trim();
}

function tokenVariants(value: string) {
  return normalizeSearch(value)
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      if (token.endsWith("ies") && token.length > 4) {
        return token.slice(0, -3) + "y";
      }
      if (token.endsWith("s") && token.length > 4) return token.slice(0, -1);
      return token;
    });
}

function localJournalResults(query: string) {
  const normalizedQuery = normalizeSearch(query);
  const queryTokens = tokenVariants(query);
  if (!normalizedQuery || queryTokens.length === 0) return [];

  return ANTHROPOLOGY_JOURNALS.map((journal, index) => {
    const candidates = [journal.label, journal.publisher, ...journal.aliases];
    const normalizedCandidates = candidates.map(normalizeSearch).filter(Boolean);
    const corpus = normalizedCandidates.join(" ");
    const corpusTokens = new Set(tokenVariants(corpus));
    let score = Number.POSITIVE_INFINITY;

    if (normalizedCandidates.includes(normalizedQuery)) score = 0;
    else if (normalizedCandidates.some((candidate) => candidate.startsWith(normalizedQuery))) {
      score = 1;
    } else if (queryTokens.every((token) => corpusTokens.has(token))) {
      score = 2;
    } else if (corpus.includes(normalizedQuery)) {
      score = 3;
    }

    return { journal, score, index };
  })
    .filter((item) => Number.isFinite(item.score))
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map(({ journal }) => ({
      label: journal.label,
      value: journal.issn,
      detail: `${journal.publisher} · 本地人类学期刊索引`,
    }));
}

function mergeResults<T extends { value: string; label: string }>(
  preferred: T[],
  additional: T[],
  limit = 12,
) {
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const item of [...preferred, ...additional]) {
    const key = item.value.toLowerCase() || item.label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged.slice(0, limit);
}

async function openAlex<T>(url: URL): Promise<T> {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "AnthropologyCanteen/1.1",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`OpenAlex ${response.status}`);
  return response.json() as Promise<T>;
}

async function crossrefJournals(query: string) {
  const url = new URL("https://api.crossref.org/journals");
  url.searchParams.set("query", query);
  url.searchParams.set("rows", "20");
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "AnthropologyCanteen/1.1",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Crossref ${response.status}`);
  const data = (await response.json()) as {
    message?: { items?: CrossrefJournal[] };
  };
  return (data.message?.items || [])
    .map((item) => {
      const issn = (item.ISSN || []).find(isIssn) || "";
      return {
        label: clean(item.title),
        value: issn,
        detail: [
          clean(item.publisher),
          "Crossref 期刊库",
          item.counts?.total_doaj
            ? `约 ${item.counts.total_doaj.toLocaleString("zh-CN")} 条开放记录`
            : "",
        ]
          .filter(Boolean)
          .join(" · "),
      };
    })
    .filter((item) => item.label && item.value);
}

export async function GET(request: NextRequest) {
  const kind = request.nextUrl.searchParams.get("kind");
  const query = clean(request.nextUrl.searchParams.get("q") || "").slice(0, 100);
  if (!["journal", "scholar"].includes(kind || "") || query.length < 2) {
    return NextResponse.json({ results: [] });
  }

  try {
    if (kind === "journal") {
      const curated = localJournalResults(query);
      const url = new URL("https://api.openalex.org/sources");
      url.searchParams.set("search", query);
      url.searchParams.set("filter", "type:journal");
      url.searchParams.set("per-page", "20");
      const [openAlexResult, crossrefResult] = await Promise.allSettled([
        openAlex<{ results?: OpenAlexSource[] }>(url),
        crossrefJournals(query),
      ]);
      const indexed =
        openAlexResult.status === "fulfilled"
          ? (openAlexResult.value.results || [])
              .map((item) => ({
                label: clean(item.display_name),
                value: clean(item.issn_l || item.issn?.[0]),
                detail: [
                  clean(item.host_organization_name),
                  "OpenAlex 期刊索引",
                  typeof item.works_count === "number"
                    ? `约 ${item.works_count.toLocaleString("zh-CN")} 条成果`
                    : "",
                ]
                  .filter(Boolean)
                  .join(" · "),
              }))
              .filter((item) => item.label && item.value)
          : [];
      const crossref =
        crossrefResult.status === "fulfilled" ? crossrefResult.value : [];
      const results = mergeResults(mergeResults(curated, indexed, 20), crossref);
      return NextResponse.json({
        results,
        message:
          results.length === 0
            ? "暂时没有找到期刊结果，请换一种写法。"
            : undefined,
      });
    }

    const mode =
      request.nextUrl.searchParams.get("mode") === "work" ? "work" : "name";
    const institution = clean(
      request.nextUrl.searchParams.get("institution") || "",
    ).slice(0, 120);
    const topic = clean(
      request.nextUrl.searchParams.get("topic") || "",
    ).slice(0, 120);
    const result = await searchScholars({
      query,
      mode,
      institution,
      topic,
    });
    return NextResponse.json(result, {
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { results: [], message: "暂时无法连接学术索引，请稍后再试。" },
      { status: 502 },
    );
  }
}
