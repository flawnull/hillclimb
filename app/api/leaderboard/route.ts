import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { SIM_VERSION } from "@/game/vehicle/vehicleTuning";

export const runtime = "edge";

interface RunRecord {
  runId?: string;
  playerId?: string;
  playerName?: string;
  carId?: string;
  carClass?: string;
  timeMs?: string;
  penaltyMs?: string;
  createdAt?: string;
  [key: string]: unknown;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const stageId = searchParams.get("stage") || "borbera-sprint";
    const carClass = searchParams.get("class") || "Overall";
    // Sim version is user-supplied and is interpolated into a Redis key, so it is
    // parsed strictly as a non-negative integer; anything else falls back to the
    // current build's version rather than reaching Redis as an arbitrary string.
    const simParam = searchParams.get("sim");
    const simParsed = simParam === null ? NaN : Number(simParam);
    const sim = Number.isInteger(simParsed) && simParsed >= 0 ? simParsed : SIM_VERSION;
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50", 10)));

    const redis = getRedis();
    const lbKey = `lb:${sim}:${stageId}:${carClass}`;

    // Read top N run IDs with scores
    const topRuns = await redis.zrange(lbKey, 0, limit - 1, { withScores: true });

    if (!topRuns || topRuns.length === 0) {
      return NextResponse.json({ stageId, carClass, simVersion: sim, entries: [] });
    }

    const entries = [];
    for (let i = 0; i < topRuns.length; i++) {
      const item = topRuns[i] as { member: string; score: number } | string;
      const member = typeof item === "string" ? item : item.member;
      const scoreMs = typeof item === "string" ? 0 : item.score;

      // Try per-player entry hash first, then fallback to run ID hash
      let runData = (await redis.hgetall(`entry:${sim}:${stageId}:${carClass}:${member}`)) as RunRecord | null;
      if (!runData) {
        runData = (await redis.hgetall(`entry:${sim}:${stageId}:Overall:${member}`)) as RunRecord | null;
      }
      if (!runData) {
        runData = (await redis.hgetall(`run:${member}`)) as RunRecord | null;
      }

      const r = runData || {};
      const displayName = typeof r.playerName === "string" && r.playerName.trim()
        ? r.playerName.trim()
        : member.startsWith("p_") || member.includes("-")
          ? "Ligurian Driver"
          : member;

      entries.push({
        rank: i + 1,
        runId: (typeof r.runId === "string" && r.runId) || member,
        playerId: (typeof r.playerId === "string" && r.playerId) || member,
        playerName: displayName,
        carId: typeof r.carId === "string" ? r.carId : "weiss-blau-30",
        carClass: typeof r.carClass === "string" ? r.carClass : carClass,
        timeMs: parseInt(String(r.timeMs || scoreMs), 10),
        penaltyMs: parseInt(String(r.penaltyMs || "0"), 10),
        totalScoreMs: scoreMs,
        createdAt: typeof r.createdAt === "string" ? r.createdAt : new Date().toISOString(),
      });
    }

    return NextResponse.json({
      stageId,
      carClass,
      simVersion: sim,
      entries,
    });

  } catch (err) {
    console.error("Error in /api/leaderboard:", err);
    return NextResponse.json({ error: "Failed to fetch leaderboard" }, { status: 500 });
  }
}
