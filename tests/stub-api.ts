import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A stand-in for the API, so the CLI can be driven exactly as a user drives
 * it — a real process, real argv, real HTTP — without spending credits or
 * depending on the network.
 *
 * Every request is recorded: most of what the CLI gets wrong is not what it
 * prints but what it sends (which endpoint, which body field, which query
 * string), and that is only visible from this side.
 */

export interface Recorded {
  method: string;
  path: string;
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
}

export interface StubApi {
  baseUrl: string;
  requests: Recorded[];
  /** Requests that reached a route, in order. */
  close: () => Promise<void>;
}

const OFFER = {
  offer: "apify/harshmaur",
  source: "apify",
  price_per_record: 0.002,
  max_inputs: 100,
  requires_own_key: false,
};

export const CATALOGUE = [
  {
    platform: "reddit",
    service: "subreddit.posts",
    endpoint: "/v1/extract/reddit/subreddit.posts",
    input_kind: "url",
    input_field: "urls",
    accepts: [
      {
        format: "https://www.reddit.com/r/<subreddit>",
        example: "https://www.reddit.com/r/programming",
        note: "Any listing URL works.",
      },
    ],
    options: [
      { name: "sort", type: "enum", values: ["hot", "top"], description: "Listing sort." },
      { name: "since", type: "string", description: "ISO date.", default: "2020-01-01" },
    ],
    offers: [OFFER, { ...OFFER, offer: "apify/trudax", price_per_record: 0.0035, max_inputs: 10 }],
  },
  {
    platform: "person",
    service: "info",
    endpoint: "/v1/enrich/person",
    input_kind: "identifier",
    input_field: "identifiers",
    accepts: [],
    options: [],
    offers: [{ ...OFFER, offer: "apollo/person", source: "apollo", price_per_record: 0, requires_own_key: true }],
  },
];

export const EXTRACTION = {
  id: "ext_abc123",
  status: "completed",
  platform: "reddit",
  service: "subreddit.posts",
  url: "https://www.reddit.com/r/programming",
  served_by: "apify/trudax",
  fallback_from: "apify/harshmaur",
  credits_used: 0.35,
  pagination: { returned: 2, total: 2 },
  data: [
    { name: "Ada Lovelace", title: "Analyst", company: "Analytical Engines" },
    { title: "A post with no name" },
  ],
};

export const CREDENTIAL = {
  id: "cred_1",
  source: "apify",
  label: "prod",
  status: "active",
  last_verified_at: "2026-09-01T00:00:00Z",
  last_used_at: null,
  created_at: "2026-09-01T00:00:00Z",
};

export const BYOK_SETTINGS = {
  byok_mode: "own_first",
  source_modes: { apify: "own_only" },
  available_modes: ["own_first", "platform_first", "own_only", "platform_only"],
  byok_sources: ["apify", "apollo"],
  byok_only_sources: ["apollo"],
};

/**
 * Failures, keyed by path: the status, headers and body the API answers
 * with. Real services, so the CLI resolves their input field offline.
 */
const FAILURES: Record<string, { status: number; headers?: Record<string, string>; body: unknown }> = {
  // A run that failed upstream carries its id beside the envelope.
  "/v1/extract/reddit/post.info": {
    status: 502,
    body: {
      error: {
        code: "provider_credential_rejected",
        message: "Your apify token was refused.",
        type: "provider",
        provider_detail: "token is not valid",
      },
      extraction_id: "ext_failed1",
    },
  },
  "/v1/extract/reddit/post.comments": {
    status: 429,
    headers: { "Retry-After": "42" },
    body: { error: { code: "rate_limited", message: "Too many requests.", type: "rate_limit" } },
  },
  "/v1/extract/linkedin/job.search": {
    status: 400,
    body: {
      error: {
        code: "unknown_option",
        message: 'Unknown option "loc" for linkedin/job.search.',
        type: "validation",
        valid_options: ["location", "country"],
      },
    },
  },
};

const ROUTES: Record<string, unknown> = {
  "/v1/account/credentials": { data: [CREDENTIAL] },
  "/v1/account/credentials/apify": CREDENTIAL,
  "/v1/account/byok-mode": BYOK_SETTINGS,
  "/v1/services": { data: CATALOGUE },
  "/v1/services/reddit": { data: [CATALOGUE[0]] },
  "/v1/services/reddit/subreddit.posts": CATALOGUE[0],
  "/v1/providers": {
    data: [
      {
        id: "apify",
        name: "Apify",
        status: "active",
        description: "Actor marketplace.",
        platforms: ["reddit", "linkedin"],
        services_count: 12,
        offers_count: 20,
      },
      {
        id: "brightdata",
        name: "Bright Data",
        status: "degraded",
        description: "Datasets and proxies.",
        platforms: ["linkedin"],
        services_count: 4,
        offers_count: 6,
      },
    ],
  },
  "/v1/account/balance": { balance: 9.6512, currency: "USD" },
  "/v1/extractions/ext_abc123": EXTRACTION,
  "/v1/extract/reddit/subreddit.posts": EXTRACTION,
  "/v1/enrich/person": { ...EXTRACTION, platform: "person", service: "info" },
};

export async function startStubApi(): Promise<StubApi> {
  const requests: Recorded[] = [];

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString();
      const path = req.url ?? "";
      requests.push({
        method: req.method ?? "GET",
        path,
        body: raw ? JSON.parse(raw) : undefined,
        headers: req.headers,
      });

      const [pathname] = path.split("?");

      const failure = FAILURES[pathname];
      if (failure) {
        res.writeHead(failure.status, { "content-type": "application/json", ...failure.headers });
        res.end(JSON.stringify(failure.body));
        return;
      }
      if (req.method === "DELETE" && pathname === "/v1/account/credentials/apify") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ revoked: true, source: "apify", id: "cred_1" }));
        return;
      }
      // The usage window is asserted from the recorded query string, so the
      // body only has to be well-shaped.
      const payload =
        pathname === "/v1/account/usage"
          ? {
              period: "7d",
              total_requests: 3,
              total_records: 120,
              total_credits: 0.24,
              by_provider: { "apify/harshmaur": { requests: 3, records: 120, credits: 0.24 } },
              by_platform: { reddit: { requests: 3, records: 120, credits: 0.24 } },
            }
          : ROUTES[pathname];

      if (payload === undefined) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { code: "not_found", message: `no route for ${pathname}` } }));
        return;
      }

      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  return {
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    requests,
    close: () => new Promise<void>((resolve) => void server.close(() => resolve())),
  };
}
