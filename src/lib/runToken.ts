/**
 * VAL BORBERA HILLCLIMB — HMAC Run Token Generator & Verifier
 * Edge runtime compatible using Web Crypto API.
 */

import { SIM_VERSION } from "@/game/vehicle/vehicleTuning";

const DEV_SECRET = "val_borbera_dev_secret_key_32_chars_long_!";

/**
 * The HMAC signing key for run tokens.
 *
 * Resolved lazily rather than at module load, so a missing secret surfaces as a failed
 * request rather than breaking the build's page-data collection.
 *
 * In production a missing `RUN_SECRET` is fatal, deliberately. The development fallback
 * below is a literal in a public repository: deploying with it would mean anyone could mint
 * valid run tokens and post forged times to the leaderboard, which is the one thing the
 * whole token mechanism exists to prevent. Failing loudly is the only safe behaviour.
 */
function getSecret(): string {
  const secret = process.env.RUN_SECRET;
  if (process.env.NODE_ENV === "production") {
    if (!secret || secret === DEV_SECRET) {
      throw new Error(
        "RUN_SECRET is not set. Run tokens cannot be signed securely in production — " +
          "set RUN_SECRET to a random value of at least 32 characters."
      );
    }
    return secret;
  }
  return secret || DEV_SECRET;
}

async function getCryptoKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

function bufferToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Mints an HMAC over `runId|stageId|carId|issuedAt|simVersion`.
 * Binding the sim version into the signed payload means a token minted under
 * one physics build cannot be redeemed under another: after a SIM_VERSION bump
 * the server recomputes the HMAC with the new version and the old token no
 * longer matches, so in-flight runs from the previous build cannot be banked.
 */
export async function createRunToken(
  runId: string,
  stageId: string,
  carId: string,
  issuedAt: number,
  simVersion: number = SIM_VERSION
): Promise<string> {
  const key = await getCryptoKey(getSecret());
  const data = `${runId}|${stageId}|${carId}|${issuedAt}|${simVersion}`;
  const enc = new TextEncoder();
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return bufferToHex(signature);
}

export async function verifyRunToken(
  token: string,
  runId: string,
  stageId: string,
  carId: string,
  issuedAt: number,
  simVersion: number = SIM_VERSION
): Promise<boolean> {
  // 30-minute expiry (§12.3)
  const now = Date.now();
  if (now - issuedAt > 30 * 60 * 1000 || now < issuedAt - 10000) {
    return false;
  }

  const expectedToken = await createRunToken(runId, stageId, carId, issuedAt, simVersion);
  return token === expectedToken;
}

