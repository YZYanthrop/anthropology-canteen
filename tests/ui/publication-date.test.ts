import { describe, expect, test } from "vitest";

import {
  comparePublicationDates,
  formatPublicationDate,
  morePrecisePublicationDate,
  normalizePublicationDate,
  publicationDateFromParts,
  publicationDateFromValue,
  publicationIsAfterFollow,
} from "../../app/lib/publication-date";

describe("publication date precision", () => {
  test("keeps only date parts supplied by providers", () => {
    expect(publicationDateFromValue("2025", 2024)).toEqual({
      publishedAt: "2025-01-01",
      publishedPrecision: "year",
    });
    expect(publicationDateFromValue("2025-07")).toEqual({
      publishedAt: "2025-07-01",
      publishedPrecision: "month",
    });
    expect(publicationDateFromParts([2025, 7, 9])).toEqual({
      publishedAt: "2025-07-09",
      publishedPrecision: "day",
    });
  });

  test("treats legacy January 1 placeholders as year-only", () => {
    const legacy = normalizePublicationDate("2024-01-01");
    expect(legacy.publishedPrecision).toBe("year");
    expect(formatPublicationDate(legacy)).toBe("2024年");
  });

  test("sorts known components first and uses the id as final tie-breaker", () => {
    const values = [
      { id: "z", publishedAt: "2025-01-01", publishedPrecision: "year" as const },
      { id: "b", publishedAt: "2025-06-01", publishedPrecision: "month" as const },
      { id: "a", publishedAt: "2025-06-01", publishedPrecision: "day" as const },
      { id: "c", publishedAt: "2025-06-02", publishedPrecision: "day" as const },
      { id: "a2", publishedAt: "2025-06-01", publishedPrecision: "day" as const },
    ];
    expect(values.sort(comparePublicationDates).map((item) => item.id)).toEqual([
      "c",
      "a",
      "a2",
      "b",
      "z",
    ]);
  });

  test("only marks a publication new when precision proves it is later", () => {
    const followedAt = "2025-06-15T08:00:00.000Z";
    expect(
      publicationIsAfterFollow(
        { publishedAt: "2025-01-01", publishedPrecision: "year" },
        followedAt,
      ),
    ).toBe(false);
    expect(
      publicationIsAfterFollow(
        { publishedAt: "2025-06-01", publishedPrecision: "month" },
        followedAt,
      ),
    ).toBe(false);
    expect(
      publicationIsAfterFollow(
        { publishedAt: "2025-06-16", publishedPrecision: "day" },
        followedAt,
      ),
    ).toBe(true);
  });

  test("duplicate records prefer the more precise valid date", () => {
    expect(
      morePrecisePublicationDate(
        { publishedAt: "2025-01-01", publishedPrecision: "year" },
        { publishedAt: "2025-06-01", publishedPrecision: "month" },
      ),
    ).toEqual({
      publishedAt: "2025-06-01",
      publishedPrecision: "month",
    });
  });
});
