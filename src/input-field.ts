import { SERVICE_INPUT_KIND, type InputKind, type SocialRouter } from "@socialrouter/sdk";

/*
 * Which body field a service's inputs travel in.
 *
 * Split out of `index.ts` so it can be tested: that file has a shebang and
 * calls `program.parse()` at import, so importing it runs the CLI. This is
 * the only part with a decision in it worth pinning down — the rest of
 * `index.ts` is argument wiring and printing.
 */

/** The body field a service's inputs travel in. */
export type InputFieldName = "urls" | "queries" | "identifiers";

/**
 * Exhaustive over `InputKind` rather than a ternary on "query". The ternary
 * shape sent an enrichment service's identifiers as `urls`, which the API
 * rejects with a 400 the user then has to interpret; this way a kind added
 * upstream is a compile error here instead.
 */
export const INPUT_FIELD: Record<InputKind, InputFieldName> = {
  url: "urls",
  query: "queries",
  identifier: "identifiers",
};

/**
 * Known services resolve offline from the SDK's generated map; anything
 * newer than this CLI release is looked up in the live catalogue rather than
 * guessed. A service in neither is a corrective error naming real
 * alternatives, never a request sent on a hunch.
 */
export async function inputField(
  client: SocialRouter,
  service: string,
): Promise<InputFieldName> {
  const known = (SERVICE_INPUT_KIND as Record<string, InputKind>)[service];
  if (known) return INPUT_FIELD[known];

  const catalogue = await client.listServices();
  const match = catalogue.find((s) => `${s.platform}/${s.service}` === service);
  if (!match) {
    const platform = service.split("/")[0];
    const onPlatform = catalogue.filter((s) => s.platform === platform);
    const suggestions = (onPlatform.length ? onPlatform : catalogue)
      .map((s) => `${s.platform}/${s.service}`)
      .slice(0, 12);
    throw new Error(
      `Unknown service "${service}". Available: ${suggestions.join(", ")}.\n` +
        "Run `socialrouter services` for the full catalogue.",
    );
  }
  return match.input_field;
}
