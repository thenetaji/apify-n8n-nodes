# YouTube Downloader for n8n

Download YouTube videos and music inside your n8n workflows, and send the files straight to Google Drive, Dropbox, S3, Telegram, or anywhere else you already automate.

No code, no scraping setup, no server of your own. Paste a link, pick a quality, and the finished file arrives in your workflow ready to use.

**Who it's for:** content and social teams archiving video, podcasters pulling audio, researchers collecting clips, and anyone feeding transcripts to an AI step. If you can build an n8n workflow, you can use this — nothing here needs code.

## What you can build with it

- **Archive a channel to Google Drive** — every new upload saved automatically, the moment it goes live.
- **Turn videos into podcasts** — pull the audio as MP3 and post it to your feed or storage.
- **Feed an AI summariser** — grab the transcript and send it to an AI node for notes, chapters, or a newsletter draft.
- **Back up your own content** — keep offline copies of videos you own, on a schedule.
- **Collect research clips** — hand a spreadsheet of links to n8n and get a folder of files back.

## Install it

In n8n, open **Settings → Community nodes → Install**, then enter:

```
n8n-nodes-youtube-downloader
```

Tick the box to acknowledge the risks of community nodes, and select **Install**. The **YouTube Downloader** node then appears in your node list — search for "YouTube Downloader" when adding a node to a workflow.

> **Self-hosted n8n only, for now.** n8n Cloud can install community nodes that n8n has reviewed and marked as verified. This node hasn't been through that review yet, so it currently works on self-hosted n8n only. n8n's [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) explains the difference.

## Requirements

- **Self-hosted n8n**, version 1.x or newer (see the note above about Cloud).
- **An Apify account** with access to the two downloader Actors. Setup is below and takes about a minute.
- **Public YouTube links.** Private, unlisted, members-only, and paid content won't work.
- **Room for the files.** Videos can be large — see [Keeping file sizes sensible](#keeping-file-sizes-sensible) before running big batches.

## Connect your Apify account

The downloading itself runs on [Apify](https://apify.com?fpr=bucho&fp_sid=n8n), so the node needs to sign in to your Apify account. This takes about a minute:

1. Create a free account at [apify.com](https://apify.com?fpr=bucho&fp_sid=n8n) if you don't have one.
2. Go to [Apify Console → Settings → Integrations](https://console.apify.com/settings/integrations).
3. Copy your **Personal API token**.
4. Back in n8n, add a new **Apify API** credential and paste the token into **API Key**.
5. Select **Test credential**. A green tick means you're connected.

Both downloaders are paid Actors on Apify — current pricing is on the [Video Downloader](https://apify.com/thenetaji/youtube-video-downloader?fpr=bucho&fp_sid=n8n) and [Music Downloader](https://apify.com/thenetaji/youtube-music-downloader?fpr=bucho&fp_sid=n8n) pages. If your account doesn't have access yet, the node tells you so directly rather than failing silently.

## Your first download

1. Add the **YouTube Downloader** node to a workflow.
2. Set **Resource** to **Video**.
3. Paste a YouTube link into **YouTube URLs**.
4. Turn on **Save Playable Files**.
5. Select **Execute step**.

You'll get the video's details, plus the file itself attached to the result. Drop a **Google Drive** node after it, set its input field to `data`, and the video uploads — nothing in between.

To download several at once, put one link per line.

## Settings, in plain terms

### Choosing what you get

| Setting            | What it does                                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| **Resource**       | **Video** for MP4 video files, **Music** for MP3 audio.                                                                 |
| **YouTube URLs**   | Your links, one per line. Regular videos, Shorts, and YouTube Music links all work.                                     |
| **Access Country** | Which country to download from, as a two-letter code like `US` or `DE`. Useful when a video is blocked in some regions. |

### Video options

| Setting                 | What it does                                                                                                                                                         |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Save Playable Files** | **Turn this on to actually get a file.** Left off, you only get the video's information — title, views, length — which is faster and cheaper if that's all you need. |
| **Maximum Quality**     | The highest resolution to download, from 144p up to 8K. Lower means smaller files and lower cost.                                                                    |
| **File Format**         | MP4 plays almost everywhere and is the safe default. WebM and MKV are also available.                                                                                |

### Music options

| Setting          | What it does                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------ |
| **Audio Format** | MP3 works on everything. M4A and WebM keep the original audio quality without re-encoding. |

Music always produces a file — there's no toggle to turn off, because getting the audio is the whole point.

### Extras (both types)

| Setting                      | What it does                                                                                                                  |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Add Transcript**           | Includes the spoken text with timestamps, when YouTube has it. Handy for summaries and search.                                |
| **Subtitle Language**        | Fetches one subtitle track, using a code like `en`, `es`, or `pt-BR`.                                                         |
| **Download File to Binary**  | On by default. This is what attaches the actual file so other nodes can use it. Turn it off if you only want the information. |
| **Put Output File in Field** | The name the file is attached under. Leave it as `data` unless a later node expects something else.                           |
| **Poll Timeout (Minutes)**   | How long to wait before giving up. Raise it for long videos or big batches.                                                   |

## Recipes

### Save a video to Google Drive

1. **YouTube Downloader** — Resource `Video`, your link, **Save Playable Files** on.
2. **Google Drive → Upload File** — set **Input Binary Field** to `data`, and the file name to `{{ $json.savedFile.key }}`.

That's the whole workflow. The file is already attached, so nothing needs to fetch it in between.

### Turn a video into an MP3 and email it

1. **YouTube Downloader** — Resource `Music`, **Audio Format** `MP3`.
2. **Gmail → Send** — attach the binary field `data`.

### Summarise a video with AI

1. **YouTube Downloader** — Resource `Video`, **Save Playable Files** _off_, **Add Transcript** on.
2. **AI Agent** or **Basic LLM Chain** — feed it `{{ $json.transcript }}` and ask for a summary.

Skipping the file download here keeps it fast and cheap, since you only need the words.

### Process a spreadsheet of links

1. **Google Sheets → Get Rows**.
2. **YouTube Downloader** — set **YouTube URLs** to `{{ $json.url }}`.
3. **Google Drive → Upload File**.

## Keeping file sizes sensible

Video files are large, and n8n holds them in memory while your workflow runs. From real downloads of a 21-minute talk:

| What you asked for | File size |
| ------------------ | --------- |
| Video at 360p      | 37 MB     |
| Audio at 192 kbps  | 20 MB     |

Higher quality grows quickly — 1080p is several times that, and 4K can reach several gigabytes. Downloading many large videos at once can run an n8n instance out of memory and stop the workflow.

If you're doing this at any scale:

- **Set Maximum Quality to what you actually need.** 720p or 1080p is plenty for most uses, and far smaller than 4K.
- **Work in smaller batches** rather than hundreds of links in one go.
- **Turn off Download File to Binary** if something else can fetch the file. You still get a working download link in the results.
- **If you self-host**, set `N8N_DEFAULT_BINARY_DATA_MODE=filesystem` in your n8n settings so large files are written to disk instead of held in memory. This is the single biggest improvement for bulk downloads.

## Common questions

**I got fewer files than links I put in.**
For music, a track that can't be downloaded is skipped rather than returned empty — so you may get fewer results than you asked for. The n8n execution log notes when this happens.

**The video info came back but there's no file.**
Check that **Save Playable Files** is on. If it was on and you still have no file, that video's download failed — you'll still get its details plus a note explaining why, so the rest of your workflow keeps running.

**The node timed out.**
Long videos take a while. Raise **Poll Timeout (Minutes)**. The download keeps running on Apify's side regardless, so nothing is wasted.

**A video isn't available.**
Try a different **Access Country**. Some content is restricted by region.

**Can I download private or paid videos?**
No. These downloaders work with publicly available content only.

## What it costs

Two things are billed on your Apify account: running the downloader, and the size of any file it saves. Downloads that fail aren't charged for transfer.

If you only need titles, view counts, or transcripts, leave **Save Playable Files** off — it's meaningfully cheaper.

Current rates are on the [Video Downloader](https://apify.com/thenetaji/youtube-video-downloader?fpr=bucho&fp_sid=n8n) and [Music Downloader](https://apify.com/thenetaji/youtube-music-downloader?fpr=bucho&fp_sid=n8n) Actor pages.

## For developers

The node starts an Apify Actor run, polls until it finishes, then reads the results — deliberately avoiding Apify's synchronous endpoint, whose 5-minute ceiling a media download can easily exceed. If the node's own timeout is reached first, it raises an error linking to the run in Apify Console; the run continues there.

Saved files live in the run's Apify key-value store, and each result carries a `savedFile` object with a pre-signed `url`, a `key` used as the filename, and a `contentType`. The node reads that URL and attaches the bytes as n8n binary data. It branches on whether `savedFile` is actually present rather than on what was requested, so a failed save degrades to a JSON-only item instead of an error. The `savedFile` shape differs by resource: video carries `qualityLabel`, `width`, and `height`; music carries `codecs` and `bitrate`.

The package has **zero runtime dependencies** — every request goes through n8n's own authenticated HTTP helper. It supports **Continue On Fail**, and works as an **AI agent tool**.

## Links

- [Video Downloader Actor](https://apify.com/thenetaji/youtube-video-downloader?fpr=bucho&fp_sid=n8n)
- [Music Downloader Actor](https://apify.com/thenetaji/youtube-music-downloader?fpr=bucho&fp_sid=n8n)
- [Source code and issues](https://github.com/thenetaji/apify-n8n-nodes)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)

## Version history

- **0.3.0** — added OAuth2 sign-in, so n8n Cloud users can connect their Apify account with a button instead of pasting a key.
- **0.2.0** — the Apify credential field is now **API Key**, matching the shape Apify publishes, so one saved credential works across every Apify node. Re-enter your token if you saved it under 0.1.x.
- **0.1.1** — documentation only: Apify links are now referral links.
**0.1.0** — First release. Video and music downloads, transcripts and subtitles, files attached directly as n8n binary data, and support for continuing past failed items.

*Apify links in this README are referral links.*

## License

[MIT](https://github.com/thenetaji/apify-n8n-nodes/blob/main/LICENSE)
