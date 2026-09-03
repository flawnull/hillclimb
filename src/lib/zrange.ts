/**
 * VAL BORBERA HILLCLIMB — Sorted-set reply normalisation
 *
 * `redis.zrange(key, start, stop, { withScores: true })` does not return what the
 * leaderboard route assumed it returned. Upstash replies with a FLAT array —
 * `[member, score, member, score, ...]` — where the scores are numbers, not with an array
 * of `{ member, score }` objects.
 *
 * The route read it as objects, with a `typeof item === "string"` branch as the only
 * fallback. Against a flat reply the members took that branch and lost their score, and the
 * scores took the object branch, where `item.member` on a number is `undefined` and the very
 * next line calls `.startsWith` on it. That throws, the handler's catch turns it into a 500,
 * and the client renders "Leaderboard service is unavailable right now."
 *
 * It could only ever fail on a NON-EMPTY board: with no entries the loop never runs and the
 * route returns 200 with `entries: []`, which is exactly how it was left after every check.
 * The leaderboard was therefore broken from the moment the first time was posted, and looked
 * perfectly healthy until then.
 *
 * Both shapes are accepted here rather than picking one, because which you get depends on
 * the client version and the transport, and a leaderboard that 500s is worse than one that
 * tolerates an unexpected reply.
 */

export interface ScoredMember {
  member: string;
  score: number;
}

export function toScoredMembers(raw: unknown): ScoredMember[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];

  const out: ScoredMember[] = [];

  // Object form: [{ member, score }, ...]
  if (typeof raw[0] === "object" && raw[0] !== null) {
    for (const item of raw) {
      if (typeof item !== "object" || item === null) continue;
      const { member, score } = item as { member?: unknown; score?: unknown };
      if (member === undefined || member === null || member === "") continue;
      const n = Number(score);
      out.push({ member: String(member), score: Number.isFinite(n) ? n : 0 });
    }
    return out;
  }

  // Flat form: [member, score, member, score, ...]. A trailing member with no score is
  // dropped rather than given a score of zero, which would rank it first.
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const member = raw[i];
    if (member === undefined || member === null || member === "") continue;
    const n = Number(raw[i + 1]);
    out.push({ member: String(member), score: Number.isFinite(n) ? n : 0 });
  }
  return out;
}
