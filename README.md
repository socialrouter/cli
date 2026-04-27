# SocialRouter CLI

Command-line interface for the SocialRouter API. Extract structured data from LinkedIn, Instagram, and X directly from your terminal.

## Installation

```bash
npm install -g @socialrouter/cli
```

Or run without installing:

```bash
npx @socialrouter/cli extract -u "..." -t post.likes
```

Or run locally from the repo:

```bash
cd packages/cli
npm install
npm run build
node dist/index.js
```

## Configuration

The CLI needs two environment variables:

### API Key (required)

```bash
export SOCIALROUTER_API_KEY=sr_live_...
```

You can also add it to your shell profile (`~/.zshrc`, `~/.bashrc`) to persist it:

```bash
echo 'export SOCIALROUTER_API_KEY=sr_live_...' >> ~/.zshrc
source ~/.zshrc
```

### API Base URL (optional)

By default the CLI points to `https://api.socialrouter.io`. To use a proxy:

```bash
export SOCIALROUTER_BASE_URL=http://proxy.example.com:3100
```

## Commands

### `extract` — Extract data from a URL

```bash
socialrouter extract -u <url> -t <type> [options]
```

| Flag | Description |
|---|---|
| `-u, --url <url>` | Social media URL (required) |
| `-t, --type <type>` | Extraction type (required) |
| `-p, --provider <id>` | Preferred provider |
| `-l, --limit <n>` | Max records (default: 100) |
| `-j, --json` | Output raw JSON |

**Extraction types:** `post.likes`, `post.comments`, `profile.info`, `profile.posts`, `profile.followers`

**Examples:**

```bash
# Get likers of a LinkedIn post
socialrouter extract -u "https://linkedin.com/posts/johndoe_some-post-id" -t post.likes

# Get Instagram profile info as JSON
socialrouter extract -u "https://instagram.com/johndoe" -t profile.info -j

# Get 20 comments from an X post, using Apify
socialrouter extract -u "https://x.com/johndoe/status/123456" -t post.comments -p apify -l 20
```

---

### `get` — Retrieve an extraction by ID

```bash
socialrouter get <extraction_id>
socialrouter get ext_a1b2c3d4 -j
```

---

### `providers` — List available providers

```bash
socialrouter providers
socialrouter providers -j
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
socialrouter extract -u "https://linkedin.com/posts/johndoe_some-post-id" -t post.likes

# 5. Get raw JSON output
socialrouter extract -u "https://linkedin.com/posts/johndoe_some-post-id" -t post.likes -j
```
