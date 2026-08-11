# n8n-nodes-youtube-downloader

This is an n8n community node. It lets you run the [YouTube Video Downloader](https://apify.com/thenetaji/youtube-video-downloader) and [YouTube Music Downloader](https://apify.com/thenetaji/youtube-music-downloader) Apify Actors from your n8n workflows — including downloading the resulting video/audio file straight into n8n as binary data.

[Apify](https://apify.com) is a platform for building and running web automation and data-extraction programs called Actors. [n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/reference/license/) workflow automation platform.

[Installation](#installation)
[Operations](#operations)
[Credentials](#credentials)
[Compatibility](#compatibility)
[Usage](#usage)
[Binary file downloads](#binary-file-downloads)
[Notes and gotchas](#notes-and-gotchas)
[Example workflow](#example-workflow)
[Resources](#resources)
[Version history](#version-history)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation, and install `n8n-nodes-youtube-downloader`.

## Operations

The **YouTube Downloader** node exposes two resources, each backed by its own Apify Actor:

- **Video** — download a public YouTube video, Shorts, or combined high-quality video/audio stream, with optional subtitles or transcript, and an optional saved playable file (MP4/WebM/MKV) at a chosen quality.
- **Music** — download a public YouTube / YouTube Music track. The saved audio file (MP3/M4A/WebM) is always produced for this resource; there is no separate "save" toggle.

Both resources share the same core fields:

| Field | Description |
| --- | --- |
| YouTube URLs / YouTube Music URLs | One URL, Shorts link, or 11-character video ID per line (commas also accepted as a separator). Converted internally into the `[{ "url": "..." }]` shape the Actors' input schema expects. |
| Access Country / Download Country | A 2-letter country code (e.g. `US`), used by the Actor to access the video/track. Automatically uppercased; the node errors immediately if it isn't exactly 2 letters. |
| Add Transcript | Attach timed transcript segments when available. Charged only when a transcript is actually returned. |
| Subtitle Language | Optional language code (e.g. `en`, `es`, `pt-BR`) for one subtitle/caption track. |

Video-only fields:

| Field | Description |
| --- | --- |
| Save Playable Files | Whether to create a playable file and return its download URL. Off by default (metadata-only, fast, no file transfer). Billed per MB, only after a successful transfer. |
| Maximum Quality | Resolution cap (144p up to 4320p/8K, or Best Available). Only has an effect when Save Playable Files is on. |
| File Format | Container format for the saved file (Default/MP4, MP4, WebM, MKV). Only has an effect when Save Playable Files is on. |

Music-only fields:

| Field | Description |
| --- | --- |
| Audio Format | MP3 (broadly compatible), M4A, or WebM (Opus) — audio saving always happens for this resource. |

Common advanced fields (both resources):

| Field | Description |
| --- | --- |
| Download File to Binary | On by default. See [Binary file downloads](#binary-file-downloads). |
| Put Output File in Field | Binary property name to write the file to (default `data`). |
| Options → Actor Memory (MB) | Override the Actor run's memory allocation. |
| Options → Poll Timeout (Minutes) | How long this node polls before giving up on a run (default 10). The Actor run itself keeps executing on Apify's side even if the node times out first. |

## Credentials

This node authenticates with the **Apify API**. You need an Apify account and a personal API token:

1. Sign up or log in at [apify.com](https://apify.com).
2. In the [Apify Console](https://console.apify.com/), go to **Settings > Integrations**.
3. Copy your **Personal API token**.
4. In n8n, create a new **Apify API** credential and paste the token into the **API Token** field.
5. Use **Test credential** to confirm it works — this calls `GET https://api.apify.com/v2/users/me`.

The token is sent as an `Authorization: Bearer <token>` header on every request this node makes, including the binary file download described below.

Both Actors are pay-to-use on Apify (the video downloader is a flat monthly rental; the music downloader is pay-per-event with a flat-rental option). You need active/paid access on your Apify account for runs to succeed — this node surfaces Apify's own payment/permission error if you don't.

## Compatibility

Requires n8n running against `n8n-workflow` API version 1 (n8n 1.x). Built and tested against Node.js 20+. This package has **zero runtime dependencies** — every HTTP call goes through n8n's own `httpRequestWithAuthentication` helper.

## Usage

Add the **YouTube Downloader** node to a workflow, pick a **Resource** (Video or Music), fill in the URLs and any options you need, and attach your Apify API credential.

Under the hood, the node always uses the asynchronous Apify REST flow, never the `run-sync-get-dataset-items` shortcut:

1. `POST /v2/acts/{actorId}/runs` to start the run.
2. Poll `GET /v2/actor-runs/{runId}` until the run reaches a terminal status (`SUCCEEDED`, `FAILED`, `ABORTED`, or `TIMED-OUT`).
3. `GET /v2/datasets/{datasetId}/items` to fetch the resulting rows.

This is deliberate: both Actors default to a 3600-second `timeoutSecs`, and `run-sync-get-dataset-items` has a hard 300-second cap that a media-saving run can easily exceed. If the run doesn't finish within the node's **Poll Timeout**, the node throws with a link to the run in Apify Console — the run itself keeps going on Apify's side regardless.

If a run ends in `FAILED`, `ABORTED`, or `TIMED-OUT`, the node throws a `NodeApiError` naming the run so you can open it directly in Apify Console to see what happened.

## Binary file downloads

This is the node's main advantage over the generic HTTP/Apify nodes: when a run saves a media file, this node can fetch the bytes itself and attach them as n8n binary data on the output item, so you can chain straight into **Google Drive**, **S3**, **Telegram**, or any other binary-aware node — no extra HTTP Request node needed.

How it works:

- Both Actors save the file into their run's own default Apify key-value store, and the dataset item includes a `savedFile` object with a ready-to-use `url`, plus `key` (used as the filename) and `contentType`.
- When **Download File to Binary** is on (default) and an item's `savedFile` is present, the node `GET`s that URL — sending your Apify token as a bearer header — and attaches the bytes via `prepareBinaryData()` under the binary property named in **Put Output File in Field** (default `data`).
- If the download itself fails, the item is still emitted with its JSON metadata and a `binaryDownloadError` field, rather than failing the whole node.

**`savedFile` is not guaranteed just because you asked for it** — this is the single biggest nuance of these two Actors, and this node follows the data rather than the request:

- **Video**: `savedFile` is only present when Save Playable Files was on *and* the save succeeded. If Save Playable Files is off, or it's on but the save failed, the row still comes back with the full metadata (`formats`, `thumbnails`, `availableSubtitles`, temporary `directUrl` CDN links) but no `savedFile` — the node adds a `binaryDownloadSkippedReason` field to that item's JSON instead of erroring.
- **Music**: `savedFile` is present on every row that reaches the dataset, because a track whose audio save fails is **not emitted at all** — the Actor drops it. This means a music run can legitimately return fewer rows than URLs you sent in; the node logs a warning (visible in the n8n execution log) when that happens, rather than fabricating an error row for the missing track.
- The shape of `savedFile` also differs: video's includes `qualityLabel`/`width`/`height`; music's includes `codecs`/`bitrate` instead.

### Large files and n8n memory

Media files are big, and **n8n buffers binary data in memory by default**. Measured against the live Actors, a single 21-minute talk came back at:

| Request | Size |
| --- | --- |
| Video, 360p MP4 | 37 MB |
| Audio, 192 kbps MP3 | 20 MB |

Quality scales that steeply — 1080p is several times the 360p figure, and 2160p can run to the gigabytes. Because **Download File to Binary** defaults to on, a workflow that fans out over many URLs, or pulls one very large video, can exhaust the memory of an n8n instance and fail the execution.

Ways to stay inside the envelope:

- **Switch n8n to filesystem binary mode.** Set `N8N_DEFAULT_BINARY_DATA_MODE=filesystem` (or `s3`) so binary payloads spill to disk instead of living in the process heap. This is the single most effective change for self-hosted instances, and is worth doing before any bulk run.
- **Cap the quality.** Set **Maximum Quality** to the lowest resolution that meets your need rather than leaving it at Best Available.
- **Turn off Download File to Binary** when you only need metadata, or when you would rather hand `savedFile.url` to a downstream service and let *it* do the fetching. The URL is pre-signed and works without an Apify token.
- **Batch modestly.** Prefer several small runs over one run with a long URL list, so peak memory stays bounded.

## Notes and gotchas

- **`Region` gotcha**: Apify's schema marks `region` as required *and* gives it a default of `US` — not a contradiction, but worth knowing the node ships with both `required: true` and `default: 'US'` simultaneously without issue.
- **Billing**: a run that saves media is billed per MB of the transferred file, on top of the Actor's own rental/pay-per-event pricing — and only after a successful transfer. A run where the save fails isn't charged the MB fee.
- **`proxy` field**: the Actors' input schema still declares a legacy hidden `proxy` field for backward compatibility with old saved tasks. This node deliberately does not expose it and never sends it — proxying is managed automatically by the Actor regardless.
- **Quality/Format visibility**: Maximum Quality and File Format are only shown in the UI when Save Playable Files is on, purely as a UX aid — Apify's schema doesn't gate them, so if you set them via an expression while Save Playable Files is off, they're simply ignored by the Actor.

## Example workflow

**Batch-download a playlist's worth of videos straight to Google Drive.**

1. A **Set** (or **Google Sheets**) node upstream produces one item per row, each with a `url` field containing a YouTube link.
2. **YouTube Downloader** node: Resource = `Video`, YouTube URLs = `={{ $json.url }}`, Save Playable Files = on, Maximum Quality = `1080p Full HD`, Download File to Binary = on (default), Put Output File in Field = `data`.
3. Connect its output to a **Google Drive → Upload File** node, with the **Input Binary Field** set to `data` and the file name expression set to `={{ $json.savedFile.key }}`.
4. Optionally branch on `{{ $json.savedFile }}` being empty beforehand (an **If** node) to route videos whose save failed to a separate "retry later" path instead of trying to upload nothing.

Because the node already attaches the downloaded bytes as binary data with the correct filename and MIME type, step 3 needs no intermediate HTTP Request node to fetch the file — the Google Drive node can use the binary data directly.

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [Apify API documentation](https://docs.apify.com/api/v2)
- [YouTube Video Downloader Actor](https://apify.com/thenetaji/youtube-video-downloader)
- [YouTube Music Downloader Actor](https://apify.com/thenetaji/youtube-music-downloader)

## Version history

- **0.1.0** — Initial release: Video and Music resources backed by their respective Apify Actors, async run/poll/fetch lifecycle, binary file download into n8n, `continueOnFail` support, and full input validation for URLs/region/subtitle language.
