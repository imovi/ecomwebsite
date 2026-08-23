/**
 * A courier did not answer the question.
 *
 * `kind` exists because the two ways this fails need different actions from
 * the person reading the message, and a single "check failed" would hide which
 * one happened:
 *
 *   credentials : the login was rejected. Someone changes the password in
 *                 Settings.
 *   upstream    : the courier was unreachable, slow, or answered something
 *                 unrecognisable. Nothing to fix in the panel — either wait,
 *                 or the endpoint moved and the code needs updating.
 *
 * Never thrown for "this number has no history": that is a successful answer
 * of zero, and conflating the two would put a new customer and a broken
 * integration on the screen looking identical.
 */
export type FraudFailureKind = "credentials" | "upstream";

export class FraudCheckError extends Error {
  constructor(
    readonly courier: string,
    readonly kind: FraudFailureKind,
    message: string,
  ) {
    super(message);
    this.name = "FraudCheckError";
  }
}

export function credentialsRejected(courier: string, detail = ""): FraudCheckError {
  return new FraudCheckError(
    courier,
    "credentials",
    `${courier} rejected the login${detail ? `: ${detail}` : "."}`,
  );
}

export function upstreamFailed(courier: string, detail: string): FraudCheckError {
  return new FraudCheckError(courier, "upstream", `${courier} ${detail}`);
}
