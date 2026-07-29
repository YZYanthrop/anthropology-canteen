import assert from "node:assert/strict";
import test from "node:test";

const nativeFetch = globalThis.fetch;
let mockFetch = null;
globalThis.fetch = (...args) =>
  mockFetch ? mockFetch(...args) : nativeFetch(...args);

const workerModule = await import("../dist/server/index.js");
const worker = workerModule.default;

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("Chinese scholar search tries pinyin variants and survives provider failures", async () => {
  const openAlexQueries = [];
  const requestedUrls = [];
  mockFetch = async (input) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input : input.url,
    );
    requestedUrls.push(url.toString());
    if (url.hostname === "api.openalex.org" && url.pathname === "/authors") {
      openAlexQueries.push(url.searchParams.get("search"));
      return json({
        results: [
          {
            id: "https://openalex.org/A123",
            display_name: "Yu Qiu",
            display_name_alternatives: ["Qiu Yu", "邱昱"],
            works_count: 12,
            last_known_institutions: [{ display_name: "Zhejiang University" }],
            topics: [
              {
                display_name: "Social Anthropology",
                count: 8,
                field: { display_name: "Anthropology" },
              },
            ],
          },
        ],
      });
    }
    if (url.hostname === "api.openalex.org" && url.pathname === "/works") {
      return json({
        results: [
          {
            id: "https://openalex.org/W123",
            doi: "https://doi.org/10.1234/example",
            title: "An Ethnographic Work",
            publication_year: 2025,
            authorships: [
              {
                author: {
                  id: "https://openalex.org/A123",
                  display_name: "Yu Qiu",
                },
              },
            ],
          },
        ],
      });
    }
    if (url.hostname.includes("semanticscholar.org")) return json({}, 429);
    if (url.hostname === "api.crossref.org") return json({}, 503);
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const response = await worker.fetch(
      new Request(
        "http://anthropology-canteen.localhost:3000/api/search?kind=scholar&mode=name&q=%E9%82%B1%E6%98%B1&institution=%E6%B5%99%E6%B1%9F%E5%A4%A7%E5%AD%A6&topic=%E4%BA%BA%E7%B1%BB%E5%AD%A6",
      ),
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.ok(
      payload.results.length,
      JSON.stringify({ payload, requestedUrls, openAlexQueries }),
    );
    assert.equal(payload.results[0].label, "Yu Qiu");
    assert.equal(payload.results[0].externalIds.openAlex, "A123");
    assert.match(payload.results[0].institution, /Zhejiang University/);
    assert.ok(payload.results[0].representativeWorks.length > 0);
    assert.ok(payload.warnings.length >= 1);
    assert.ok(payload.queryVariants.includes("Qiu Yu"));
    assert.ok(payload.queryVariants.includes("Yu Qiu"));
    assert.ok(openAlexQueries.some((query) => /Qiu Yu/i.test(query || "")));
    assert.ok(openAlexQueries.some((query) => /Yu Qiu/i.test(query || "")));
  } finally {
    mockFetch = null;
  }
});

test("work mode resolves a DOI through Crossref and returns its authors", async () => {
  mockFetch = async (input) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input : input.url,
    );
    if (
      url.hostname === "api.crossref.org" &&
      url.pathname.includes("/works/10.5555%2Flifeworlds")
    ) {
      return json({
        message: {
          DOI: "10.5555/lifeworlds",
          title: ["Lifeworlds"],
          author: [
            {
              given: "Michael D.",
              family: "Jackson",
              ORCID: "https://orcid.org/0000-0002-1825-0097",
              affiliation: [{ name: "Harvard University" }],
            },
          ],
          "container-title": ["University Press"],
          published: { "date-parts": [[2013]] },
        },
      });
    }
    return json({}, 503);
  };

  try {
    const response = await worker.fetch(
      new Request(
        "http://anthropology-canteen.localhost:3000/api/search?kind=scholar&mode=work&q=10.5555%2Flifeworlds",
      ),
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.results[0].label, "Michael D. Jackson");
    assert.equal(payload.results[0].orcid, "0000-0002-1825-0097");
    assert.equal(payload.results[0].representativeWorks[0].title, "Lifeworlds");
  } finally {
    mockFetch = null;
  }
});

test("scholar profile endpoint aggregates identity and publication history", async () => {
  mockFetch = async (input) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input : input.url,
    );
    if (url.hostname === "api.openalex.org" && url.pathname === "/authors/A321") {
      return json({
        id: "https://openalex.org/A321",
        display_name: "Michael D. Jackson",
        works_count: 75,
        last_known_institutions: [{ display_name: "Harvard University" }],
        topics: [{ display_name: "Existential Anthropology", count: 20 }],
      });
    }
    if (url.hostname === "api.openalex.org" && url.pathname === "/works") {
      return json({
        results: [
          {
            id: "https://openalex.org/W321",
            title: "Lifeworlds",
            doi: "https://doi.org/10.5555/lifeworlds",
            publication_year: 2013,
            primary_location: {
              source: { display_name: "University Press" },
            },
          },
        ],
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const response = await worker.fetch(
      new Request(
        "http://anthropology-canteen.localhost:3000/api/scholar-profile?openAlexId=A321",
      ),
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.candidate.label, "Michael D. Jackson");
    assert.equal(payload.candidate.institution, "Harvard University");
    assert.equal(payload.works[0].title, "Lifeworlds");
    assert.equal(payload.needsConfirmation, false);
  } finally {
    mockFetch = null;
  }
});
