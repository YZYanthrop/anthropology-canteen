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
    assert.equal(
      payload.results.length,
      1,
      JSON.stringify(payload.results, null, 2),
    );
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

test("Jay Ke-Schutte split records form one identity with the 2026 work", async () => {
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
    assert.equal(
      exact.length,
      1,
      JSON.stringify(payload.results, null, 2),
    );
    const candidate = exact[0];
    assert.equal(candidate.orcid, "0000-0002-8183-1409");
    assert.deepEqual(
      [...candidate.openAlexIds].sort(),
      openAlexAuthors
        .map((author) => author.id.split("/").at(-1))
        .sort(),
    );
    assert.equal(candidate.representativeWorks[0].year, 2026);
    assert.equal(
      candidate.representativeWorks[0].doi,
      "10.1017/sas.2026.10058",
    );
    assert.ok(candidate.mergedRecordCount >= 5);
    assert.ok(candidate.mergeEvidence.length > 0);
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

test("feed refresh expands and merges existing Jay Ke-Schutte subscriptions", async () => {
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
                subscriptionId: "openalex:A5024152784",
                label: "Jay Ke-Schutte",
                openAlexIds: ["A5024152784"],
                semanticScholarIds: [],
                orcid: "0000-0002-8183-1409",
                institution: "Zhejiang University",
                institutions: ["Zhejiang University"],
                researchAreas: ["Linguistic Anthropology"],
                followedAt: "2024-01-01T00:00:00.000Z",
              },
              {
                subscriptionId: "openalex:A5033374330",
                label: "Jay Ke-Schutte",
                openAlexIds: ["A5033374330"],
                semanticScholarIds: [],
                institution: "Zhejiang University",
                institutions: ["Zhejiang University"],
                researchAreas: ["Linguistic Anthropology"],
                followedAt: "2025-01-01T00:00:00.000Z",
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
