import { RateLimitError, SocialRouterError } from "@socialrouter/sdk";

/*
 * How a failure is printed.
 *
 * Split out of `index.ts` so it can be tested: that file runs the CLI at
 * import. The API writes its errors to be corrected from — the valid option
 * names, the inputs that failed, the closest slug — and the SDK carries all
 * of that on `err.detail`. Printing `err.message` alone threw it away, and
 * dropped the id of a failed run, which is the one handle a user has on it.
 */

/** The corrective fields worth a line of their own, and how to label them. */
const HINTS: [field: string, label: string][] = [
  ["did_you_mean", "Did you mean"],
  ["valid_options", "Valid options"],
  ["allowed_values", "Allowed values"],
  ["invalid_inputs", "Invalid inputs"],
  ["available_offers", "Available offers"],
  ["offers_supporting", "Offers that support it"],
  ["valid_sources", "Valid sources"],
  ["byok_sources", "Sources open to BYOK"],
  ["provider_detail", "Provider said"],
];

/** The lines to print for a failure: the message first, then what fixes it. */
export function describeError(err: unknown): string[] {
  if (!(err instanceof Error)) return ["Unknown error"];
  const lines = [err.message];
  if (!(err instanceof SocialRouterError)) return lines;

  const detail = err.detail as Record<string, unknown> | undefined;
  for (const [field, label] of HINTS) {
    const value = detail?.[field];
    if (value === undefined || value === null) continue;
    // The message usually names these too, but inline in a sentence; on its
    // own line a list is something a user can copy from.
    const text = Array.isArray(value) ? value.join(", ") : String(value);
    if (text && !err.message.includes(text)) lines.push(`${label}: ${text}`);
  }

  if (err instanceof RateLimitError && err.retryAfter !== undefined) {
    lines.push(`Retry in ${err.retryAfter}s.`);
  }
  if (err.extractionId) {
    lines.push(`Run id: ${err.extractionId} (socialrouter get ${err.extractionId})`);
  }
  return lines;
}
