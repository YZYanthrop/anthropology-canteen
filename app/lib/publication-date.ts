export type PublicationPrecision = "day" | "month" | "year";

export type PublicationDate = {
  publishedAt: string;
  publishedPrecision: PublicationPrecision;
};

const PRECISION_RANK: Record<PublicationPrecision, number> = {
  year: 1,
  month: 2,
  day: 3,
};

function validYear(value: number) {
  return Number.isInteger(value) && value >= 1000 && value <= 9999;
}

function validMonth(value: number) {
  return Number.isInteger(value) && value >= 1 && value <= 12;
}

function validDay(year: number, month: number, value: number) {
  if (!Number.isInteger(value) || value < 1) return false;
  return value <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function canonicalDate(year: number, month = 1, day = 1) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function isPublicationPrecision(
  value: unknown,
): value is PublicationPrecision {
  return value === "day" || value === "month" || value === "year";
}

export function publicationDateFromValue(
  value: unknown,
  fallbackYear?: number,
): PublicationDate {
  const raw = typeof value === "string" ? value.trim() : "";
  const match = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?/.exec(raw);
  if (match) {
    const year = Number(match[1]);
    const month = match[2] ? Number(match[2]) : 1;
    const day = match[3] ? Number(match[3]) : 1;
    if (
      validYear(year) &&
      validMonth(month) &&
      validDay(year, month, day)
    ) {
      return {
        publishedAt: canonicalDate(year, month, day),
        publishedPrecision: match[3] ? "day" : match[2] ? "month" : "year",
      };
    }
  }

  const year = validYear(Number(fallbackYear)) ? Number(fallbackYear) : 1900;
  return {
    publishedAt: canonicalDate(year),
    publishedPrecision: "year",
  };
}

export function publicationDateFromParts(
  parts: unknown,
  fallback?: unknown,
): PublicationDate {
  if (Array.isArray(parts) && parts.length > 0) {
    const year = Number(parts[0]);
    const month = parts.length > 1 ? Number(parts[1]) : 1;
    const day = parts.length > 2 ? Number(parts[2]) : 1;
    if (
      validYear(year) &&
      validMonth(month) &&
      validDay(year, month, day)
    ) {
      return {
        publishedAt: canonicalDate(year, month, day),
        publishedPrecision: parts.length > 2 ? "day" : parts.length > 1 ? "month" : "year",
      };
    }
  }
  return publicationDateFromValue(fallback);
}

export function effectivePublicationPrecision(
  publishedAt: string,
  explicit?: unknown,
): PublicationPrecision {
  if (isPublicationPrecision(explicit)) return explicit;
  if (/^\d{4}$/.test(publishedAt.trim())) return "year";
  if (/^\d{4}-\d{1,2}$/.test(publishedAt.trim())) return "month";
  // Legacy providers used January 1 as an unknown-date placeholder.
  if (/^\d{4}-01-01(?:T|$)/.test(publishedAt.trim())) return "year";
  return "day";
}

export function normalizePublicationDate(
  publishedAt: unknown,
  publishedPrecision?: unknown,
  fallbackYear?: number,
): PublicationDate {
  const normalized = publicationDateFromValue(publishedAt, fallbackYear);
  return {
    ...normalized,
    publishedPrecision: effectivePublicationPrecision(
      typeof publishedAt === "string" ? publishedAt : normalized.publishedAt,
      publishedPrecision,
    ),
  };
}

function dateParts(value: PublicationDate) {
  const normalized = normalizePublicationDate(
    value.publishedAt,
    value.publishedPrecision,
  );
  const [year, month, day] = normalized.publishedAt.split("-").map(Number);
  return { ...normalized, year, month, day };
}

export function comparePublicationDates(
  left: PublicationDate & { id?: string },
  right: PublicationDate & { id?: string },
) {
  const a = dateParts(left);
  const b = dateParts(right);
  if (a.year !== b.year) return b.year - a.year;

  const aHasMonth = a.publishedPrecision !== "year";
  const bHasMonth = b.publishedPrecision !== "year";
  if (aHasMonth !== bHasMonth) return aHasMonth ? -1 : 1;
  if (aHasMonth && a.month !== b.month) return b.month - a.month;

  const aHasDay = a.publishedPrecision === "day";
  const bHasDay = b.publishedPrecision === "day";
  if (aHasDay !== bHasDay) return aHasDay ? -1 : 1;
  if (aHasDay && a.day !== b.day) return b.day - a.day;

  return String(left.id || "").localeCompare(String(right.id || ""), "en");
}

export function morePrecisePublicationDate(
  current: PublicationDate,
  candidate: PublicationDate,
) {
  const currentPrecision = effectivePublicationPrecision(
    current.publishedAt,
    current.publishedPrecision,
  );
  const candidatePrecision = effectivePublicationPrecision(
    candidate.publishedAt,
    candidate.publishedPrecision,
  );
  return PRECISION_RANK[candidatePrecision] > PRECISION_RANK[currentPrecision]
    ? normalizePublicationDate(candidate.publishedAt, candidatePrecision)
    : normalizePublicationDate(current.publishedAt, currentPrecision);
}

export function publicationIsAfterFollow(
  publication: PublicationDate,
  followedAt: string,
) {
  const published = dateParts(publication);
  const followed = publicationDateFromValue(followedAt);
  const [followYear, followMonth, followDay] = followed.publishedAt
    .split("-")
    .map(Number);
  if (published.year !== followYear) return published.year > followYear;
  if (published.publishedPrecision === "year") return false;
  if (published.month !== followMonth) return published.month > followMonth;
  if (published.publishedPrecision === "month") return false;
  return published.day > followDay;
}

export function formatPublicationDate(value: PublicationDate) {
  const normalized = dateParts(value);
  if (normalized.publishedPrecision === "year") return `${normalized.year}年`;
  if (normalized.publishedPrecision === "month") {
    return `${normalized.year}年${normalized.month}月`;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: normalized.year === new Date().getFullYear() ? undefined : "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${normalized.publishedAt}T00:00:00Z`));
}

export function relativePublicationDate(value: PublicationDate) {
  const normalized = dateParts(value);
  if (normalized.publishedPrecision !== "day") {
    return formatPublicationDate(normalized);
  }
  const timestamp = Date.parse(`${normalized.publishedAt}T00:00:00Z`);
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days = Math.floor((today - timestamp) / 86_400_000);
  if (days <= 0) return "今天";
  if (days === 1) return "昨天";
  if (days < 30) return `${days} 天前`;
  return formatPublicationDate(normalized);
}
