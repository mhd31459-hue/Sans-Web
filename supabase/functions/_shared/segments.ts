// The map as the extension receives it, shared by map, draft-map, report and account.
// id lets a viewer rate a segment from the player; status lets a "confirmed only"
// profile ignore unreviewed drafts.
export const SEGMENT_COLUMNS = "id,start_s,end_s,category,severity,source,status";

// deno-lint-ignore no-explicit-any
export async function titleMap(db: any, titleId: number) {
  const { data } = await db.from("segments").select(SEGMENT_COLUMNS)
    .eq("title_id", titleId).neq("status", "rejected").order("start_s");
  // deno-lint-ignore no-explicit-any
  return (data ?? []).map((s: any) => ({
    id: s.id, start: s.start_s, end: s.end_s, category: s.category,
    severity: s.severity, source: s.source, status: s.status,
  }));
}
