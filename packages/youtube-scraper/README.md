# YouTube Scraper for n8n

Read YouTube data in your n8n workflows — video details, comments, transcripts, channels,
playlists, search results and the trending feeds — without an API key or a quota.

The node runs [Apify Actors](https://apify.com/thenetaji?fpr=bucho&fp_sid=n8n) published by
[thenetaji](https://github.com/thenetaji). The scraping happens on Apify's infrastructure; the rows
land in your workflow as ordinary n8n items.

> Looking to **download** a video or rip audio? That's a different package:
> [`n8n-nodes-youtube-downloader`](https://github.com/thenetaji/apify-n8n-nodes/tree/main/packages/youtube-downloader).
> This one reads data; that one produces files.

## What you can build with it

- Summarise a video with an LLM by feeding it the transcript instead of the whole video
- Watch a competitor's channel and post new uploads to Slack
- Pull the comments on your latest video and run sentiment analysis over them
- Track what's trending in a country every morning
- Turn a playlist into a content spreadsheet

## Install it

In n8n, go to **Settings → Community nodes → Install** and enter:

```
n8n-nodes-youtube-scraper-apify
```

See n8n's [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) for
self-hosted and Cloud specifics.

## Requirements

- A self-hosted n8n, or n8n Cloud with community nodes enabled
- Node.js 20.15 or newer (self-hosted)
- A free [Apify account](https://apify.com?fpr=bucho&fp_sid=n8n) for the API token

## Connect your Apify account

1. Sign in to the [Apify Console](https://console.apify.com).
2. Open **Settings → Integrations** and copy your **Personal API token**.
3. In n8n, add a new **Apify API** credential and paste the token in.

The same credential works for every Apify node in this repo, so you only enter the token once.

## Your first run

1. Add a **Manual Trigger**, then a **YouTube Scraper** node.
2. Leave **Resource** on `Video` and **Operation** on `Get Details`.
3. Paste a video URL into **Videos**.
4. Click **Test step**.

## What each operation does

### Video

| Operation | What comes back |
| --- | --- |
| **Get Details** | Title, views, likes, channel and metadata. Takes plain URLs or 11-character IDs. |
| **Get Extended Details** | The same, plus optional related videos, same-sound Shorts, transcript and caption text |
| **Get Transcript** | Timed transcript segments, optionally with a `.vtt` or `.srt` subtitle file attached |
| **Get Comments** | One row per comment. Works on videos, Shorts and community posts. |

**Get Details** and **Get Extended Details** are two different Actors, not one Actor with a switch.
Reach for **Get Details** by default — it is the leaner, cheaper call. Use **Get Extended Details**
only when you actually want the related content, transcript or caption fields.

### Channel, Playlist and Search

| Operation | What comes back |
| --- | --- |
| **Channel → Get Channel** | The sections you tick: channel details, videos, Shorts, live streams, playlists, community posts, home sections, store products, or a search within the channel |
| **Playlist → Get Playlist** | One row per playlist item, optionally with full video details or transcripts attached |
| **Search → Search** | Keyword results, filterable by type, duration, upload date and order |
| **Search → Search by Hashtag** | A hashtag's video or Shorts feed |
| **Search → Get Trending** | The trending, music or games chart for a country |
| **Search → Get Hype** | The Hype chart of rising videos |
| **Search → Get Home Feed** | The YouTube home feed for a country |
| **Search → Get Search Suggestions** | Autocomplete suggestions for a partial query |

The six Search operations are all the same Actor with a different workflow pinned, so the node shows
you only the fields that workflow actually uses.

## Settings, in plain terms

### Targets

Every target field takes one entry per line, and accepts commas as a separator too. Channels accept
full URLs, `@handles`, usernames and `UC…` IDs. Videos accept full URLs, Shorts URLs and bare
11-character IDs.

### Return All and Limit

Leave **Return All** off and set a **Limit**, or turn it on to keep going until the source runs out.
Limits keep your Apify bill predictable — start small.

### The "Add …" toggles

Each one attaches extra data at the cost of extra requests: **Add Transcript**, **Add Caption Text**,
**Add Related Content**, **Add Shorts Using the Same Sound**, **Add Full Video Details**, **Add
Parent Content Details** and **Add Subtitle File**. They are all off by default and are charged only
when the extra data actually comes back. Turn on what you need and nothing else.

### Channel Content

**Get Channel** requires at least one section. `Channel details` produces one profile record per
channel; the other sections produce one row per item. **Search Within Channel** only appears once
you tick that section, since the search term is meaningless without it.

### Options

- **Country** and **Language** localize results (`US`, `IN`, `DE` / `en`, `es`, `pt-BR`). Leave them
  empty to take the Actor's default.
- **Resume From** continues a previous run — paste the resume token from that run's log. It only
  appears on the operations that support it.
- **Actor Memory** raises the memory for the run, which can shorten a large export.
- **Poll Timeout** is how long the node waits for the run to finish. The run keeps going on Apify's
  side even if the node stops waiting, and the error message links to it.

## Recipes

### Summarise a video

**YouTube Scraper** (Video → Get Transcript) → **Basic LLM Chain**. Feed the transcript text in as
the prompt input; you get a summary without the model ever touching the video.

### Comment sentiment digest

**Schedule Trigger** → **YouTube Scraper** (Video → Get Comments, *Result Order* = `Newest
Comments`) → **Basic LLM Chain** → **Slack**.

### Track a channel's uploads

**Schedule Trigger** → **YouTube Scraper** (Channel → Get Channel, *Channel Content* = `Videos`,
*Limit* = 10) → **Filter** on publish date → **Slack** or **Google Sheets**.

### Turn a playlist into a spreadsheet

**YouTube Scraper** (Playlist → Get Playlist) → **Google Sheets → Append**.

## Common questions

**Do I need a YouTube Data API key?** No. There is no Google quota involved here.

**Why did a video come back empty?** Private, age-restricted, members-only and region-blocked videos
return nothing. The node logs a warning with a link to the run so you can see which target failed.

**Why is there no transcript?** Not every video has one, and auto-generated tracks are not available
in every language. The run still succeeds; the transcript field is just absent.

**Can I use this as an AI tool?** Yes — the node is exposed to n8n's AI Agent as a tool.

## What it costs

Apify's free tier includes $5 of platform credit per month. Runs are billed by compute time, so the
levers that matter are **Limit** and the **Add …** toggles. Start with small limits and the toggles
off.

## For developers

```bash
pnpm install          # install dependencies
pnpm run build        # compile to dist/
pnpm run lint         # n8n community-node lint
pnpm test             # unit tests for the pure helpers
pnpm run dev          # run a local n8n with this node linked
```

The Actor mapping lives in `nodes/YouTubeScraper/operations.ts` as a plain registry: each operation
names its Actor, the fields it forwards, and any input it pins itself (the Search workflows). Field
conversion is driven by a `FIELDS` table — `sourceList` becomes `[{ url }]` objects, `idList` stays
plain strings, and optional values are omitted rather than sent blank so the Actor's own defaults
apply. The node's `displayOptions` are derived from that registry, so the UI cannot drift out of step
with the Actors.

## Links

- [Actors on Apify](https://apify.com/thenetaji?fpr=bucho&fp_sid=n8n)
- [Repository](https://github.com/thenetaji/apify-n8n-nodes)
- [Issues](https://github.com/thenetaji/apify-n8n-nodes/issues)
- [n8n community nodes](https://docs.n8n.io/integrations/community-nodes/)

## Version history

- **0.1.1** — documentation only: Apify links are now referral links.
- **0.1.0** — first release: 12 operations across Video, Channel, Playlist and Search.

*Apify links in this README are referral links.*

## License

MIT
