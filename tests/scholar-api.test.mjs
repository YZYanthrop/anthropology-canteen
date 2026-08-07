import assert from "node:assert/strict";
import test from "node:test";

const nativeFetch = globalThis.fetch;
process.env.OPENALEX_API_KEY = "test-openalex-key-1234";
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
    assert.deepEqual(payload.warnings, []);
    assert.ok(payload.queryVariants.includes("Qiu Yu"));
    assert.ok(payload.queryVariants.includes("Yu Qiu"));
    assert.ok(openAlexQueries.some((query) => /Qiu Yu/i.test(query || "")));
    assert.ok(openAlexQueries.some((query) => /Yu Qiu/i.test(query || "")));
  } finally {
    mockFetch = null;
  }
});

test("OpenAlex stable author search finds Veena Das and includes her latest work", async () => {
  let autocompleteRequests = 0;
  let semanticRequests = 0;
  mockFetch = async (input) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input : input.url,
    );
    if (
      url.hostname === "api.openalex.org" &&
      url.pathname === "/autocomplete/authors"
    ) {
      autocompleteRequests += 1;
      assert.equal(url.searchParams.get("q"), "Veena Das");
      assert.equal(url.searchParams.get("api_key"), "test-openalex-key-1234");
      return json({
        results: [
          {
            id: "https://openalex.org/A5109218575",
            display_name: "Veena Das",
            hint: "Johns Hopkins University",
            works_count: 271,
          },
        ],
      });
    }
    if (url.hostname === "api.openalex.org" && url.pathname === "/authors") {
      return json({
        results: [
          {
            id: "https://openalex.org/A5109218575",
            display_name: "Veena Das",
            works_count: 271,
            last_known_institutions: [
              { display_name: "Johns Hopkins University" },
            ],
            topics: [{ display_name: "Social Anthropology", count: 30 }],
          },
        ],
      });
    }
    if (url.hostname === "api.openalex.org" && url.pathname === "/works") {
      return json({
        results: [
          {
            id: "https://openalex.org/WVEENA2025",
            title: "Textures of the Ordinary",
            publication_year: 2025,
            primary_location: {
              source: { display_name: "Anthropological Theory" },
            },
            authorships: [
              {
                author: {
                  id: "https://openalex.org/A5109218575",
                  display_name: "Veena Das",
                },
              },
            ],
          },
        ],
      });
    }
    if (url.hostname.includes("semanticscholar.org")) {
      semanticRequests += 1;
      return json({}, 429);
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const response = await worker.fetch(
      new Request(
        "http://local/api/search?kind=scholar&mode=name&q=Veena%20Das",
      ),
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(autocompleteRequests, 0);
    assert.equal(semanticRequests, 0);
    assert.equal(payload.openAlexConfigured, true);
    assert.equal(payload.discoverySource, "openalex-search");
    assert.equal(payload.results[0].label, "Veena Das");
    assert.equal(payload.results[0].externalIds.openAlex, "A5109218575");
    assert.equal(payload.results[0].worksCount, 271);
    assert.equal(
      payload.results[0].representativeWorks[0].title,
      "Textures of the Ordinary",
    );
  } finally {
    mockFetch = null;
  }
});

test("partial scholar names return stable-ID suggestions before the full name is entered", async () => {
  let autocompleteRequests = 0;
  mockFetch = async (input) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input : input.url,
    );
    if (url.pathname === "/autocomplete/authors") {
      autocompleteRequests += 1;
      assert.equal(url.searchParams.get("q"), "Cheryl Mat");
      return json({
        results: [
          {
            id: "https://openalex.org/A70707",
            display_name: "Cheryl Mattingly",
            hint: "Aarhus University",
            works_count: 95,
          },
        ],
      });
    }
    if (url.pathname === "/authors") {
      return json({
        results: [
          {
            id: "https://openalex.org/A70707",
            display_name: "Cheryl Mattingly",
            works_count: 95,
            last_known_institutions: [
              { display_name: "Aarhus University" },
            ],
          },
        ],
      });
    }
    if (url.pathname === "/works") return json({ results: [] });
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const response = await worker.fetch(
      new Request(
        "http://local/api/search?kind=scholar&mode=name&q=Cheryl%20Mat",
      ),
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(autocompleteRequests, 0);
    assert.equal(payload.results.length, 1);
    assert.equal(payload.results[0].label, "Cheryl Mattingly");
  } finally {
    mockFetch = null;
  }
});

test("misspelled scholar names fall back to OpenAlex fuzzy search", async () => {
  const authorQueries = [];
  mockFetch = async (input) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input : input.url,
    );
    if (url.pathname === "/autocomplete/authors") {
      return json({ results: [] });
    }
    if (url.pathname === "/authors") {
      const query = url.searchParams.get("search") || "";
      authorQueries.push(query);
      if (!query.includes("~1")) return json({ results: [] });
      return json({
        results: [
          {
            id: "https://openalex.org/A888",
            display_name: "Michael Lambek",
            works_count: 84,
            last_known_institutions: [
              { display_name: "University of Toronto" },
            ],
            topics: [{ display_name: "Anthropology of Religion" }],
          },
        ],
      });
    }
    if (url.pathname === "/works") return json({ results: [] });
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const response = await worker.fetch(
      new Request(
        "http://local/api/search?kind=scholar&mode=name&q=micheal%20lambek",
      ),
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.results[0].label, "Michael Lambek");
    assert.equal(payload.discoverySource, "openalex-fuzzy");
    assert.ok(authorQueries.some((query) => query.includes("micheal~1")));
    assert.ok(authorQueries.some((query) => query.includes("lambek~1")));
  } finally {
    mockFetch = null;
  }
});

test("name search keeps a keyless Semantic Scholar fallback", async () => {
  const configuredKey = process.env.OPENALEX_API_KEY;
  delete process.env.OPENALEX_API_KEY;
  let semanticRequests = 0;
  mockFetch = async (input) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input : input.url,
    );
    if (url.hostname.includes("semanticscholar.org")) {
      semanticRequests += 1;
      return json({
        data: [
          {
            authorId: "S-KEYLESS-1",
            name: "Keyless Scholar",
            affiliations: ["Example University"],
            paperCount: 4,
          },
        ],
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const response = await worker.fetch(
      new Request(
        "http://local/api/search?kind=scholar&mode=name&q=Keyless%20Scholar",
      ),
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(semanticRequests, 1);
    assert.equal(payload.openAlexConfigured, false);
    assert.equal(payload.discoverySource, "semantic-scholar");
    assert.equal(payload.results[0].label, "Keyless Scholar");
  } finally {
    mockFetch = null;
    if (configuredKey) process.env.OPENALEX_API_KEY = configuredKey;
  }
});

test("keyless searches rank the canonical anthropologist profile and show its latest work", async () => {
  const configuredOpenAlexKey = process.env.OPENALEX_API_KEY;
  const configuredSemanticKey = process.env.SEMANTIC_SCHOLAR_API_KEY;
  delete process.env.OPENALEX_API_KEY;
  delete process.env.SEMANTIC_SCHOLAR_API_KEY;
  const cases = [
    {
      query: "cheryl mattingly",
      indexedName: "C. Mattingly",
      expectedName: "Cheryl Mattingly",
      id: "S-CHERYL-MAIN",
      latest: "Crisis, Alterity, and Tradition",
      venue: "Critical Phenomenology",
    },
    {
      query: "veena das",
      indexedName: "V. Das",
      expectedName: "Veena Das",
      id: "S-VEENA-MAIN",
      latest: "Language in Flight: Home and Elsewhere",
      venue: "Cultural Anthropology",
    },
    {
      query: "jason throop",
      indexedName: "J. Throop",
      expectedName: "Jason Throop",
      id: "S-JASON-MAIN",
      latest: "Moral Experience and the Ordinary",
      venue: "Ethos",
    },
  ];

  try {
    for (const fixture of cases) {
      mockFetch = async (input) => {
        const url = new URL(
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input
              : input.url,
        );
        assert.equal(
          url.hostname,
          "api.semanticscholar.org",
          `Unexpected request: ${url}`,
        );
        assert.match(url.searchParams.get("fields") || "", /papers\.title/);
        return json({
          data: [
            {
              authorId: `${fixture.id}-FRAGMENT`,
              name: fixture.indexedName,
              paperCount: 2,
              papers: [
                {
                  paperId: `${fixture.id}-OLD-FRAGMENT`,
                  title: "An unrelated fragment",
                  year: 2018,
                  venue: "Unrelated Journal",
                },
              ],
            },
            {
              authorId: `${fixture.id}-NAMESAKE`,
              name: fixture.expectedName,
              paperCount: 4,
              papers: [
                {
                  paperId: `${fixture.id}-NAMESAKE-WORK`,
                  title: "A namesake record",
                  year: 2024,
                  venue: "Other Field",
                },
              ],
            },
            {
              authorId: fixture.id,
              name: fixture.indexedName,
              paperCount: 89,
              papers: [
                {
                  paperId: `${fixture.id}-LATEST`,
                  title: fixture.latest,
                  year: 2026,
                  venue: fixture.venue,
                  externalIds: { DOI: `10.5555/${fixture.id.toLowerCase()}` },
                },
                {
                  paperId: `${fixture.id}-HISTORY`,
                  title: "Historical anthropology work",
                  year: 2020,
                  venue: "American Ethnologist",
                },
              ],
            },
          ],
        });
      };
      const response = await worker.fetch(
        new Request(
          `http://local/api/search?kind=scholar&mode=name&q=${encodeURIComponent(fixture.query)}`,
        ),
      );
      const payload = await response.json();
      assert.equal(response.status, 200);
      assert.equal(payload.results[0].label, fixture.expectedName);
      assert.deepEqual(payload.results[0].semanticScholarIds, [fixture.id]);
      assert.equal(payload.results[0].mergedRecordCount, 1);
      assert.equal(payload.results[0].representativeWorks[0].title, fixture.latest);
      assert.equal(payload.results[0].representativeWorks[0].year, 2026);
      assert.deepEqual(payload.results[0].researchAreas, []);
      assert.ok(payload.results.every((item) => item.mergedRecordCount === 1));
    }
  } finally {
    mockFetch = null;
    if (configuredOpenAlexKey) {
      process.env.OPENALEX_API_KEY = configuredOpenAlexKey;
    } else {
      delete process.env.OPENALEX_API_KEY;
    }
    if (configuredSemanticKey) {
      process.env.SEMANTIC_SCHOLAR_API_KEY = configuredSemanticKey;
    } else {
      delete process.env.SEMANTIC_SCHOLAR_API_KEY;
    }
  }
});

test("Crossref refresh adds verified anthropology work but rejects a same-name medical record", async () => {
  const configuredKey = process.env.OPENALEX_API_KEY;
  delete process.env.OPENALEX_API_KEY;
  mockFetch = async (input) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input : input.url,
    );
    if (url.hostname === "api.semanticscholar.org") {
      return json({
        data: [
          {
            authorId: "S-CHERYL-SAFE",
            name: "C. Mattingly",
            paperCount: 89,
            papers: [
              {
                paperId: "S-CHERYL-2022",
                title: "Acted Ethics and the Human Condition",
                year: 2022,
                venue: "Ethos",
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
              DOI: "10.1111/amet.safe",
              title: ["Surprise and the singular plural"],
              author: [
                {
                  given: "Cheryl",
                  family: "Mattingly",
                  affiliation: [
                    { name: "Department of Anthropology, Aarhus University" },
                  ],
                },
              ],
              "container-title": ["American Ethnologist"],
              published: { "date-parts": [[2025]] },
            },
            {
              DOI: "10.9999/unrelated-oncology",
              title: ["A randomized oncology treatment trial"],
              author: [
                {
                  given: "Cheryl",
                  family: "Mattingly",
                  affiliation: [{ name: "Boston Medical Center" }],
                },
              ],
              "container-title": ["Journal of Oncology"],
              published: { "date-parts": [[2026]] },
            },
          ],
        },
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const response = await worker.fetch(
      new Request(
        "http://local/api/search?kind=scholar&mode=name&q=CHERYL%20MATTINGLY",
      ),
    );
    const payload = await response.json();
    const main = payload.results[0];
    assert.equal(main.label, "Cheryl Mattingly");
    assert.equal(main.representativeWorks[0].year, 2025);
    assert.equal(main.representativeWorks[0].doi, "10.1111/amet.safe");
    assert.ok(
      !main.verifiedWorkDois.includes("10.9999/unrelated-oncology"),
    );
  } finally {
    mockFetch = null;
    if (configuredKey) process.env.OPENALEX_API_KEY = configuredKey;
  }
});

test("Crossref provides one evidence-filtered author card when Semantic Scholar is rate limited", async () => {
  const configuredKey = process.env.OPENALEX_API_KEY;
  delete process.env.OPENALEX_API_KEY;
  mockFetch = async (input) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input : input.url,
    );
    if (url.hostname === "api.semanticscholar.org") return json({}, 429);
    if (url.hostname === "api.crossref.org") {
      return json({
        message: {
          items: [
            {
              DOI: "10.1177/00490857261459035",
              title: ["The Female Voice: Reinstituting Life"],
              author: [
                {
                  given: "Veena",
                  family: "Das",
                  affiliation: [
                    {
                      name: "Anthropology, Johns Hopkins University",
                    },
                  ],
                },
              ],
              "container-title": ["Social Change"],
              published: { "date-parts": [[2026]] },
            },
            {
              DOI: "10.9999/unrelated-mathematics",
              title: ["A theorem in nonlinear analysis"],
              author: [{ given: "Veena", family: "Das" }],
              "container-title": ["Journal of Mathematics"],
              published: { "date-parts": [[2027]] },
            },
          ],
        },
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const response = await worker.fetch(
      new Request(
        "http://local/api/search?kind=scholar&mode=name&q=VEENA%20DAS",
      ),
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.discoverySource, "crossref-fallback");
    assert.equal(payload.results.length, 1);
    assert.equal(payload.results[0].label, "Veena Das");
    assert.equal(payload.results[0].trackingStatus, "limited");
    assert.equal(
      payload.results[0].representativeWorks[0].doi,
      "10.1177/00490857261459035",
    );
    assert.ok(
      !payload.results[0].verifiedWorkDois.includes(
        "10.9999/unrelated-mathematics",
      ),
    );
  } finally {
    mockFetch = null;
    if (configuredKey) process.env.OPENALEX_API_KEY = configuredKey;
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

test("work mode resolves a book by ISBN through Open Library", async () => {
  mockFetch = async (input) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input : input.url,
    );
    if (url.hostname === "openlibrary.org") {
      assert.equal(url.searchParams.get("q"), "isbn:9780520389823");
      return json({
        docs: [
          {
            key: "/works/OL123W",
            title: "Angloscene",
            author_name: ["Jay Ke-Schutte"],
            author_key: ["OL456A"],
            first_publish_year: 2023,
            isbn: ["9780520389823"],
            publisher: ["University of California Press"],
          },
        ],
      });
    }
    return json({}, 503);
  };

  try {
    const response = await worker.fetch(
      new Request(
        "http://anthropology-canteen.localhost:3000/api/search?kind=scholar&mode=work&q=9780520389823",
      ),
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    const candidate = payload.results.find(
      (item) => item.label === "Jay Ke-Schutte",
    );
    assert.ok(candidate, JSON.stringify(payload, null, 2));
    assert.equal(candidate.representativeWorks[0].title, "Angloscene");
    assert.ok(
      candidate.representativeWorks[0].familyIds.includes(
        "isbn:9780520389823",
      ),
    );
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

test("same-name medical record is not merged into Cheryl Mattingly's verified profile", async () => {
  mockFetch = async (input) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input : input.url,
    );
    if (url.hostname === "api.openalex.org" && url.pathname === "/authors") {
      return json({
        results: [
          {
            id: "https://openalex.org/A777",
            display_name: "Cheryl Mattingly",
            orcid: "https://orcid.org/0009-0004-0182-5319",
            works_count: 42,
            last_known_institutions: [
              { display_name: "Aarhus University" },
              { display_name: "University of Southern California" },
            ],
            topics: [
              { display_name: "Medical Anthropology" },
              { display_name: "Phenomenology" },
            ],
          },
        ],
      });
    }
    if (url.hostname === "api.openalex.org" && url.pathname === "/works") {
      return json({
        results: [
          {
            id: "https://openalex.org/W777",
            doi: "https://doi.org/10.1177/14634996241292395",
            title:
              "Identity perplexity, stigma, and social critique",
            publication_year: 2025,
            authorships: [
              {
                author: {
                  id: "https://openalex.org/A777",
                  display_name: "Cheryl Mattingly",
                  orcid: "https://orcid.org/0009-0004-0182-5319",
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
              DOI: "10.1177/14634996241292395",
              title: ["Identity perplexity, stigma, and social critique"],
              author: [
                {
                  given: "Cheryl",
                  family: "Mattingly",
                  ORCID: "https://orcid.org/0009-0004-0182-5319",
                  affiliation: [{ name: "Aarhus University" }],
                },
              ],
              subject: ["Anthropology"],
              published: { "date-parts": [[2025]] },
            },
            {
              DOI: "10.9999/unrelated-oncology",
              title: ["A randomized oncology treatment trial"],
              author: [
                {
                  given: "Cheryl",
                  family: "Mattingly",
                  affiliation: [{ name: "Boston Medical Center" }],
                },
              ],
              subject: ["Oncology"],
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
        "http://anthropology-canteen.localhost:3000/api/search?kind=scholar&mode=name&q=Cheryl%20Mattingly&institution=Aarhus%20University&topic=anthropology",
      ),
    );
    const payload = await response.json();
    const verified = payload.results.find((item) =>
      item.openAlexIds.includes("A777"),
    );
    assert.ok(verified, JSON.stringify(payload, null, 2));
    assert.ok(
      verified.representativeWorks.some(
        (work) => work.doi === "10.1177/14634996241292395",
      ),
    );
    assert.ok(
      !verified.representativeWorks.some(
        (work) => work.doi === "10.9999/unrelated-oncology",
      ),
    );
  } finally {
    mockFetch = null;
  }
});

test("institutional homepage ranks the current stable record without merging old fragments", async () => {
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
    if (url.hostname === "sociology.zju.edu.cn") {
      return new Response(
        `<!doctype html><html><body>
          <h1>Lianghao Dai</h1>
          <p>Zhejiang University · formerly University of Göttingen</p>
          <p>Mapping the right fit for knowledge sharing</p>
          <p>Large language models as a conduit for value shifts in contemporary China</p>
          <p>University as Factory</p>
        </body></html>`,
        {
          headers: { "content-type": "text/html; charset=utf-8" },
        },
      );
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
        "http://anthropology-canteen.localhost:3000/api/search?kind=scholar&mode=name&q=%E6%88%B4%E8%89%AF%E7%81%8F&institution=%E6%B5%99%E6%B1%9F%E5%A4%A7%E5%AD%A6&topic=%E7%A4%BE%E4%BC%9A%E5%AD%A6&homepage=https%3A%2F%2Fsociology.zju.edu.cn%2Ffaculty%2Flianghao-dai",
      ),
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.results.length, 3);
    assert.ok(
      payload.results.every((item) => item.openAlexIds.length === 1),
    );
    const candidate = payload.results.find(
      (item) => item.orcid === "0000-0003-4679-0864",
    );
    assert.ok(candidate, JSON.stringify(payload.results, null, 2));
    assert.equal(candidate.orcid, "0000-0003-4679-0864");
    assert.deepEqual(candidate.openAlexIds, ["A5134513705"]);
    assert.ok(candidate.institutions.includes("Zhejiang University"));
    assert.equal(payload.results[0].candidateId, candidate.candidateId);
    assert.equal(
      candidate.institutionalProfileUrl,
      "https://sociology.zju.edu.cn/faculty/lianghao-dai",
    );
  } finally {
    mockFetch = null;
  }
});

test("Jay Ke-Schutte fragments stay separate and the current main record ranks first", async () => {
  const openAlexAuthors = [
    {
      id: "https://openalex.org/A5024152784",
      display_name: "Jay Ke‐Schutte",
      display_name_alternatives: ["Jay Ke-Schutte"],
      orcid: "https://orcid.org/0000-0002-8183-1409",
      works_count: 3,
      last_known_institutions: [{ display_name: "Zhejiang University" }],
      topics: [{ display_name: "Multilingual Education and Policy" }],
    },
    {
      id: "https://openalex.org/A5033374330",
      display_name: "Jay Ke-Schutte",
      works_count: 20,
      last_known_institutions: [{ display_name: "Zhejiang University" }],
      topics: [
        { display_name: "Multilingual Education and Policy" },
        { display_name: "Anthropology" },
      ],
    },
    {
      id: "https://openalex.org/A5099509696",
      display_name: "Jay Ke-Schutte",
      works_count: 2,
    },
    {
      id: "https://openalex.org/A5129637301",
      display_name: "Ke-Schutte, Jay",
      works_count: 1,
    },
  ];
  const openAlexWorks = [
    {
      id: "https://openalex.org/W2026",
      doi: "https://doi.org/10.1017/sas.2026.10058",
      title:
        "From Berimbolo to Bolo-Player: Kinesic Enregisterment and Motion Text in the Jitsuverse",
      publication_year: 2026,
      authorships: [
        {
          author: {
            id: "https://openalex.org/A5033374330",
            display_name: "Jay Ke-Schutte",
          },
          institutions: [{ display_name: "Zhejiang University" }],
        },
      ],
    },
    {
      id: "https://openalex.org/W2025",
      doi: "https://doi.org/10.30676/jfas.160917",
      title: "Book Review: The Right to be Counted",
      publication_year: 2025,
      authorships: [
        {
          author: {
            id: "https://openalex.org/A5024152784",
            display_name: "Jay Ke‐Schutte",
          },
          institutions: [{ display_name: "Zhejiang University" }],
        },
      ],
    },
    {
      id: "https://openalex.org/WBOOK",
      doi: "https://doi.org/10.1525/9780520389823-004",
      title: "Introduction",
      publication_year: 2023,
      authorships: [
        {
          author: {
            id: "https://openalex.org/A5099509696",
            display_name: "Jay Ke-Schutte",
          },
        },
      ],
    },
    {
      id: "https://openalex.org/WBOOKROOT",
      doi: "https://doi.org/10.1525/9780520389823",
      title: "Angloscene",
      publication_year: 2023,
      authorships: [
        {
          author: {
            id: "https://openalex.org/A5033374330",
            display_name: "Jay Ke-Schutte",
          },
        },
      ],
    },
    {
      id: "https://openalex.org/WBOOKNOID",
      title: "Angloscene",
      publication_year: 2023,
      authorships: [
        {
          author: {
            id: "https://openalex.org/A5129637301",
            display_name: "Ke-Schutte, Jay",
          },
        },
      ],
    },
  ];
  const crossrefWorks = [
    {
      DOI: "10.1017/sas.2026.10058",
      title: [
        "From Berimbolo to Bolo-Player: Kinesic Enregisterment and Motion Text in the Jitsuverse",
      ],
      author: [{ given: "Jay", family: "Ke-Schutte" }],
      "container-title": ["Signs and Society"],
      subject: ["Anthropology", "Linguistics"],
      published: { "date-parts": [[2026]] },
    },
    {
      DOI: "10.30676/jfas.160917",
      title: ["Book Review: The Right to be Counted"],
      author: [
        {
          given: "Jay",
          family: "Ke-Schutte",
          ORCID: "https://orcid.org/0000-0002-8183-1409",
          affiliation: [{ name: "Zhejiang University" }],
        },
      ],
      subject: ["Anthropology"],
      published: { "date-parts": [[2025]] },
    },
    {
      DOI: "10.1525/9780520389823-004",
      title: ["Introduction"],
      type: "book-chapter",
      ISBN: ["9780520389823"],
      author: [{ given: "Jay", family: "Ke-Schutte" }],
      published: { "date-parts": [[2023]] },
    },
  ];

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
            display_name: "Zhejiang University",
            display_name_alternatives: ["浙江大学"],
          },
        ],
      });
    }
    if (url.hostname === "api.openalex.org" && url.pathname === "/authors") {
      return json({ results: openAlexAuthors });
    }
    if (url.hostname === "api.openalex.org" && url.pathname === "/works") {
      return json({ results: openAlexWorks });
    }
    if (url.hostname === "api.crossref.org") {
      return json({ message: { items: crossrefWorks } });
    }
    if (url.hostname.includes("semanticscholar.org")) return json({}, 429);
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const response = await worker.fetch(
      new Request(
        "http://anthropology-canteen.localhost:3000/api/search?kind=scholar&mode=name&q=Jay%20Ke-Schutte&institution=Zhejiang%20University&topic=anthropology",
      ),
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    const exact = payload.results.filter(
      (candidate) =>
        candidate.label
          .normalize("NFKD")
          .replace(/[^\p{L}\p{N}]+/gu, "")
          .toLowerCase() === "jaykeschutte",
    );
    assert.equal(exact.length, 3, JSON.stringify(payload.results, null, 2));
    const candidate = payload.results[0];
    assert.deepEqual(candidate.openAlexIds, ["A5033374330"]);
    assert.equal(candidate.representativeWorks[0].year, 2026);
    assert.equal(
      candidate.representativeWorks[0].doi,
      "10.1017/sas.2026.10058",
    );
    assert.equal(candidate.mergedRecordCount, 1);
    assert.ok(
      payload.results.some(
        (item) => item.orcid === "0000-0002-8183-1409",
      ),
    );
  } finally {
    mockFetch = null;
  }
});

test("conflicting ORCIDs and common same names remain separate", async () => {
  mockFetch = async (input) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input : input.url,
    );
    if (url.hostname === "api.openalex.org" && url.pathname === "/authors") {
      const query = url.searchParams.get("search") || "";
      if (/Michael/i.test(query)) {
        return json({
          results: [
            {
              id: "https://openalex.org/A100",
              display_name: "Michael Jackson",
              works_count: 20,
              last_known_institutions: [
                { display_name: "Harvard University" },
              ],
            },
            {
              id: "https://openalex.org/A101",
              display_name: "Michael Jackson",
              works_count: 30,
              last_known_institutions: [
                { display_name: "University of California" },
              ],
            },
          ],
        });
      }
      return json({
        results: [
          {
            id: "https://openalex.org/A200",
            display_name: "Alexandra Rare-Surname",
            orcid: "https://orcid.org/0000-0001-1111-1111",
            works_count: 4,
          },
          {
            id: "https://openalex.org/A201",
            display_name: "Alexandra Rare-Surname",
            orcid: "https://orcid.org/0000-0002-2222-2222",
            works_count: 5,
          },
        ],
      });
    }
    if (url.hostname === "api.openalex.org" && url.pathname === "/works") {
      return json({ results: [] });
    }
    return json({}, 503);
  };

  try {
    const rareResponse = await worker.fetch(
      new Request(
        "http://local/api/search?kind=scholar&mode=name&q=Alexandra%20Rare-Surname",
      ),
    );
    const rare = await rareResponse.json();
    assert.equal(rare.results.length, 2);
    assert.deepEqual(
      rare.results.map((item) => item.orcid).sort(),
      ["0000-0001-1111-1111", "0000-0002-2222-2222"],
    );

    const commonResponse = await worker.fetch(
      new Request(
        "http://local/api/search?kind=scholar&mode=name&q=Michael%20Jackson",
      ),
    );
    const common = await commonResponse.json();
    assert.equal(common.results.length, 2);
    assert.ok(common.results.every((item) => item.openAlexIds.length === 1));
  } finally {
    mockFetch = null;
  }
});

test("feed refresh queries a saved multi-ID scholar as one profile", async () => {
  const authors = [
    {
      id: "https://openalex.org/A5024152784",
      display_name: "Jay Ke‐Schutte",
      orcid: "https://orcid.org/0000-0002-8183-1409",
      works_count: 3,
      last_known_institutions: [{ display_name: "Zhejiang University" }],
      topics: [{ display_name: "Linguistic Anthropology" }],
    },
    {
      id: "https://openalex.org/A5033374330",
      display_name: "Jay Ke-Schutte",
      works_count: 20,
      last_known_institutions: [{ display_name: "Zhejiang University" }],
      topics: [{ display_name: "Linguistic Anthropology" }],
    },
  ];
  const works = [
    {
      id: "https://openalex.org/W2026",
      doi: "https://doi.org/10.1017/sas.2026.10058",
      title:
        "From Berimbolo to Bolo-Player: Kinesic Enregisterment and Motion Text in the Jitsuverse",
      publication_date: "2026-01-10",
      publication_year: 2026,
      type: "article",
      authorships: [
        {
          author: {
            id: "https://openalex.org/A5033374330",
            display_name: "Jay Ke-Schutte",
          },
          institutions: [{ display_name: "Zhejiang University" }],
        },
      ],
      primary_location: {
        source: { display_name: "Signs and Society" },
      },
      topics: [{ display_name: "Linguistic Anthropology" }],
    },
    {
      id: "https://openalex.org/W2025",
      doi: "https://doi.org/10.30676/jfas.160917",
      title: "Book Review: The Right to be Counted",
      publication_date: "2025-04-15",
      publication_year: 2025,
      type: "article",
      authorships: [
        {
          author: {
            id: "https://openalex.org/A5024152784",
            display_name: "Jay Ke‐Schutte",
            orcid: "https://orcid.org/0000-0002-8183-1409",
          },
          institutions: [{ display_name: "Zhejiang University" }],
        },
      ],
      primary_location: {
        source: { display_name: "Suomen Antropologi" },
      },
    },
  ];
  const crossrefItems = [
    {
      DOI: "10.1017/sas.2026.10058",
      title: [works[0].title],
      author: [{ given: "Jay", family: "Ke-Schutte" }],
      "container-title": ["Signs and Society"],
      subject: ["Linguistic Anthropology"],
      published: { "date-parts": [[2026, 1, 10]] },
    },
    {
      DOI: "10.30676/jfas.160917",
      title: [works[1].title],
      author: [
        {
          given: "Jay",
          family: "Ke-Schutte",
          ORCID: "https://orcid.org/0000-0002-8183-1409",
          affiliation: [{ name: "Zhejiang University" }],
        },
      ],
      subject: ["Anthropology"],
      published: { "date-parts": [[2025, 4, 15]] },
    },
  ];

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
            display_name: "Zhejiang University",
            display_name_alternatives: ["浙江大学"],
          },
        ],
      });
    }
    if (url.hostname === "api.openalex.org" && url.pathname === "/authors") {
      return json({ results: authors });
    }
    if (url.hostname === "api.openalex.org" && url.pathname === "/works") {
      return json({ results: works });
    }
    if (url.hostname === "api.crossref.org") {
      return json({ message: { items: crossrefItems } });
    }
    if (url.hostname.includes("semanticscholar.org")) return json({}, 429);
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const response = await worker.fetch(
      new Request("http://local/api/feed", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          subscriptions: {
            journal: [],
            keyword: [],
            scholar: [
              {
                subscriptionId: "orcid:0000-0002-8183-1409",
                label: "Jay Ke-Schutte",
                openAlexIds: ["A5024152784", "A5033374330"],
                semanticScholarIds: [],
                orcid: "0000-0002-8183-1409",
                institution: "Zhejiang University",
                institutions: ["Zhejiang University"],
                researchAreas: ["Linguistic Anthropology"],
                followedAt: "2024-01-01T00:00:00.000Z",
              },
            ],
          },
        }),
      }),
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.scholars.length, 1);
    assert.equal(
      payload.scholars[0].subscriptionId,
      "orcid:0000-0002-8183-1409",
    );
    assert.deepEqual(
      [...payload.scholars[0].openAlexIds].sort(),
      ["A5024152784", "A5033374330"],
    );
    assert.equal(
      payload.scholars[0].followedAt,
      "2024-01-01T00:00:00.000Z",
    );
    assert.ok(
      payload.items.some(
        (item) => item.doi === "10.1017/sas.2026.10058",
      ),
    );
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
            abstract_inverted_index: {
              An: [0],
              account: [1],
              of: [2],
              lived: [3],
              worlds: [4],
            },
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
    assert.equal(payload.works[0].abstract, "An account of lived worlds");
    assert.equal(payload.needsConfirmation, false);
  } finally {
    mockFetch = null;
  }
});

test("OpenAlex scholar profiles follow cursors, deduplicate works, and sort newest first", async () => {
  let workRequests = 0;
  mockFetch = async (input) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input : input.url,
    );
    if (url.pathname === "/authors/A9876543210") {
      return json({
        id: "https://openalex.org/A9876543210",
        display_name: "Cheryl Mattingly",
        works_count: 3,
        last_known_institutions: [{ display_name: "Aarhus University" }],
      });
    }
    if (url.pathname === "/works") {
      workRequests += 1;
      assert.equal(url.searchParams.get("per-page"), "200");
      if (url.searchParams.get("cursor") === "*") {
        return json({
          results: [
            {
              id: "https://openalex.org/W-2024",
              title: "Earlier Work",
              publication_year: 2024,
            },
            {
              id: "https://openalex.org/W-2026",
              doi: "https://doi.org/10.5555/cheryl-2026",
              title: "Newest Work",
              publication_year: 2026,
            },
          ],
          meta: { next_cursor: "page-2" },
        });
      }
      assert.equal(url.searchParams.get("cursor"), "page-2");
      return json({
        results: [
          {
            id: "https://openalex.org/W-2026-DUPLICATE",
            doi: "https://doi.org/10.5555/cheryl-2026",
            title: "Newest Work",
            publication_year: 2026,
          },
          {
            id: "https://openalex.org/W-2025",
            title: "Middle Work",
            publication_year: 2025,
          },
        ],
        meta: { next_cursor: null },
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const response = await worker.fetch(
      new Request(
        "http://local/api/scholar-profile?openAlexId=A9876543210&name=cheryl%20mattingly",
      ),
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(workRequests, 2);
    assert.equal(payload.candidate.label, "Cheryl Mattingly");
    assert.deepEqual(
      payload.works.map((work) => work.year),
      [2026, 2025, 2024],
    );
    assert.equal(payload.works.length, 3);
  } finally {
    mockFetch = null;
  }
});

test("Semantic Scholar profile loads Veena Das publications after selection", async () => {
  mockFetch = async (input) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input : input.url,
    );
    if (
      url.hostname.includes("semanticscholar.org") &&
      url.pathname === "/graph/v1/author/46264128"
    ) {
      assert.ok(!(url.searchParams.get("fields") || "").includes("aliases"));
      return json({
        authorId: "46264128",
        name: "V. Das",
        paperCount: 179,
        url: "https://www.semanticscholar.org/author/46264128",
      });
    }
    if (
      url.hostname.includes("semanticscholar.org") &&
      url.pathname === "/graph/v1/author/46264128/papers"
    ) {
      assert.equal(url.searchParams.get("limit"), "1000");
      return json({
        data: [
          {
            paperId: "P1",
            title: "Ordinary Ethics",
            year: 2020,
            venue: "Textures of the Ordinary",
            abstract: "An anthropological account of ordinary ethics.",
            authors: [{ authorId: "46264128", name: "V. Das" }],
          },
        ],
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const response = await worker.fetch(
      new Request(
        "http://local/api/scholar-profile?semanticScholarId=46264128&name=veena%20das",
      ),
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.candidate.label, "Veena Das");
    assert.equal(payload.candidate.externalIds.semanticScholar, "46264128");
    const ordinaryEthics = payload.works.find(
      (work) => work.title === "Ordinary Ethics",
    );
    assert.ok(ordinaryEthics);
    assert.equal(
      ordinaryEthics.abstract,
      "An anthropological account of ordinary ethics.",
    );
  } finally {
    mockFetch = null;
  }
});
