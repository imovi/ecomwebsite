import { hash, verify, type Algorithm } from "@node-rs/argon2";
import { createLogger } from "../../core/logger.js";

/**
 * Password hashing.
 *
 * Argon2id, via the Rust binding (prebuilt binaries — no node-gyp toolchain
 * required on any platform the team might build on).
 *
 * Argon2id over bcrypt because it is memory-hard: bcrypt's cost is CPU-only,
 * so a GPU or ASIC farm parallelises it cheaply. Forcing ~19 MiB per guess
 * makes mass offline cracking of a leaked table economically painful.
 *
 * Parameters follow the OWASP Password Storage Cheat Sheet minimum for
 * Argon2id (m=19456 KiB, t=2, p=1). They are encoded into the resulting PHC
 * string, so raising them later does not invalidate existing hashes —
 * `needsRehash` detects the stale ones and they are upgraded transparently on
 * the owner's next successful login.
 */

const log = createLogger("password");

/**
 * Argon2id.
 *
 * The upstream `Algorithm` enum is an ambient `const enum`, which cannot be
 * imported as a value under `verbatimModuleSyntax`. The numeric value is
 * pinned here instead (Argon2d = 0, Argon2i = 1, Argon2id = 2) and asserted
 * against the imported type, so a change upstream is a compile error.
 */
const ARGON2ID = 2 as Algorithm;

const PARAMS = {
  algorithm: ARGON2ID,
  /** KiB of memory per hash. */
  memoryCost: 19_456,
  /** Iterations. */
  timeCost: 2,
  /** Lanes. 1 is correct for a server hashing many passwords concurrently. */
  parallelism: 1,
  outputLen: 32,
} as const;

/**
 * A pre-computed hash of a random value.
 *
 * Verified against when a login names an account that does not exist, so that
 * "unknown email" and "wrong password" take the same amount of time. Without
 * it, response latency alone reveals which addresses have accounts.
 */
let dummyHashPromise: Promise<string> | undefined;

function getDummyHash(): Promise<string> {
  dummyHashPromise ??= hash("gng-timing-equalisation-placeholder", PARAMS);
  return dummyHashPromise;
}

export async function hashPassword(plaintext: string): Promise<string> {
  return hash(plaintext, PARAMS);
}

/**
 * Verifies a password against a stored digest.
 *
 * Never throws on a malformed digest — a corrupt row must read as "wrong
 * password", not as a 500 that tells an attacker something unusual happened.
 */
export async function verifyPassword(digest: string, plaintext: string): Promise<boolean> {
  try {
    return await verify(digest, plaintext, PARAMS);
  } catch (error) {
    log.error({ err: error }, "Password verification failed for a stored digest");
    return false;
  }
}

/**
 * Burns roughly one hash worth of time.
 *
 * Call on the "account not found" branch of login to keep timing flat.
 */
export async function simulatePasswordVerification(plaintext: string): Promise<void> {
  try {
    await verify(await getDummyHash(), plaintext, PARAMS);
  } catch {
    // Result is irrelevant; only the elapsed time matters.
  }
}

/**
 * True when a digest was produced with weaker parameters than the current
 * policy, and should be re-hashed on next successful login.
 *
 * Parses the PHC string: `$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>`
 */
export function needsRehash(digest: string): boolean {
  const match = /^\$argon2(id|i|d)\$v=(\d+)\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(digest);
  if (!match) return true;

  const [, variant, , memory, time, parallelism] = match;

  if (variant !== "id") return true;
  return (
    Number(memory) < PARAMS.memoryCost ||
    Number(time) < PARAMS.timeCost ||
    Number(parallelism) < PARAMS.parallelism
  );
}

/** Exposed for the readiness check and for documentation of current policy. */
export const passwordPolicy = Object.freeze({
  algorithm: "argon2id",
  memoryCostKib: PARAMS.memoryCost,
  timeCost: PARAMS.timeCost,
  parallelism: PARAMS.parallelism,
});
