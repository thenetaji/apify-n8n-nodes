# TikTok for n8n

Pull TikTok data into your n8n workflows — post and profile details, watermark-free video
downloads, the public Ads Library and the Creative Center Top Ads charts.

The node runs [Apify Actors](https://apify.com/thenetaji) published by
[thenetaji](https://github.com/thenetaji). The scraping happens on Apify's infrastructure; the rows
land in your workflow as ordinary n8n items.

> Selling on TikTok Shop? Products, reviews and sellers live in a separate package:
> [`n8n-nodes-tiktok-shop`](https://github.com/thenetaji/apify-n8n-nodes/tree/main/packages/tiktok-shop).

## What you can build with it

- Archive a creator's videos to Google Drive without the watermark
- Track follower growth for a list of creators on a schedule
- Research what a competitor is running in TikTok's public Ads Library
- Pull the highest-performing Top Ads in your industry and analyse the creative

## Install it

In n8n, go to **Settings → Community nodes → Install** and enter:

```
n8n-nodes-tiktok
```

See n8n's [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) for
self-hosted and Cloud specifics.

## Requirements

- A self-hosted n8n, or n8n Cloud with community nodes enabled
- Node.js 20.15 or newer (self-hosted)
- A free [Apify account](https://console.apify.com/sign-up) for the API token

## Connect your Apify account

1. Sign in to the [Apify Console](https://console.apify.com).
2. Open **Settings → Integrations** and copy your **Personal API token**.
3. In n8n, add a new **Apify API** credential and paste the token in.

The same credential works for every Apify node in this repo, so you only enter the token once.

## What each operation does

| Resource → Operation | What comes back |
| --- | --- |
| **Post → Get Details** | Post metadata, stats, music and author. **Needs at least 4 URLs.** |
| **Post → Scrape Any URL** | The same, from a mixed list of post *and* profile URLs. **Needs at least 4 URLs.** |
| **Profile → Get Details** | Creator profile, follower counts and bio. Any number of URLs. |
| **Video → Download** | The video file without a watermark, attachable as binary data |
| **Ad → Search Ads Library** | TikTok's public Ads Library, searchable by brand, product or phrase |
| **Ad → Get Top Ads** | High-performing Creative Center ads, filtered and ranked |
| **Ad → Browse Spotlight Creatives** | TikTok's curated Spotlight examples |
| **Ad → Analyze Creatives** | Deep detail on known Top Ad creatives, plus similar ones |

### The four-URL minimum

**Get Details** and **Scrape Any URL** are backed by Actors that batch their requests and **reject
any run with fewer than four URLs**. The node checks this before starting the run, so you get

> Get Post Details needs at least 4 entries in URLs, but got 2. This Actor batches its requests and
> rejects shorter runs.

instead of a raw validation error from Apify. Note the check runs *after* duplicates are removed —
four lines pointing at three distinct URLs still fails.

**Profile → Get Details** and **Video → Download** have no such minimum; one URL is fine.

## Settings, in plain terms

### URLs

One URL per line, commas also accepted. Post operations take post and profile URLs; the download
operation takes video URLs.

### Downloading to binary

**Download File to Binary** is on by default: the node fetches the saved video from Apify and
attaches it as binary data, ready to chain into Google Drive, S3, Telegram and similar nodes. Turn
it off to keep just the metadata and the link. If a file could not be saved, the node says so in
`binaryDownloadSkippedReason` rather than failing the item.

### Ads Library

**Search Type** decides how TikTok reads your query — Free text for broad research, Advertiser to
narrow to one brand. **Add Advertiser Activity Report** only appears for Advertiser searches,
because that is the only mode it applies to. Date filters live under **Ads Library Filters**.

### Top Ads

**Get Top Ads** searches the ranked chart: pick a keyword, countries, a ranking period and what to
rank by. The narrower Creative Center filters (industry, objective, ad format, likes percentile,
language) live under **Top Ads Filters** — the easy way to use those is to paste a Creative Center
dashboard URL into **TikTok URL** instead and let the Actor read the filters from it.

**Add per-Second Video Performance** and **Add Performance Benchmark** each reveal their metric
picker only once switched on. **Max Related Creatives** is bounded 1–20 by the Actor; the node
clamps anything outside that range rather than letting the run fail.

### Options

- **Proxy Group** — leave on Automatic to use the Actor's own default, or pick Residential for
  targets that block datacenter traffic
- **Session Cookies** — only needed if a download fails with a "login required" error
- **Delay Between Downloads** — raise it when downloading many videos; TikTok rate-limits
  aggressive downloaders
- **Actor Memory** and **Poll Timeout** — as in the other nodes in this repo

## Recipes

### Archive a creator's videos

**Google Sheets → Read** (a column of video URLs) → **TikTok** (Video → Download) → **Google Drive →
Upload**, mapping the binary property.

### Weekly creator report

**Schedule Trigger** → **TikTok** (Profile → Get Details, several creator URLs) → **Google Sheets →
Append**.

### Competitor ad watch

**Schedule Trigger** → **TikTok** (Ad → Search Ads Library, *Search Type* = `Advertiser`) →
**Filter** on first-seen date → **Slack**.

## Common questions

**Why does it demand four URLs?** Two of the Actors batch their requests, and their input schema
sets a minimum of four. Pad the list with other URLs you want anyway, or use **Profile → Get
Details** if you only need one profile.

**Do I need TikTok cookies?** Not normally. Add them under **Options → Session Cookies** only if a
download reports that login is required.

**Why did I get nothing back?** Private, deleted and region-blocked targets return no rows. The node
logs a warning with a link to the run on Apify.

**Can I use this as an AI tool?** Yes — the node is exposed to n8n's AI Agent as a tool.

## What it costs

Apify's free tier includes $5 of platform credit per month. Runs are billed by compute time, and
downloads are additionally billed per MB of saved file. The levers that matter are **Limit**, the
**Add …** toggles, and how many videos you download at once.

## For developers

```bash
pnpm install          # install dependencies
pnpm run build        # compile to dist/
pnpm run lint         # n8n community-node lint
pnpm test             # unit tests for the pure helpers
pnpm run dev          # run a local n8n with this node linked
```

The Actor mapping lives in `nodes/TikTok/operations.ts` as a plain registry: each operation names
its Actor, the fields it forwards, any input it pins itself (the three Top Ads workflows), whether
it produces files, and its `minEntries` floor. The node's `displayOptions` are derived from that
registry — including which operations get the four-URL variant of the URLs field — so the UI cannot
drift out of step with the Actors.

## Links

- [Actors on Apify](https://apify.com/thenetaji)
- [Repository](https://github.com/thenetaji/apify-n8n-nodes)
- [Issues](https://github.com/thenetaji/apify-n8n-nodes/issues)
- [n8n community nodes](https://docs.n8n.io/integrations/community-nodes/)

## Version history

- **0.1.0** — first release: 8 operations across Post, Profile, Video and Ad.

## License

MIT
