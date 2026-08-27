import { NextRequest, NextResponse } from "next/server";
import { createRunToken } from "@/lib/runToken";
import { checkRateLimit } from "@/lib/rateLimit";
import { SIM_VERSION } from "@/game/vehicle/vehicleTuning";

export const runtime = "edge";

export async function POST(req: NextRequest) {
  try {
    // Prefer `x-real-ip`, which the hosting platform sets itself. `x-forwarded-for` grows by
    // appending at each proxy hop, so its LEFT-most entry is the one the original client can
    // put anything it likes into — reading that first is the classic way to make an IP-keyed
    // rate limit trivially bypassable. Fall back to the RIGHT-most forwarded entry, which is
    // the one added by the nearest trusted proxy, rather than the left-most.
    const forwarded = req.headers.get("x-forwarded-for");
    const nearestHop = forwarded?.split(",").pop()?.trim();
    const ip = req.headers.get("x-real-ip") || nearestHop || "127.0.0.1";
    const rl = await checkRateLimit(`start:${ip}`, 30, 60);
    if (!rl.success) {
      return NextResponse.json({ error: "Rate limit exceeded. Please wait a moment." }, { status: 429 });
    }

    const body = await req.json();
    const { stageId, carId } = body;

    if (!stageId || !carId) {
      return NextResponse.json({ error: "Missing stageId or carId" }, { status: 400 });
    }

    const runId = `run_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const serverTime = Date.now();
    const token = await createRunToken(runId, stageId, carId, serverTime, SIM_VERSION);

    return NextResponse.json({
      runId,
      token,
      serverTime,
      simVersion: SIM_VERSION,
    });

  } catch (err) {
    console.error("Error in /api/run/start:", err);
    return NextResponse.json({ error: "Failed to generate run token" }, { status: 500 });
  }
}

