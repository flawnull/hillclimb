import { NextRequest, NextResponse } from "next/server";
import { validateRunSubmission, SubmitRunPayload } from "@/lib/validate";
import { getRedis } from "@/lib/redis";
import { checkRateLimit } from "@/lib/rateLimit";
import { CAR_DEFS } from "@/game/vehicle/cars";
import { SIM_VERSION } from "@/game/vehicle/vehicleTuning";

export const runtime = "edge";

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "127.0.0.1";
    const rl = await checkRateLimit(`submit:${ip}`, 10, 60);
    if (!rl.success) {
      return NextResponse.json({ error: "Too many submissions. Please wait a moment." }, { status: 429 });
    }

    const payload: SubmitRunPayload = await req.json();
    const { runId, stageId, carId, playerId, playerName, timeMs, penaltyMs, checkpointsMs } = payload;

    // Validate submission with anti-cheat checks & headless simulation
    const validation = await validateRunSubmission(payload);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.reason || "Validation rejected" }, { status: 400 });
    }

    const redis = getRedis();
    const car = CAR_DEFS[carId];
    const carClass = car ? car.className : "Classic";
    const totalScoreMs = timeMs + (penaltyMs || 0);
    const playerKey = (playerId && playerId.trim()) || playerName.trim().toLowerCase();

    // 1. Store full run record
    const runRecord = {
      runId,
      stageId,
      carId,
      carClass,
      simVersion: SIM_VERSION,
      playerId: (playerId && playerId.trim()) || "",
      playerName: playerName.trim(),
      playerKey,
      timeMs,
      penaltyMs: penaltyMs || 0,
      totalScoreMs,
      checkpointsMs: JSON.stringify(checkpointsMs || []),
      createdAt: new Date().toISOString(),
    };
    await redis.hset(`run:${runId}`, runRecord);


    // 2. Helper to update leaderboard with per-player GT deduplication & 1000-entry trim
    const updateBoard = async (lbKey: string, entryKey: string) => {
      const existingScore = await redis.zscore(lbKey, playerKey);

      // Only update if no previous score or if new score is faster (lower ms)
      if (existingScore === null || totalScoreMs < existingScore) {
        await redis.zadd(lbKey, {
          score: totalScoreMs,
          member: playerKey,
        });
        await redis.hset(entryKey, runRecord);
        // Trim board to top 1000 entries
        await redis.zremrangebyrank(lbKey, 1000, -1);
      }
    };

    // Class leaderboard: lb:{sim}:{stageId}:{carClass}
    await updateBoard(`lb:${SIM_VERSION}:${stageId}:${carClass}`, `entry:${SIM_VERSION}:${stageId}:${carClass}:${playerKey}`);

    // Overall leaderboard: lb:{sim}:{stageId}:Overall
    await updateBoard(`lb:${SIM_VERSION}:${stageId}:Overall`, `entry:${SIM_VERSION}:${stageId}:Overall:${playerKey}`);

    return NextResponse.json({
      success: true,
      runId,
      simVersion: SIM_VERSION,
      totalScoreMs,
    });

  } catch (err) {
    console.error("Error in /api/run/submit:", err);
    return NextResponse.json({ error: "Failed to submit run" }, { status: 500 });
  }
}

