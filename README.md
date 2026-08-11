# apify-n8n-nodes

[n8n](https://n8n.io) community nodes for [Apify](https://apify.com) Actors published by
[thenetaji](https://apify.com/thenetaji).

Each node runs a hosted Actor on Apify from inside an n8n workflow, so scraping and media
work happens on Apify's infrastructure while the results flow straight into your automation.

## Packages

| Package | Node | Actors |
| --- | --- | --- |
| [`n8n-nodes-youtube-downloader`](packages/youtube-downloader) | YouTube Downloader | `thenetaji/youtube-video-downloader`, `thenetaji/youtube-music-downloader` |

## Installing a node

In n8n, go to **Settings → Community nodes → Install** and enter the package name, for
example `n8n-nodes-youtube-downloader`. See n8n's
[installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) for
self-hosted and Cloud specifics.

Every node authenticates with an **Apify API token**, which you can create at
[console.apify.com/settings/integrations](https://console.apify.com/settings/integrations).

## Repository layout

This is an npm workspaces monorepo. Each directory under `packages/` is an independently
versioned and published npm package with its own `README`, and declares its subpath via the
`repository.directory` field so npm provenance resolves correctly.

```
packages/
  youtube-downloader/    → n8n-nodes-youtube-downloader
```

## Development

```bash
npm install           # install all workspaces
npm run build         # build every package
npm run lint          # lint every package
```

To work on a single package with a live n8n instance:

```bash
cd packages/youtube-downloader
npm run dev           # starts n8n at http://localhost:5678 with the node loaded
```

## Publishing

Packages are published exclusively from GitHub Actions with
[npm provenance](https://docs.npmjs.com/generating-provenance-statements) — never from a
local machine. This is a requirement for n8n's community node verification programme.

## License

[MIT](LICENSE)
