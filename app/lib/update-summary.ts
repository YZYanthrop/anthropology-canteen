export type UpdateResult = {
  status: "success" | "partial" | "failed";
  providers: { provider: string; status: "success" | "failed" }[];
};

export type UpdateAttempt = "idle" | "checking" | "complete" | "failed";

// Presentation only: a successful query does not promise new or exhaustive works.
export function updateSummary(
  coverage: UpdateResult[],
  attempt: UpdateAttempt,
  hasSubscriptions: boolean,
) {
  const counts = {
    success: coverage.filter((entry) => entry.status === "success").length,
    partial: coverage.filter((entry) => entry.status === "partial").length,
    failed: coverage.filter((entry) => entry.status === "failed").length,
  };
  const incomplete = counts.partial + counts.failed > 0;
  const hasResults = coverage.length > 0;
  const title = !hasSubscriptions
    ? "添加学者或期刊关注后，即可检查更新。"
    : attempt === "checking"
      ? "正在检查关注的学者和期刊…"
      : attempt === "failed"
        ? "本次未能完成检查，请稍后重试。"
        : !hasResults
          ? "尚无可用的检查结果。"
          : attempt === "idle"
            ? "以下是上次保存的检查结果。"
            : incomplete
              ? "本次仅完成部分检查，部分数据来源暂时无法查询，请稍后重试。"
              : "本次已完成检查；没有新文章也是正常结果。";
  return {
    counts,
    title,
    failedLabel: attempt === "idle" ? "上次未能检查" : "本次未能检查",
    showResults: hasSubscriptions && hasResults && attempt !== "checking",
    incomplete,
  };
}
