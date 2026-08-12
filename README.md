# apify-n8n-nodes

[n8n](https://n8n.io) community nodes for [Apify](https://apify.com?fpr=bucho&fp_sid=n8n) Actors published by
[thenetaji](https://apify.com/thenetaji?fpr=bucho&fp_sid=n8n).

Each node runs a hosted Actor on Apify from inside an n8n workflow, so scraping and media
work happens on Apify's infrastructure while the results flow straight into your automation.

## Packages

| Package | Node | Operations | Covers |
| --- | --- | --- | --- |
| [`n8n-nodes-tiktok-shop-apify`](packages/tiktok-shop) | TikTok Shop | 12 | Products, reviews, review insights, listing health, creator videos, recommendations, search, search insights, sellers, categories, trending |
| [`n8n-nodes-youtube-scraper-apify`](packages/youtube-scraper) | YouTube Scraper | 12 | Video details, comments, transcripts, channels, playlists, search, trending, hype, home feed, suggestions |
| [`n8n-nodes-youtube-downloader`](packages/youtube-downloader) | YouTube Downloader | 2 | Video and music downloads |
| [`n8n-nodes-pinterest-apify`](packages/pinterest) | Pinterest | 5 | Pins, profiles, boards, board pins, keyword search |
| [`n8n-nodes-tiktok-apify`](packages/tiktok) | TikTok | 8 | Posts, profiles, video downloads, Ads Library, Top Ads |

Between them these nodes cover **31 Apify Actors** across 39 operations. Each operation runs one
purpose-built Actor rather than a general-purpose one, so a run only does the work you asked for —
the all-in-one Actors are deliberately not exposed, since every mode they offer is reachable through
a cheaper dedicated Actor.

## Installing a node

In n8n, go to **Settings → Community nodes → Install** and enter the package name, for
example `n8n-nodes-youtube-downloader`. See n8n's
[installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) for
self-hosted and Cloud specifics.

Every node authenticates with an **Apify API token**, which you can create at
[console.apify.com/settings/integrations](https://console.apify.com/settings/integrations).

## Repository layout

A pnpm monorepo. Each directory under `packages/` is an independently versioned and published
npm package with its own `README`, and declares its subpath via the `repository.directory` field
so npm provenance resolves correctly.

```
packages/
  tiktok-shop/           → n8n-nodes-tiktok-shop-apify
  tiktok/                → n8n-nodes-tiktok-apify
  pinterest/             → n8n-nodes-pinterest-apify
  youtube-scraper/       → n8n-nodes-youtube-scraper-apify
  youtube-downloader/    → n8n-nodes-youtube-downloader
```

Every package declares the same `apifyApi` credential, with the same shape, so one saved Apify
token works across all of them instead of one credential per installed package.

Inside a package, the Actor mapping lives in `nodes/<Node>/operations.ts` as a plain registry: each
operation names its Actor, the fields it forwards, and any input it pins itself. The node's
`displayOptions` are derived from that registry, so the UI cannot drift out of step with the Actors.
`helpers.ts` and `operations.ts` are both import-free, which lets `node --test` load them directly
under Node's native TypeScript support.

## Development

Each package carries its own toolchain, so work inside the package you are changing:

```bash
cd packages/tiktok-shop
pnpm install          # add --ignore-scripts if the native deps fail to build
pnpm run build        # compile to dist/
pnpm run lint         # n8n community-node lint
pnpm test             # unit tests for the pure helpers
```

The root `build`/`lint` scripts still target npm workspaces and do not run in this layout; use the
per-package commands above.

To work on a single package with a live n8n instance:

```bash
cd packages/youtube-downloader
pnpm run dev          # starts n8n at http://localhost:5678 with the node loaded
```

## Publishing

Packages are published exclusively from GitHub Actions with
[npm provenance](https://docs.npmjs.com/generating-provenance-statements) — never from a
local machine. This is a requirement for n8n's community node verification programme.

*Apify links in this README are referral links.*

## License

[MIT](LICENSE)
