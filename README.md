# SocialRouter CLI

Command-line interface for the SocialRouter API. Fetch social media data from your terminal, routed across several sources behind one contract per service. Supported platforms include LinkedIn, Instagram, X, Reddit, Facebook, TikTok, YouTube, Pinterest, Bluesky, Snapchat, and Google Maps.

## Installation

```bash
npm install -g @socialrouter/cli
```

Or run without installing:

```bash
npx @socialrouter/cli run linkedin/post.likes "https://linkedin.com/posts/..."
```

Or run locally from the repo:

```bash
cd packages/cli
npm install
npm run build
node dist/index.js
```

## Configuration

### API Key (required)

```bash
export SOCIALROUTER_API_KEY=sr_live_...
```

You can also add it to your shell profile (`~/.zshrc`, `~/.bashrc`) to persist it.

### API Base URL (optional)

By default the CLI points to `https://api.socialrouter.io`:

```bash
export SOCIALROUTER_BASE_URL=http://proxy.example.com:3100
```

## Services and offers

A **service** is `platform/service` — `reddit/subreddit.posts`, `linkedin/profile.info`, `googlemaps/place.search`. That's what you run.

An **offer** is one implementation of that service by a source: `apify/harshmaur`, `brightdata/reddit`. You normally don't pick one — the router walks the failover chain and the result tells you which offer answered (`Served by:`). Pin one with `--provider` when you want that offer and nothing else; pinning is what disables failover.

## Commands

### `run` — Run a service

```bash
socialrouter run <platform>/<service> <input...> [options]
```

| Flag | Description |
|---|---|
| `-p, --provider <offer>` | Pin one offer, e.g. `apify/harshmaur`. Omit to let the router route. |
| `-l, --limit <n>` | Max records (default: 100, max 250) |
| `-o, --options <json>` | Typed options as a JSON object, e.g. `'{"sort":"top"}'` |
| `-j, --json` | Output raw JSON |

Inputs are URLs for a URL service and free-text queries for a query service — `socialrouter services <slug>` says which, and shows the exact accepted shapes.

**Examples:**

```bash
# Likers of a LinkedIn post
socialrouter run linkedin/post.likes "https://linkedin.com/posts/johndoe_some-post-id"

# Instagram profile info as JSON
socialrouter run instagram/profile.info "https://instagram.com/johndoe" -j

# 20 comments from a TikTok video
socialrouter run tiktok/video.comments "https://www.tiktok.com/@user/video/123" -l 20

# Batch LinkedIn profiles
socialrouter run linkedin/profile.info \
  "https://linkedin.com/in/alice" "https://linkedin.com/in/bob"

# Top posts of the week from a subreddit
socialrouter run reddit/subreddit.posts "https://www.reddit.com/r/programming" \
  -o '{"sort":"top","time":"week"}'

# A query-driven service
socialrouter run googlemaps/place.search "coffee shops in Brooklyn" "bakeries in Brooklyn" -l 50

# Pin one offer (no failover)
socialrouter run reddit/subreddit.posts "https://www.reddit.com/r/programming" -p apify/trudax
```

---

### `services` — Browse the catalogue

```bash
socialrouter services                          # everything, grouped by platform
socialrouter services reddit                   # one platform
socialrouter services reddit/subreddit.posts   # detailed view
socialrouter services -j                       # raw JSON
```

The detailed view shows the accepted input shapes with examples, the typed options a service takes, and every offer with its price per record and batch cap, in failover order.

---

### `get` — Retrieve a past run by ID

```bash
socialrouter get ext_a1b2c3d4
socialrouter get ext_a1b2c3d4 -j
```

---

### `sources` — List the data sources behind the offers

```bash
socialrouter sources
socialrouter sources -j
```

---

### `balance` — Check your credit balance

```bash
socialrouter balance
```

```
Credit Balance
  $42.50 USD
```

---

### `usage` — View usage summary

```bash
socialrouter usage
socialrouter usage -d 7    # last 7 days
socialrouter usage -j      # raw JSON
```

```
Usage (last 30d)
  Requests: 156
  Records:  4320
  Credits:  $129.60

  By offer:
    apify/harshmaur: 156 req, 4320 records, $129.60
```

---

## Quick Start

```bash
# 1. Set your API key
export SOCIALROUTER_API_KEY=sr_live_...

# 2. Check your balance
socialrouter balance

# 3. Find a service
socialrouter services linkedin

# 4. Run it
socialrouter run linkedin/post.likes "https://linkedin.com/posts/johndoe_some-post-id"
```

## Migrating from 0.3.x

| 0.3.x | 0.4.0 |
|---|---|
| `extract -u <url> -p apify/linkedin/profile.info` | `run linkedin/profile.info <url>` |
| `extract -U "u1,u2" -p ...` | `run <service> u1 u2` (space-separated) |
| `search -q "q1,q2" -p apify/googlemaps/place.search` | `run googlemaps/place.search "q1" "q2"` |
| `-p apify/reddit/group.posts:trudax` | `run reddit/subreddit.posts <url> -p apify/trudax` |
| `--no-fallback` | pin an offer with `-p` |
| `providers` | `services` (the catalogue) / `sources` (who's behind it) |
