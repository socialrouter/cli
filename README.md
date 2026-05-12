# SocialRouter CLI

Command-line interface for the SocialRouter API. Extract social media data and run query-driven searches directly from your terminal. Supported platforms include LinkedIn, Instagram, X, Reddit, Facebook, TikTok, YouTube, Pinterest, Bluesky, Snapchat, and Google Maps.

## Installation

```bash
npm install -g @socialrouter/cli
```

Or run without installing:

```bash
npx @socialrouter/cli extract -u "..." -p apify/linkedin/post.likes
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

## Commands

### `extract` — Extract data from one or more URLs

```bash
socialrouter extract -u <url> -p <provider-slug> [options]
socialrouter extract -U <url1,url2,...> -p <provider-slug>
```

| Flag | Description |
|---|---|
| `-u, --url <url>` | Single social media URL |
| `-U, --urls <list>` | Comma-separated list of URLs (batch-capable actors only) |
| `-p, --provider <slug>` | Service slug `provider/platform/type[:tag]` (required) |
| `-l, --limit <n>` | Max records (default: 100) |
| `--no-fallback` | Disable router fallback — fail if the requested provider errors |
| `-j, --json` | Output raw JSON |

The slug fully specifies the routing target: provider, platform, extraction type, and (optionally) actor tag (e.g. `apify/linkedin/profile.posts:apimaestro`). Copy one from [socialrouter.io/providers](https://www.socialrouter.io/providers).

**Examples:**

```bash
# Get likers of a LinkedIn post
socialrouter extract -u "https://linkedin.com/posts/johndoe_some-post-id" -p apify/linkedin/post.likes

# Instagram profile info as JSON
socialrouter extract -u "https://instagram.com/johndoe" -p apify/instagram/profile.info -j

# 20 comments from an X post
socialrouter extract -u "https://x.com/johndoe/status/123456" -p apify/x/post.comments -l 20

# Batch LinkedIn profile fetch
socialrouter extract \
  -U "https://linkedin.com/in/alice,https://linkedin.com/in/bob" \
  -p apify/linkedin/profile.info

# Skip the router fallback chain
socialrouter extract -u "https://linkedin.com/in/johndoe" -p apify/linkedin/profile.info --no-fallback
```

---

### `search` — Run a query-driven search

```bash
socialrouter search -q <queries> -p <provider-slug> [options]
```

| Flag | Description |
|---|---|
| `-q, --queries <list>` | Comma-separated list of search queries (required) |
| `-p, --provider <slug>` | Search service slug, e.g. `apify/googlemaps/place.search` (required) |
| `-l, --limit <n>` | Per-query record cap (default: 100) |
| `--no-fallback` | Disable router fallback |
| `-j, --json` | Output raw JSON |

**Examples:**

```bash
# Find coffee shops via Google Maps
socialrouter search -q "coffee shops in Brooklyn,bakeries in Brooklyn" -p apify/googlemaps/place.search -l 50
```

---

### `get` — Retrieve an extraction or search by ID

```bash
socialrouter get <id>
socialrouter get ext_a1b2c3d4 -j
```

---

### `providers` — List available providers

```bash
socialrouter providers
socialrouter providers -j
```

Shows status, supported platforms, and both `extract` and `search` types.

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

  By provider:
    apify: 156 req, 4320 records, $129.60
```

---

## Quick Start

```bash
# 1. Set your API key
export SOCIALROUTER_API_KEY=sr_live_...

# 2. Check your balance
socialrouter balance

# 3. List providers
socialrouter providers

# 4. Run your first extraction
socialrouter extract -u "https://linkedin.com/posts/johndoe_some-post-id" -p apify/linkedin/post.likes

# 5. Run a search
socialrouter search -q "coffee shops in Brooklyn" -p apify/googlemaps/place.search
```
