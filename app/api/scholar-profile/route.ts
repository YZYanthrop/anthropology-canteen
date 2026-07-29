import { NextRequest, NextResponse } from "next/server";
import { getScholarProfile } from "../../lib/scholar-search";

export const dynamic = "force-dynamic";

function clean(value: string | null, max = 200) {
  return (value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

export async function GET(request: NextRequest) {
  const openAlexId = clean(request.nextUrl.searchParams.get("openAlexId"), 80);
  const semanticScholarId = clean(
    request.nextUrl.searchParams.get("semanticScholarId"),
    160,
  );
  const orcid = clean(request.nextUrl.searchParams.get("orcid"), 80);
  const name = clean(request.nextUrl.searchParams.get("name"), 180);
  if (!openAlexId && !semanticScholarId && !orcid && name.length < 2) {
    return NextResponse.json(
      { message: "缺少可用于确认学者身份的信息。" },
      { status: 400 },
    );
  }

  try {
    const profile = await getScholarProfile({
      openAlexId,
      semanticScholarId,
      orcid,
      name,
    });
    return NextResponse.json(profile, {
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      {
        candidate: null,
        candidates: [],
        works: [],
        needsConfirmation: true,
        warnings: ["学者档案索引暂时不可用，请稍后再试。"],
      },
      { status: 502 },
    );
  }
}
