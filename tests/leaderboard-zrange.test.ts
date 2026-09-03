/**
 * VAL BORBERA HILLCLIMB — Sorted-set reply normalisation
 *
 * The leaderboard returned HTTP 500 — "Leaderboard service is unavailable right now" — for
 * every request against a board that had anything on it. `redis.zrange(..., { withScores:
 * true })` replies with a FLAT array, `[member, score, member, score, ...]`, and the route
 * read it as an array of `{ member, score }` objects. The members fell through a
 * `typeof === "string"` branch and lost their scores; the scores took the object branch,
 * where `item.member` on a number is `undefined`, and the next line called `.startsWith` on
 * it. That threw, and the handler's catch turned it into a 500.
 *
 * The defect was invisible for as long as the board stayed empty, because the loop that
 * crashes never ran: an empty board returns 200 with `entries: []`, which is what every
 * check of this endpoint ever saw. It broke the moment the first time was posted.
 *
 * Every case below is a shape the route has to survive, since which reply you get depends on
 * the client version and the transport. A leaderboard that tolerates an unexpected reply is
 * strictly better than one that 500s.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toScoredMembers } from "../src/lib/zrange";

describe("Sorted-set replies are normalised, whichever shape they arrive in", () => {
  it("reads the FLAT reply Upstash actually sends", () => {
    // This is the case that was returning 500 in production.
    const raw = ["p_alice", 91234, "p_bob", 95001, "p_carol", 102900];
    assert.deepEqual(toScoredMembers(raw), [
      { member: "p_alice", score: 91234 },
      { member: "p_bob", score: 95001 },
      { member: "p_carol", score: 102900 },
    ]);
  });

  it("reads the object reply too", () => {
    const raw = [
      { member: "p_alice", score: 91234 },
      { member: "p_bob", score: 95001 },
    ];
    assert.deepEqual(toScoredMembers(raw), [
      { member: "p_alice", score: 91234 },
      { member: "p_bob", score: 95001 },
    ]);
  });

  it("returns nothing for an empty board, and does not throw on junk", () => {
    assert.deepEqual(toScoredMembers([]), []);
    assert.deepEqual(toScoredMembers(null), []);
    assert.deepEqual(toScoredMembers(undefined), []);
    assert.deepEqual(toScoredMembers("not an array"), []);
    assert.deepEqual(toScoredMembers({ member: "x", score: 1 }), []);
  });

  it("keeps scores as numbers even when the transport stringifies them", () => {
    // A JSON transport can hand back "91234" rather than 91234; the route sorts and renders
    // on this value, so a string would compare lexicographically and mis-rank the board.
    const out = toScoredMembers(["p_alice", "91234", "p_bob", "9501"]);
    assert.deepEqual(out, [
      { member: "p_alice", score: 91234 },
      { member: "p_bob", score: 9501 },
    ]);
    for (const row of out) assert.strictEqual(typeof row.score, "number");
  });

  it("drops a trailing member with no score rather than ranking it first", () => {
    // An odd-length flat reply is malformed. Pairing the stray member with a default of 0
    // would put it at the top of a board sorted by ascending time.
    assert.deepEqual(toScoredMembers(["p_alice", 91234, "p_orphan"]), [
      { member: "p_alice", score: 91234 },
    ]);
  });

  it("skips empty and missing members in either shape", () => {
    assert.deepEqual(toScoredMembers(["", 1, "p_real", 2]), [{ member: "p_real", score: 2 }]);
    assert.deepEqual(
      toScoredMembers([{ member: undefined, score: 1 }, { member: "p_real", score: 2 }]),
      [{ member: "p_real", score: 2 }]
    );
  });

  it("substitutes 0 for a score that is not a number at all", () => {
    // Better a rank of zero than NaN propagating into the rendered time.
    assert.deepEqual(toScoredMembers(["p_alice", "not-a-number"]), [
      { member: "p_alice", score: 0 },
    ]);
  });
});
