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

test("work mode keeps Yu Qiu anchored to the anthropology paper instead of a mixed OpenAlex identity", async () => {
  mockFetch = async (input) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input : input.url,
    );
    if (url.hostname === "api.crossref.org") {
      return json({
        message: {
          DOI: "10.1111/1467-9655.14110",
          title: [
            "The art of jieyuan: ethical affinity and the cultivation of Chinese Buddhist spirituality in Tanzania",
          ],
          author: [
            {
              given: "Yu",
              family: "Qiu",
              affiliation: [{ name: "Zhejiang University" }],
            },
          ],
          "container-title": [
            "Journal of the Royal Anthropological Institute",
          ],
          subject: ["Anthropology", "Religion"],
          published: { "date-parts": [[2024, 3, 23]] },
        },
      });
    }
    if (url.hostname === "api.openalex.org") {
      return json({
        id: "https://openalex.org/W4393119264",
        doi: "https://doi.org/10.1111/1467-9655.14110",
        title:
          "The art of jieyuan: ethical affinity and the cultivation of Chinese Buddhist spirituality in Tanzania",
        publication_year: 2024,
        authorships: [
          {
            author: {
              id: "https://openalex.org/A5081837918",
              display_name: "Qi Yu",
              orcid: "https://orcid.org/0000-0002-0426-5407",
            },
            raw_author_name: "Yu Qiu",
            institutions: [{ display_name: "Zhejiang University" }],
            raw_affiliation_strings: ["Zhejiang University"],
          },
        ],
        topics: [
          {
            display_name: "Anthropological Studies",
            subfield: { display_name: "Anthropology" },
          },
        ],
      });
    }
    return json({}, 503);
  };

  try {
    const response = await worker.fetch(
      new Request(
        "http://anthropology-canteen.localhost:3000/api/search?kind=scholar&mode=work&q=10.1111%2F1467-9655.14110",
      ),
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    const candidate = payload.results[0];
    assert.equal(candidate.label, "Yu Qiu");
    assert.equal(candidate.institution, "Zhejiang University");
    assert.deepEqual(candidate.openAlexIds, []);
    assert.equal(candidate.orcid, undefined);
    assert.equal(candidate.trackingStatus, "limited");
    assert.ok(
      candidate.verifiedWorkDois.includes("10.1111/1467-9655.14110"),
    );
    assert.match(candidate.identityWarnings[0], /暂不自动绑定/);
  } finally {
    mockFetch = null;
  }
});

test("same distinctive scholar is consolidated across former and current institutions", async () => {
  mockFetch = async (input) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input : input.url,
    );
    if (
      url.hostname === "api.openalex.org" &&
      url.pathname === "/institutions"
    ) {
      return json({
        results: [
          {
            id: "https://openalex.org/I76130692",
            display_name: "Zhejiang University",
            display_name_acronyms: ["ZJU"],
            display_name_alternatives: ["浙江大学"],
          },
        ],
      });
    }
    if (url.hostname === "api.openalex.org" && url.pathname === "/authors") {
      return json({
        results: [
          {
            id: "https://openalex.org/A5068858403",
            display_name: "Lianghao Dai",
            works_count: 7,
            last_known_institutions: [
              { display_name: "University of Göttingen" },
            ],
            topics: [
              {
                display_name: "Interdisciplinary Collaboration",
                field: { display_name: "Sociology" },
              },
            ],
          },
          {
            id: "https://openalex.org/A5134513705",
            display_name: "Lianghao Dai",
            orcid: "https://orcid.org/0000-0003-4679-0864",
            works_count: 1,
            last_known_institutions: [
              { display_name: "Zhejiang University" },
            ],
          },
          {
            id: "https://openalex.org/A5013253637",
            display_name: "Dai Lianghao",
            works_count: 1,
          },
        ],
      });
    }
    if (url.hostname === "api.openalex.org" && url.pathname === "/works") {
      return json({
        results: [
          {
            id: "https://openalex.org/WOLD",
            doi: "https://doi.org/10.1038/d41586-019-03558-5",
            title: "Mapping the right fit for knowledge sharing",
            publication_year: 2019,
            authorships: [
              {
                author: {
                  id: "https://openalex.org/A5068858403",
                  display_name: "Lianghao Dai",
                },
              },
            ],
          },
          {
            id: "https://openalex.org/WNEW",
            doi: "https://doi.org/10.1080/21620555.2026.2656193",
            title:
              "Large language models as a conduit for value shifts in contemporary China",
            publication_year: 2026,
            authorships: [
              {
                author: {
                  id: "https://openalex.org/A5134513705",
                  display_name: "Lianghao Dai",
                },
              },
            ],
          },
          {
            id: "https://openalex.org/WCHINESE",
            title: "University as Factory",
            publication_year: 2014,
            authorships: [
              {
                author: {
                  id: "https://openalex.org/A5013253637",
                  display_name: "Dai Lianghao",
                },
              },
            ],
          },
        ],
      });
    }
    if (url.hostname === "api.crossref.org") {
      return json({
        message: {
          items: [
            {
              DOI: "10.1038/d41586-019-03558-5",
              title: ["Mapping the right fit for knowledge sharing"],
              author: [
                {
                  given: "Lianghao",
                  family: "Dai",
                  affiliation: [{ name: "University of Göttingen" }],
                },
              ],
              published: { "date-parts": [[2019]] },
            },
            {
              DOI: "10.1080/21620555.2026.2656193",
              title: [
                "Large language models as a conduit for value shifts in contemporary China",
              ],
              author: [
                {
                  given: "Lianghao",
                  family: "Dai",
                  ORCID: "https://orcid.org/0000-0003-4679-0864",
                  affiliation: [{ name: "Zhejiang University" }],
                },
              ],
              published: { "date-parts": [[2026]] },
            },
          ],
        },
      });
    }
    if (url.hostname.includes("semanticscholar.org")) return json({}, 429);
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const response = await worker.fetch(
      new Request(
        "http://anthropology-canteen.localhost:3000/api/search?kind=scholar&mode=name&q=%E6%88%B4%E8%89%AF%E7%81%8F&institution=%E6%B5%99%E6%B1%9F%E5%A4%A7%E5%AD%A6&topic=%E7%A4%BE%E4%BC%9A%E5%AD%A6",
      ),
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.results.length, 1);
    const candidate = payload.results[0];
    assert.equal(candidate.orcid, "0000-0003-4679-0864");
    assert.deepEqual(
      [...candidate.openAlexIds].sort(),
      ["A5013253637", "A5068858403", "A5134513705"].sort(),
    );
    assert.ok(candidate.institutions.includes("Zhejiang University"));
    assert.ok(candidate.institutions.includes("University of Göttingen"));
    assert.ok(candidate.verifiedWorkDois.length >= 2);
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
