/**
 * The operation registry: which Apify Actor backs each node operation, and how
 * the node's parameters are folded into that Actor's run input.
 *
 * Every TikTok Shop Actor draws from the same small field vocabulary
 * (`product_ids`, `keyword`, `region`, `maxItems`, ...), so the mapping is kept
 * as data here rather than as a branch per operation in `execute()`. Adding an
 * Actor means adding one entry below plus its UI properties in the node
 * description — no changes to the run/poll/collect machinery.
 *
 * Actor pages: https://apify.com/thenetaji
 *
 * Deliberately import-free so the unit tests can load it directly under Node's
 * native TypeScript support, which does not resolve extensionless relative
 * specifiers.
 */

/**
 * Convert a newline/comma-separated block of links or IDs into the plain
 * string array the Actors' `stringList` editor publishes in its input schema.
 * De-duplicates on the raw trimmed string; the Actors resolve links to IDs
 * themselves and de-duplicate again downstream.
 */
export function parseListInput(raw: string): string[] {
	const seen = new Set<string>();
	const entries: string[] = [];

	for (const token of (raw ?? '').split(/[\n,]+/)) {
		const trimmed = token.trim();
		if (trimmed === '' || seen.has(trimmed)) {
			continue;
		}
		seen.add(trimmed);
		entries.push(trimmed);
	}

	return entries;
}

/**
 * Collapse n8n's `returnAll` + `limit` pair into the Actors' single `maxItems`
 * field, where 0 means "no limit". A non-positive limit is treated as
 * unlimited rather than silently returning nothing.
 */
export function resolveMaxItems(returnAll: boolean, limit: number): number {
	if (returnAll || !Number.isFinite(limit) || limit <= 0) {
		return 0;
	}

	return Math.floor(limit);
}

/** A node parameter that feeds the Actor run input. */
export type OperationField =
	| 'productIds'
	| 'keyword'
	| 'keywordOptional'
	| 'categoryId'
	| 'sellerId'
	| 'region'
	| 'maxItems'
	| 'enrichProductDetails'
	| 'reviewSort'
	| 'reviewFilter'
	| 'reviewSampleSize'
	| 'scraperType'
	| 'scoringOptions';

export interface OperationSpec {
	/** Apify Actor in `owner/actor-name` form, as it appears on its public page. */
	actor: string;
	/** Human label used in validation messages. */
	label: string;
	/** Which node parameters are folded into the run input, in schema order. */
	fields: OperationField[];
	/**
	 * True when the backing Actor's schema offers the US storefront alone.
	 * The node shows a separate, US-only Region dropdown for these.
	 */
	usRegionOnly: boolean;
}

export const OPERATIONS: Record<string, OperationSpec> = {
	productDetails: {
		actor: 'thenetaji/tiktok-shop-product-scraper',
		label: 'Get Product Details',
		fields: ['productIds', 'region'],
		usRegionOnly: false,
	},
	productReviews: {
		actor: 'thenetaji/tiktok-shop-reviews-scraper',
		label: 'Get Product Reviews',
		fields: ['productIds', 'region', 'maxItems', 'reviewSort', 'reviewFilter'],
		usRegionOnly: false,
	},
	productReviewInsights: {
		actor: 'thenetaji/tiktok-shop-review-insights',
		label: 'Get Review Insights',
		fields: ['productIds', 'region', 'reviewSampleSize'],
		usRegionOnly: false,
	},
	productListingHealth: {
		actor: 'thenetaji/tiktok-shop-listing-health',
		label: 'Get Listing Health',
		fields: ['productIds', 'region', 'keywordOptional', 'reviewSampleSize', 'scoringOptions'],
		usRegionOnly: false,
	},
	productCreatorVideos: {
		actor: 'thenetaji/tiktok-shop-creator-videos-scraper',
		label: 'Get Creator Videos',
		fields: ['productIds', 'region', 'maxItems'],
		usRegionOnly: false,
	},
	productRecommendations: {
		actor: 'thenetaji/tiktok-shop-recommendations-scraper',
		label: 'Get Recommendations',
		fields: ['scraperType', 'productIds', 'region', 'maxItems', 'enrichProductDetails'],
		usRegionOnly: false,
	},
	searchProducts: {
		actor: 'thenetaji/tiktok-shop-search-scraper',
		label: 'Search Products',
		fields: ['keyword', 'region', 'maxItems', 'enrichProductDetails'],
		usRegionOnly: true,
	},
	searchInsights: {
		actor: 'thenetaji/tiktok-shop-search-insights-scraper',
		label: 'Get Search Insights',
		fields: ['scraperType', 'keyword', 'region', 'maxItems', 'enrichProductDetails'],
		usRegionOnly: true,
	},
	sellerInfo: {
		actor: 'thenetaji/tiktok-shop-seller-info-scraper',
		label: 'Get Shop Info',
		fields: ['sellerId', 'region'],
		usRegionOnly: true,
	},
	sellerProducts: {
		actor: 'thenetaji/tiktok-shop-seller-products-scraper',
		label: 'Get Seller Products',
		fields: ['sellerId', 'region', 'maxItems', 'enrichProductDetails'],
		usRegionOnly: true,
	},
	categoryProducts: {
		actor: 'thenetaji/tiktok-shop-category-products-scraper',
		label: 'Get Category Products',
		fields: ['categoryId', 'region', 'maxItems', 'enrichProductDetails'],
		usRegionOnly: false,
	},
	trendingProducts: {
		actor: 'thenetaji/tiktok-shop-trending-scraper',
		label: 'Get Trending Products',
		fields: ['region', 'maxItems', 'enrichProductDetails'],
		usRegionOnly: false,
	},
};

/** The five optional scoring passes the Listing Health Actor can run. */
export const SCORING_OPTION_KEYS = [
	'includeKeywordCoverage',
	'includeCompetitive',
	'includeCreators',
	'includeCategoryBenchmark',
	'includeShopSignal',
] as const;

export type ScoringOptionKey = (typeof SCORING_OPTION_KEYS)[number];

/** Node parameter values, already read off the node by `execute()`. */
export interface OperationValues {
	productIds?: string;
	keyword?: string;
	categoryId?: string;
	sellerId?: string;
	region?: string;
	returnAll?: boolean;
	limit?: number;
	enrichProductDetails?: boolean;
	reviewSort?: string;
	reviewFilter?: string;
	reviewSampleSize?: number;
	scraperType?: string;
	scoringOptions?: Partial<Record<ScoringOptionKey, boolean>>;
}

export interface RunPlan {
	actor: string;
	input: Record<string, unknown>;
}

function requireText(raw: string | undefined, fieldLabel: string): string {
	const trimmed = (raw ?? '').trim();

	if (trimmed === '') {
		throw new Error(`${fieldLabel} is required for this operation.`);
	}

	return trimmed;
}

/**
 * Build the Apify run input for one operation.
 *
 * Only the fields the operation declares are emitted, so an Actor never
 * receives a key its schema does not define — with `strict` input validation on
 * the Apify side, an unknown key fails the run rather than being ignored.
 */
export function buildRunPlan(operation: string, values: OperationValues): RunPlan {
	const spec = OPERATIONS[operation];

	if (!spec) {
		throw new Error(`Unknown operation "${operation}".`);
	}

	const input: Record<string, unknown> = {};

	for (const field of spec.fields) {
		switch (field) {
			case 'productIds': {
				const productIds = parseListInput(values.productIds ?? '');
				if (productIds.length === 0) {
					throw new Error('Provide at least one TikTok Shop product link or product ID.');
				}
				input.product_ids = productIds;
				break;
			}
			case 'keyword':
				input.keyword = requireText(values.keyword, 'Search Keyword');
				break;
			case 'keywordOptional': {
				// Listing Health scores keyword coverage and competitive position only
				// when a keyword is supplied; without one the Actor still returns the
				// rest of the report, so an empty value is omitted rather than rejected.
				const keyword = (values.keyword ?? '').trim();
				if (keyword !== '') {
					input.keyword = keyword;
				}
				break;
			}
			case 'categoryId':
				input.category_id = requireText(values.categoryId, 'Category');
				break;
			case 'sellerId':
				input.seller_id = requireText(values.sellerId, 'Seller');
				break;
			case 'region':
				input.region = requireText(values.region, 'Region');
				break;
			case 'maxItems':
				input.maxItems = resolveMaxItems(values.returnAll ?? false, values.limit ?? 0);
				break;
			case 'enrichProductDetails':
				input.enrichProductDetails = values.enrichProductDetails ?? false;
				break;
			case 'reviewSort':
				input.reviewSort = values.reviewSort ?? 'recommended';
				break;
			case 'reviewFilter':
				input.reviewFilter = values.reviewFilter ?? 'all';
				break;
			case 'reviewSampleSize':
				input.reviewSampleSize = values.reviewSampleSize ?? 100;
				break;
			case 'scraperType':
				input.scraperType = requireText(values.scraperType, 'Collection type');
				break;
			case 'scoringOptions': {
				// Every scoring pass defaults to on inside the Actor. Only keys the
				// user actually set are forwarded, so an untouched collection leaves
				// the Actor's own defaults in place instead of pinning them here.
				const scoring = values.scoringOptions ?? {};
				for (const key of SCORING_OPTION_KEYS) {
					if (typeof scoring[key] === 'boolean') {
						input[key] = scoring[key];
					}
				}
				break;
			}
		}
	}

	return { actor: spec.actor, input };
}
