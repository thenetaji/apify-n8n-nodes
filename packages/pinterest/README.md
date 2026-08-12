# Pinterest for n8n

Pull public Pinterest data into your n8n workflows — pins, profiles, boards and keyword search —
without an API key or an approved developer app.

The node runs [Apify Actors](https://apify.com/thenetaji?fpr=bucho&fp_sid=n8n) published by
[thenetaji](https://github.com/thenetaji). The scraping happens on Apify's infrastructure; the rows
land in your workflow as ordinary n8n items.

## What you can build with it

- Track how often a competitor's pins get saved
- Pull every pin from a board into a content calendar
- Research a niche by searching pins and enriching them with the pinner's profile
- Watch a profile's boards and alert when a new one appears

## Install it

In n8n, go to **Settings → Community nodes → Install** and enter:

```
n8n-nodes-pinterest-apify
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

1. Add a **Manual Trigger**, then a **Pinterest** node.
2. Set **Resource** to `Search` and **Operation** to `Search Pins`.
3. Type a keyword into **Search Keywords**, set **Limit** to 10.
4. Click **Test step**.

## What each operation does

| Resource → Operation | What comes back |
| --- | --- |
| **Pin → Get Details** | One pin with its save count, comment count and media |
| **Profile → Get Profile** | One public profile, optionally with its boards attached |
| **Profile → Get Boards** | One row per board, for one or more profiles |
| **Board → Get Pins** | One row per pin, for one or more boards |
| **Search → Search Pins** | One row per matching pin or video pin |

**Pin → Get Details** and **Profile → Get Profile** take a **single** target per input item, because
they run the All-in-One Pinterest Actor. **Get Boards** and **Get Pins** take a **list** — one entry
per line. To fetch many pins, feed the node many input items; n8n runs it once per item.

## Settings, in plain terms

### Targets

Pins accept a numeric ID, a full `pinterest.com/pin/…/` URL, or a `pin.it` short link. Profiles
accept a bare username or the full profile URL. Boards accept a numeric ID or the full
`pinterest.com/owner/board-slug/` URL — a numeric ID is faster, because a URL needs a lookup first.

### Return All and Limit

**Get Boards**, **Get Pins** and **Search Pins** have the usual n8n pair. The limit applies **per
target**: with two boards and a limit of 50, you get up to 50 pins from each.

### The "Add …" toggles

Each one attaches extra data at the cost of extra requests:

- **Add Pin Details** — save count, comment count and media for every pin found; one request per pin
- **Add Pinner Profile** — the profile of whoever saved each pin, under `pinner_profile`; one request
  per distinct account
- **Add Boards** — the profile's boards, under `boards`
- **Add Board Pins** — each board's pins, under `board_pins`
- **Add Cover Pin Details** — full detail for each board's cover pin, under `cover_pin_details`

**Max Boards per Profile** and **Max Pins per Board** cap the two paginating add-ons and only appear
once their toggle is on. Leave them at `0` to keep going until nothing is left — which on a large
profile is a lot of requests, so set a number when you are exploring.

### Options

**Actor Memory** raises the memory for the run. **Poll Timeout** is how long the node waits for the
run to finish — the run keeps going on Apify's side even if the node stops waiting, and the error
message links to it.

## Recipes

### Board to spreadsheet

**Pinterest** (Board → Get Pins) → **Google Sheets → Append**.

### Niche research with pinner profiles

**Pinterest** (Search → Search Pins, *Add Pinner Profile* on, *Limit* 25) → **Filter** on follower
count → **Google Sheets**. Start with a small limit; the add-on costs one request per account.

### Watch a profile's boards

**Schedule Trigger** → **Pinterest** (Profile → Get Boards) → **Compare Datasets** against yesterday
→ **Slack**.

## Common questions

**Do I need a Pinterest developer account?** No. Everything here reads public pages.

**Why did I get nothing back?** Secret boards, deleted pins and private or suspended profiles return
no rows. The node logs a warning with a link to the run so you can check.

**Can I fetch several pins at once?** Not in one call — **Get Details** takes one pin per item. Feed
it a list of items instead (a Split Out or a Google Sheets read upstream) and it runs once per pin.

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

The Actor mapping lives in `nodes/Pinterest/operations.ts` as a plain registry: each operation names
its Actor, the fields it forwards, and any input it pins itself. Pin and profile detail pin a
`scraperType` on the All-in-One Actor; the other three operations call their standalone Actor
directly. The node's `displayOptions` are derived from that registry, so the UI cannot drift out of
step with the Actors.

## Links

- [Actors on Apify](https://apify.com/thenetaji?fpr=bucho&fp_sid=n8n)
- [Repository](https://github.com/thenetaji/apify-n8n-nodes)
- [Issues](https://github.com/thenetaji/apify-n8n-nodes/issues)
- [n8n community nodes](https://docs.n8n.io/integrations/community-nodes/)

## Version history

- **0.1.1** — documentation only: Apify links are now referral links.
- **0.1.0** — first release: 5 operations across Pin, Profile, Board and Search.

*Apify links in this README are referral links.*

## License

MIT
