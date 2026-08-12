# TikTok Shop for n8n

Pull TikTok Shop data into your n8n workflows — product pages, reviews, sellers, categories,
search results and the trending rails — without writing a scraper or touching a browser.

The node runs [Apify Actors](https://apify.com/thenetaji) published by
[thenetaji](https://github.com/thenetaji). The scraping happens on Apify's infrastructure; the
rows land in your workflow as ordinary n8n items.

## What you can build with it

- Track a competitor's price and rating every morning and write it to a sheet
- Watch new 1-star reviews on your own listings and post them to Slack
- Export a seller's full catalog before a category launch
- Score your listings and get a ranked list of what to fix
- Find the creators already promoting a product you want to sell

## Install it

In n8n, go to **Settings → Community nodes → Install** and enter:

```
n8n-nodes-tiktok-shop-apify
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

## Your first run

1. Add a **Manual Trigger**, then a **TikTok Shop** node.
2. Leave **Resource** on `Product` and **Operation** on `Get Details`.
3. Paste a product link into **Products**, for example
   `https://shop.tiktok.com/us/pdp/1730927783781307026`.
4. Click **Test step**. You get one item back with the price, variants, shop profile and rating
   breakdown.

## What each operation does

Every operation runs one purpose-built Actor, so you only pay for the data you asked for.

### Product

| Operation | What comes back |
| --- | --- |
| **Get Details** | Full product page: `product_info`, `shop_info`, `review_info`, `categories`, `product_detail` |
| **Get Reviews** | One row per review: rating, text, images, verified-purchase and incentivised flags |
| **Get Review Insights** | One row per product: ranked `pain_points` and `praise_points`, `rating_distribution`, `verdict_summary`, `trend` |
| **Get Listing Health** | One row per product: `health_score`, per-`dimensions` scoring and a ranked `fix_items` list |
| **Get Creator Videos** | One row per affiliate video: creator, `play_count`, `like_count`, `ad_label` |
| **Get Recommendations** | The *You may like*, *More from this shop* or *Top reviewed* carousel, one row per product |

### Search

| Operation | What comes back |
| --- | --- |
| **Search Products** | One row per search result: price, rating, sold count, seller |
| **Get Search Insights** | Related search terms, recommended shops, frequently-bought-together or recommended-for-you |

### Seller, Category and Trending

| Operation | What comes back |
| --- | --- |
| **Seller → Get Shop Info** | `shop_rating`, `followers_count`, `sold_count`, `on_sell_product_count`, `review_count` |
| **Seller → Get Products** | The seller's catalog, one row per product |
| **Category → Get Products** | Products in a category, with `category_id` and `category_name` on every row |
| **Trending → Get Trending Products** | The flash-sale and top-seller rails, tagged with the `rail` they came from |

## Settings, in plain terms

### Products, Category and Seller

**Products** takes one product per line — a product page link or a bare product ID, and you can mix
the two. Commas work as a separator too, so an expression that returns a comma-joined list drops
straight in. **Category** and **Seller** work the same way with a page link or a bare ID.

### Region

Most operations let you pick the storefront: United States, United Kingdom, Singapore, Malaysia,
Philippines, Thailand, Vietnam, Japan or Mexico. This changes the actual products, prices and
currency you get back, not just the display language.

Search, Search Insights and both Seller operations are **US only** — TikTok publishes those pages
for the US storefront alone, so the node offers United States and nothing else rather than letting
you pick a region that silently returns nothing.

### Return All and Limit

Operations that return a list have the usual n8n pair. Leave **Return All** off and set a **Limit**,
or turn it on to keep going until the source runs out. Limits keep your Apify bill predictable —
start small.

### Enrich With Product Details

Available on the list-style operations. It adds the full product page to every row: description, all
variants, shop profile, a page of reviews with the star breakdown, and the category path. It costs
one extra request per product, so a 500-row export becomes 500 extra requests. Leave it off unless
you need those fields.

### Review Sample Size

How many recent reviews **Get Review Insights** and **Get Listing Health** read before analysing
them. A bigger sample surfaces quieter themes; a smaller one is cheaper and faster. Set it to `0` to
skip review analysis entirely.

### Scoring (Listing Health)

All five scoring passes run by default. Open **Scoring** only when you want to switch one off —
anything you do not add keeps the Actor's own default. Keyword Coverage and Competitive Position
need a **Search Keyword**; without one they are skipped and the rest of the report still arrives.

### Options

**Actor Memory** raises the memory for the run, which can shorten a large export at a higher cost
per minute. **Poll Timeout** is how long the node waits for the run to finish — the run keeps going
on Apify's side even if the node stops waiting, and the error message links to it.

## Recipes

### Daily price watch

**Schedule Trigger** → **TikTok Shop** (Product → Get Details) → **Google Sheets → Append**. Map
`product_id`, `name` and `product_info` and you have a price history.

### Alert on new bad reviews

**Schedule Trigger** → **TikTok Shop** (Product → Get Reviews, *Filter Reviews* = `1 Star Only`,
*Sort Reviews By* = `Most Recent`) → **Filter** on `review_time` → **Slack**.

### Summarise what buyers complain about

**TikTok Shop** (Product → Get Review Insights) → **Basic LLM Chain**. `pain_points` is already
ranked, so the model gets a short, structured input instead of a thousand raw reviews.

### Bulk-check a list of listings

**Google Sheets → Read** → **TikTok Shop** (Product → Get Listing Health). The node runs once per
input item, so a sheet of links becomes a sheet of scores and fixes.

## Common questions

**Do I need a TikTok login or cookies?** No. Everything here reads public pages.

**Why did I get fewer rows than my limit?** The limit is a ceiling, not a target. TikTok only
publishes so many results per page, and some rails are shorter than others.

**Why is a region missing from the dropdown?** Because that page only exists on the US storefront.
Offering it elsewhere would return an empty run and still cost you.

**The run finished but returned nothing.** The node logs a warning with a link to the run on Apify.
Nine times out of ten the product ID or link points at a storefront other than the region you chose.

**Can I use this as an AI tool?** Yes — the node is exposed to n8n's AI Agent as a tool.

## What it costs

Apify's free tier includes $5 of platform credit per month, which covers a lot of small runs. Actor
runs are billed by compute time, so the levers that matter are **Limit**, **Enrich With Product
Details** and **Review Sample Size**. Start with small limits and enrichment off.

## For developers

```bash
pnpm install          # install dependencies
pnpm run build        # compile to dist/
pnpm run lint         # n8n community-node lint
pnpm test             # unit tests for the pure helpers
pnpm run dev          # run a local n8n with this node linked
```

The Actor mapping lives in `nodes/TikTokShop/operations.ts` as a plain registry: each operation
names its Actor and the fields it forwards. The node's `displayOptions` are derived from that
registry, so the UI cannot drift out of step with the Actors. Adding an Actor means adding one
registry entry plus its UI properties — the run, poll and collect machinery is untouched.

## Links

- [Actors on Apify](https://apify.com/thenetaji)
- [Repository](https://github.com/thenetaji/apify-n8n-nodes)
- [Issues](https://github.com/thenetaji/apify-n8n-nodes/issues)
- [n8n community nodes](https://docs.n8n.io/integrations/community-nodes/)

## Version history

- **0.1.0** — first release: 12 operations across Product, Search, Seller, Category and Trending.

## License

MIT
