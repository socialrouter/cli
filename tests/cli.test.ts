import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { startStubApi, type StubApi } from "./stub-api.ts";

/*
 * The CLI as a user runs it: the built binary, real argv, real HTTP against a
 * local stand-in for the API.
 *
 * `src/index.ts` calls `program.parse()` at import, so nothing in it can be
 * imported and driven — spawning is not a heavier alternative to unit tests
 * here, it is the only way to reach the command wiring at all. It also covers
 * what unit tests would miss anyway: exit codes, stderr vs stdout, and which
 * request actually left the process.
 */

const ENTRY = new URL("../dist/index.js", import.meta.url).pathname;
const PKG = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  version: string;
};

let api: StubApi;

before(async () => {
  if (!existsSync(ENTRY)) {
    throw new Error(`${ENTRY} is missing — run \`npm run build\` before the tests.`);
  }
  api = await startStubApi();
});

after(() => api.close());

interface Result {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Run the CLI. `env` overrides the defaults, `null` unsets a variable. */
function run(args: string[], env: Record<string, string | null> = {}): Promise<Result> {
  const base: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    SOCIALROUTER_API_KEY: "sr_test_key",
    SOCIALROUTER_BASE_URL: api.baseUrl,
    // Keep chalk from emitting escape codes: the assertions are about the
    // words, and a TTY-dependent test would pass locally and fail in CI.
    NO_COLOR: "1",
    FORCE_COLOR: "0",
  };
  for (const [k, v] of Object.entries(env)) {
    if (v === null) delete base[k];
    else base[k] = v;
  }

  return new Promise((resolve) => {
    const child = spawn(process.execPath, [ENTRY, ...args], { env: base });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += String(c)));
    child.stderr.on("data", (c) => (stderr += String(c)));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

/** Run the CLI with `input` piped on stdin. */
function runWithStdin(args: string[], input: string): Promise<Result> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [ENTRY, ...args], {
      env: {
        PATH: process.env.PATH ?? "",
        SOCIALROUTER_API_KEY: "sr_test_key",
        SOCIALROUTER_BASE_URL: api.baseUrl,
        NO_COLOR: "1",
        FORCE_COLOR: "0",
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += String(c)));
    child.stderr.on("data", (c) => (stderr += String(c)));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

const lastRequest = (method: string) => [...api.requests].reverse().find((r) => r.method === method);

describe("socialrouter", () => {
  test("reports the version in package.json", async () => {
    // The literal that used to live here said 0.4.0 while the package was
    // 0.4.1, and `--version` is the one thing a user quotes in a bug report.
    const { code, stdout } = await run(["--version"]);
    assert.equal(code, 0);
    assert.equal(stdout.trim(), PKG.version);
  });

  test("lists its commands in --help", async () => {
    const { code, stdout } = await run(["--help"]);
    assert.equal(code, 0);
    for (const command of ["run", "services", "sources", "balance", "usage", "get", "credentials", "byok-mode"]) {
      assert.match(stdout, new RegExp(`\\b${command}\\b`), `${command} missing from --help`);
    }
  });

  test("refuses to run without an API key, naming the variable", async () => {
    const { code, stderr } = await run(["balance"], { SOCIALROUTER_API_KEY: null });
    assert.equal(code, 1);
    assert.match(stderr, /SOCIALROUTER_API_KEY/);
    // The fix belongs in the message, not in a doc the user has to go find.
    assert.match(stderr, /export SOCIALROUTER_API_KEY=/);
  });
});

describe("run", () => {
  test("sends urls for a url-kind service, authenticated and tagged", async () => {
    const { code, stdout } = await run([
      "run",
      "reddit/subreddit.posts",
      "https://www.reddit.com/r/programming",
      "--json",
    ]);

    assert.equal(code, 0);
    const post = lastRequest("POST")!;
    assert.equal(post.path, "/v1/extract/reddit/subreddit.posts");
    assert.deepEqual(post.body, {
      urls: ["https://www.reddit.com/r/programming"],
      limit: 100,
    });
    assert.equal(post.headers.authorization, "Bearer sr_test_key");
    assert.equal(post.headers["x-socialrouter-client"], "cli");
    assert.equal(JSON.parse(stdout).id, "ext_abc123");
  });

  test("sends identifiers to the enrich namespace, not urls to extract", async () => {
    // The bug this whole split exists for: an enrichment service's inputs
    // used to travel as `urls` to /v1/extract, which the API rejects.
    const { code } = await run(["run", "person/info", "ada@analytical.dev", "--json"]);

    assert.equal(code, 0);
    const post = lastRequest("POST")!;
    assert.equal(post.path, "/v1/enrich/person");
    assert.deepEqual(post.body, { identifiers: ["ada@analytical.dev"], limit: 100 });
  });

  test("forwards the provider pin, the limit and typed options", async () => {
    const { code } = await run([
      "run",
      "reddit/subreddit.posts",
      "https://www.reddit.com/r/programming",
      "--provider",
      "apify/trudax",
      "--limit",
      "5",
      "--options",
      '{"sort":"top"}',
      "--json",
    ]);

    assert.equal(code, 0);
    assert.deepEqual(lastRequest("POST")!.body, {
      urls: ["https://www.reddit.com/r/programming"],
      provider: "apify/trudax",
      limit: 5,
      options: { sort: "top" },
    });
  });

  test("takes several inputs in one call", async () => {
    const { code } = await run([
      "run",
      "reddit/subreddit.posts",
      "https://www.reddit.com/r/a",
      "https://www.reddit.com/r/b",
      "--json",
    ]);

    assert.equal(code, 0);
    assert.deepEqual((lastRequest("POST")!.body as { urls: string[] }).urls, [
      "https://www.reddit.com/r/a",
      "https://www.reddit.com/r/b",
    ]);
  });

  test("prints a human summary when --json is absent", async () => {
    const { code, stdout } = await run([
      "run",
      "reddit/subreddit.posts",
      "https://www.reddit.com/r/programming",
    ]);

    assert.equal(code, 0);
    assert.match(stdout, /ext_abc123/);
    // The failover is the product's whole point — it has to be legible.
    assert.match(stdout, /apify\/trudax/);
    assert.match(stdout, /fell over from apify\/harshmaur/);
    assert.match(stdout, /2 of 2 records returned/);
    assert.match(stdout, /Ada Lovelace/);
    // A record with no name must still print rather than vanish.
    assert.match(stdout, /A post with no name/);
  });

  test("rejects a non-object --options before spending a request", async () => {
    for (const bad of ['["sort"]', "null", '"sort"', "{sort:top}"]) {
      const before = api.requests.length;
      const { code, stderr } = await run([
        "run",
        "reddit/subreddit.posts",
        "https://www.reddit.com/r/programming",
        "--options",
        bad,
      ]);

      assert.equal(code, 1, `--options ${bad} should exit 1`);
      assert.match(stderr, /--options must be a JSON object/);
      assert.equal(api.requests.length, before, `--options ${bad} must not reach the API`);
    }
  });

  test("rejects a limit that is not a positive integer", async () => {
    for (const bad of ["0", "-3", "abc", "2.5"]) {
      const before = api.requests.length;
      const { code, stderr } = await run([
        "run",
        "reddit/subreddit.posts",
        "https://www.reddit.com/r/programming",
        "--limit",
        bad,
      ]);

      assert.equal(code, 1, `--limit ${bad} should exit 1`);
      assert.match(stderr, /--limit must be a positive integer/);
      assert.equal(api.requests.length, before, `--limit ${bad} must not reach the API`);
    }
  });

  test("names real alternatives for an unknown service", async () => {
    const posts = () => api.requests.filter((r) => r.method === "POST").length;
    const before = posts();

    const { code, stderr } = await run(["run", "reddit/nonsense", "https://www.reddit.com/r/x"]);

    assert.equal(code, 1);
    assert.match(stderr, /Unknown service "reddit\/nonsense"/);
    assert.match(stderr, /reddit\/subreddit\.posts/);
    assert.equal(posts(), before, "an unknown service must not reach the API");
  });

  test("surfaces an API failure as a non-zero exit", async () => {
    // /v1/extractions/ext_missing has no route: the stub 404s.
    const { code, stderr } = await run(["get", "ext_missing"]);
    assert.equal(code, 1);
    assert.notEqual(stderr.trim(), "");
  });
});

describe("catalogue commands", () => {
  test("services lists every service, grouped by platform", async () => {
    const { code, stdout } = await run(["services"]);
    assert.equal(code, 0);
    assert.match(stdout, /reddit\/subreddit\.posts/);
    assert.match(stdout, /person\/info/);
    // The cheapest offer is what the price line advertises.
    assert.match(stdout, /from \$0\.002\/record/);
    assert.match(stdout, /2 offers/);
  });

  test("services <platform> asks the API to filter, not the CLI", async () => {
    const { code, stdout } = await run(["services", "reddit"]);
    assert.equal(code, 0);
    assert.equal(lastRequest("GET")!.path, "/v1/services/reddit");
    assert.doesNotMatch(stdout, /person\/info/);
  });

  test("services <slug> shows the detailed view", async () => {
    const { code, stdout } = await run(["services", "reddit/subreddit.posts"]);
    assert.equal(code, 0);
    assert.equal(lastRequest("GET")!.path, "/v1/services/reddit/subreddit.posts");
    assert.match(stdout, /POST \/v1\/extract\/reddit\/subreddit\.posts/);
    assert.match(stdout, /body field: urls/);
    // An enum option has to show its allowed values, or it cannot be used.
    assert.match(stdout, /hot \| top/);
    assert.match(stdout, /Default: "2020-01-01"/);
    assert.match(stdout, /default route/);
    assert.match(stdout, /Any listing URL works\./);
  });

  test("services --json prints the payload untouched", async () => {
    const { code, stdout } = await run(["services", "--json"]);
    assert.equal(code, 0);
    const parsed = JSON.parse(stdout) as { service: string }[];
    assert.equal(parsed.length, 2);
  });

  test("sources lists each source with its status", async () => {
    const { code, stdout } = await run(["sources"]);
    assert.equal(code, 0);
    assert.equal(lastRequest("GET")!.path, "/v1/providers");
    assert.match(stdout, /Apify/);
    assert.match(stdout, /\[active\]/);
    assert.match(stdout, /Bright Data/);
    assert.match(stdout, /\[degraded\]/);
  });
});

describe("account commands", () => {
  test("balance prints the amount to the cent", async () => {
    const { code, stdout } = await run(["balance"]);
    assert.equal(code, 0);
    assert.equal(lastRequest("GET")!.path, "/v1/account/balance");
    assert.match(stdout, /\$9\.65/);
    assert.match(stdout, /USD/);
  });

  test("usage defaults to 30 days and honours --days", async () => {
    await run(["usage"]);
    assert.equal(lastRequest("GET")!.path, "/v1/account/usage?days=30");

    const { code, stdout } = await run(["usage", "--days", "7"]);
    assert.equal(code, 0);
    assert.equal(lastRequest("GET")!.path, "/v1/account/usage?days=7");
    assert.match(stdout, /Requests: 3/);
    assert.match(stdout, /apify\/harshmaur/);
    assert.match(stdout, /reddit/);
  });

  test("get fetches a past run by id", async () => {
    const { code, stdout } = await run(["get", "ext_abc123"]);
    assert.equal(code, 0);
    assert.equal(lastRequest("GET")!.path, "/v1/extractions/ext_abc123");
    assert.match(stdout, /ext_abc123/);
    assert.match(stdout, /Ada Lovelace/);
  });
});

describe("errors", () => {
  test("a failed run prints its id and the provider's own words", async () => {
    const { code, stderr } = await run(["run", "reddit/post.info", "https://www.reddit.com/r/x/comments/abc/t"]);
    assert.equal(code, 1);
    assert.match(stderr, /Your apify token was refused\./);
    assert.match(stderr, /Provider said: token is not valid/);
    assert.match(stderr, /Run id: ext_failed1/);
  });

  test("a rate limit says how long to wait", async () => {
    const { code, stderr } = await run(["run", "reddit/post.comments", "https://www.reddit.com/r/x/comments/abc/t"]);
    assert.equal(code, 1);
    assert.match(stderr, /Retry in 42s\./);
  });

  test("a validation error lists what would have been valid", async () => {
    const { code, stderr } = await run([
      "run",
      "linkedin/job.search",
      "engineer",
      "--options",
      '{"loc":"Paris"}',
    ]);
    assert.equal(code, 1);
    assert.match(stderr, /Valid options: location, country/);
  });
});

describe("credentials", () => {
  test("list shows each credential and never a token", async () => {
    const { code, stdout } = await run(["credentials"]);
    assert.equal(code, 0);
    assert.equal(lastRequest("GET")!.path, "/v1/account/credentials");
    assert.match(stdout, /apify/);
    assert.match(stdout, /\[active\]/);
    assert.match(stdout, /prod/);
  });

  test("set reads the token from stdin, not from argv", async () => {
    const { code } = await runWithStdin(["credentials", "set", "apify", "--label", "prod"], "apify_api_secret\n");
    assert.equal(code, 0);
    const put = lastRequest("PUT")!;
    assert.equal(put.path, "/v1/account/credentials/apify");
    assert.deepEqual(put.body, { token: "apify_api_secret", label: "prod" });
  });

  test("set refuses an empty token before calling the API", async () => {
    const before = api.requests.length;
    const { code, stderr } = await runWithStdin(["credentials", "set", "apify"], "");
    assert.equal(code, 1);
    assert.match(stderr, /no token given/);
    assert.equal(api.requests.length, before);
  });

  test("rename without a label clears it", async () => {
    const { code } = await run(["credentials", "rename", "apify"]);
    assert.equal(code, 0);
    const patch = lastRequest("PATCH")!;
    assert.equal(patch.path, "/v1/account/credentials/apify");
    assert.deepEqual(patch.body, { label: null });
  });

  test("remove revokes by source", async () => {
    const { code, stdout } = await run(["credentials", "remove", "apify"]);
    assert.equal(code, 0);
    assert.equal(lastRequest("DELETE")!.path, "/v1/account/credentials/apify");
    assert.match(stdout, /apify credential revoked/);
  });
});

describe("byok-mode", () => {
  test("shows the default and the per-source departures", async () => {
    const { code, stdout } = await run(["byok-mode"]);
    assert.equal(code, 0);
    assert.equal(lastRequest("GET")!.path, "/v1/account/byok-mode");
    assert.match(stdout, /Default: own_first/);
    assert.match(stdout, /apify: own_only/);
    assert.match(stdout, /Reachable only with your key: apollo/);
  });

  test("set writes the default, or one source with --source", async () => {
    await run(["byok-mode", "set", "platform_first"]);
    assert.deepEqual(lastRequest("PUT")!.body, { byok_mode: "platform_first" });

    await run(["byok-mode", "set", "own_only", "--source", "apify"]);
    assert.deepEqual(lastRequest("PUT")!.body, { byok_mode: "own_only", source: "apify" });
  });

  test("clear sends null for the source", async () => {
    const { code } = await run(["byok-mode", "clear", "--source", "apify"]);
    assert.equal(code, 0);
    assert.deepEqual(lastRequest("PUT")!.body, { byok_mode: null, source: "apify" });
  });

  test("an unknown mode fails locally, listing the valid ones", async () => {
    const before = api.requests.length;
    const { code, stderr } = await run(["byok-mode", "set", "always"]);
    assert.equal(code, 1);
    assert.match(stderr, /own_first, platform_first, own_only, platform_only/);
    assert.equal(api.requests.length, before);
  });
});
