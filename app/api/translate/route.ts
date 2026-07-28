import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function chunks(value: string, max = 450) {
  const sentences = value
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+/);
  const result: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (sentence.length > max) {
      if (current) result.push(current);
      current = "";
      for (let index = 0; index < sentence.length; index += max) {
        result.push(sentence.slice(index, index + max));
      }
      continue;
    }
    if (`${current} ${sentence}`.trim().length > max) {
      if (current) result.push(current);
      current = sentence;
    } else {
      current = `${current} ${sentence}`.trim();
    }
  }
  if (current) result.push(current);
  return result.slice(0, 10);
}

async function translatePart(text: string) {
  const url = new URL("https://api.mymemory.translated.net/get");
  url.searchParams.set("q", text);
  url.searchParams.set("langpair", "en|zh-CN");
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Translation ${response.status}`);
  const data = (await response.json()) as {
    responseData?: { translatedText?: string };
    responseStatus?: number;
  };
  const translated = data.responseData?.translatedText?.trim();
  if (!translated || data.responseStatus !== 200) {
    throw new Error("Translation unavailable");
  }
  return translated;
}

export async function POST(request: NextRequest) {
  let text = "";
  try {
    const body = (await request.json()) as { text?: unknown };
    text = typeof body.text === "string" ? body.text.trim().slice(0, 4500) : "";
  } catch {
    // Invalid bodies are handled below.
  }
  if (!text) {
    return NextResponse.json({ message: "这条记录没有可翻译的摘要。" }, { status: 400 });
  }

  try {
    const translated: string[] = [];
    for (const part of chunks(text)) translated.push(await translatePart(part));
    return NextResponse.json({
      translation: translated.join(" "),
      provider: "MyMemory",
    });
  } catch {
    return NextResponse.json(
      { message: "免费翻译服务暂时不可用，请稍后再试。" },
      { status: 502 },
    );
  }
}
