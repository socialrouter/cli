/*
 * Which body field the CLI puts a run's inputs in.
 *
 * The one decision in the CLI worth pinning down. It used to be a ternary on
 * "query", which meant an enrichment service's identifiers were sent as
 * `urls` and came back as a 400 the user had to interpret. The offline path
 * (the SDK's generated map) and the online one (the live catalogue) can also
 * disagree, and only the second one knows about services newer than this
 * release.
 *
 * No test framework — Node's own runner, so this package keeps installing
 * with nothing but TypeScript. Imports the source directly: there is nothing
 * to build here, and the module has no relative imports of its own.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as sdk from "@socialrouter/sdk";
import { INPUT_FIELD, inputField } from "../src/input-field.ts";

/** A SocialRouter stand-in exposing only what `inputField` reaches for. */
function clientWith(catalogue: unknown[]) {
  let calls = 0;
  return {
    client: { listServices: async () => (calls++, catalogue) } as never,
    calls: () => calls,
  };
}

/**
 * A service the installed SDK has never heard of — the case the catalogue
 * lookup exists for. Kept fictional on purpose: a real slug would migrate
 * into the generated map on the next SDK bump and quietly stop testing
 * anything, which is exactly what happened to person/info.
 */
const UNRELEASED = {
  platform: "company",
  service: "enrich.beta",
  endpoint: "/v1/enrich/company/enrich.beta",
  input_kind: "identifier",
  input_field: "identifiers",
  accepts: [],
  options: [],
  offers: [{ offer: "apollo/company", source: "apollo", price_per_record: 0, max_inputs: 10, requires_own_key: true }],
};

test("the kind-to-field table covers every input kind", () => {
  assert.deepEqual(INPUT_FIELD, {
    url: "urls",
    query: "queries",
    identifier: "identifiers",
  });
});

test("a known service resolves offline, without touching the network", async () => {
  const { client, calls } = clientWith([]);
  assert.equal(await inputField(client, "reddit/subreddit.posts"), "urls");
  assert.equal(await inputField(client, "googlemaps/place.search"), "queries");
  assert.equal(calls(), 0, "the generated map must answer on its own");
});

test("an unknown service is looked up in the live catalogue, not guessed", async () => {
  // A service newer than this CLI release: absent from the SDK's generated
  // map, so the only way to know its field is to ask. Guessing `urls` here is
  // exactly how identifiers ended up in the wrong field.
  //
  // Deliberately an identifier-kind one — a url-kind stand-in would pass even
  // if the lookup silently defaulted.
  const { client, calls } = clientWith([UNRELEASED]);
  assert.equal(await inputField(client, "company/enrich.beta"), "identifiers");
  assert.equal(calls(), 1);
});

test("a service in neither is a corrective error naming real alternatives", async () => {
  const { client } = clientWith([UNRELEASED]);
  await assert.rejects(
    () => inputField(client, "company/nonsense"),
    (err: Error) => {
      assert.match(err.message, /Unknown service "company\/nonsense"/);
      // Suggestions come from the same subject first, so they are usable.
      assert.match(err.message, /company\/enrich\.beta/);
      assert.match(err.message, /socialrouter services/);
      return true;
    },
  );
});

/*
 * Gated on the SDK release that carries `"identifier"` in the generated
 * input-kind map. This package resolves `@socialrouter/sdk` from npm rather
 * than from the sibling folder, so until it is published an enrichment
 * service simply is not in the offline map — the catalogue path above still
 * covers it, and this flips on by itself once the dependency moves.
 */
const sdkKnowsIdentifiers = Object.values(sdk.SERVICE_INPUT_KIND as Record<string, string>).includes(
  "identifier",
);

test(
  "an enrichment service resolves offline too, once the SDK ships it",
  { skip: !sdkKnowsIdentifiers && "requires @socialrouter/sdk with the identifier kind" },
  async () => {
    const { client, calls } = clientWith([]);
    assert.equal(await inputField(client, "person/info"), "identifiers");
    assert.equal(calls(), 0);
  },
);
