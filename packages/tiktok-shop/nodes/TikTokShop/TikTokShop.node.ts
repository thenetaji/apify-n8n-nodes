import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestOptions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError, sleep } from 'n8n-workflow';

import { isTerminalRunStatus, toApifyActorSlug } from './helpers';
import {
	buildRunPlan,
	OPERATIONS,
	SCORING_OPTION_KEYS,
	type OperationField,
	type OperationValues,
	type ScoringOptionKey,
} from './operations';

const APIFY_API_BASE = 'https://api.apify.com/v2';

/**
 * Operations whose backing Actor accepts a given field. Derived from the
 * registry rather than hand-listed so the UI cannot drift out of step with the
 * Actor mapping when an operation is added or its schema changes.
 */
function operationsWith(field: OperationField): string[] {
	return Object.keys(OPERATIONS).filter((name) => OPERATIONS[name].fields.includes(field));
}

const REGION_OPERATIONS = operationsWith('region').filter((name) => !OPERATIONS[name].usRegionOnly);
const US_REGION_OPERATIONS = operationsWith('region').filter(
	(name) => OPERATIONS[name].usRegionOnly,
);
const MAX_ITEMS_OPERATIONS = operationsWith('maxItems');
const ENRICH_OPERATIONS = operationsWith('enrichProductDetails');
const REVIEW_SAMPLE_OPERATIONS = operationsWith('reviewSampleSize');

const REGION_OPTIONS: INodePropertyOptions[] = [
	{ name: 'Japan', value: 'JP' },
	{ name: 'Malaysia', value: 'MY' },
	{ name: 'Mexico', value: 'MX' },
	{ name: 'Philippines', value: 'PH' },
	{ name: 'Singapore', value: 'SG' },
	{ name: 'Thailand', value: 'TH' },
	{ name: 'United Kingdom', value: 'GB' },
	{ name: 'United States', value: 'US' },
	{ name: 'Vietnam', value: 'VN' },
];

interface ApifyRunInfo {
	id: string;
	status: string;
	defaultDatasetId: string;
}

interface ApifyRunEnvelope {
	data: ApifyRunInfo;
}

async function apifyRequest(
	ctx: IExecuteFunctions,
	options: IHttpRequestOptions,
): Promise<IDataObject> {
	// Which credential to send is a node-level choice, so it is read once from
	// the first item rather than per item.
	const credential = ctx.getNodeParameter('authentication', 0, 'apifyApi') as string;

	return (await ctx.helpers.httpRequestWithAuthentication.call(
		ctx,
		credential,
		options,
	)) as IDataObject;
}

export class TikTokShop implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'TikTok Shop',
		name: 'tikTokShop',
		icon: { light: 'file:tikTokShop.svg', dark: 'file:tikTokShop.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Scrape TikTok Shop products, reviews, sellers and search via Apify Actors',
		defaults: {
			name: 'TikTok Shop',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: 'apifyApi',
				required: true,
				displayOptions: {
					show: {
						authentication: ['apifyApi'],
					},
				},
			},
			{
				name: 'apifyOAuth2Api',
				required: true,
				displayOptions: {
					show: {
						authentication: ['apifyOAuth2Api'],
					},
				},
			},
		],
		properties: [
			{
				displayName: 'Authentication',
				name: 'authentication',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'API Key',
						value: 'apifyApi',
					},
					{
						name: 'OAuth2',
						value: 'apifyOAuth2Api',
					},
				],
				default: 'apifyApi',
				description:
					'How to connect to Apify. API Key works everywhere; OAuth2 is the easier choice on n8n Cloud, where pasting a long-lived token is awkward.',
			},
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Category',
						value: 'category',
						description: 'Browse the products listed under a TikTok Shop category',
					},
					{
						name: 'Product',
						value: 'product',
						description: 'Work with individual TikTok Shop product pages',
					},
					{
						name: 'Search',
						value: 'search',
						description: 'Search TikTok Shop and read its keyword insights',
					},
					{
						name: 'Seller',
						value: 'seller',
						description: 'Read a TikTok Shop seller profile and its catalog',
					},
					{
						name: 'Trending',
						value: 'trending',
						description: 'Read the TikTok Shop trending and flash-sale rails',
					},
				],
				default: 'product',
			},
			// ---------------------------------------------------------------
			// Operations, one property per resource
			// ---------------------------------------------------------------
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['product'] } },
				options: [
					{
						name: 'Get Creator Videos',
						value: 'productCreatorVideos',
						description: 'List the affiliate creators promoting a product, with view counts',
						action: 'Get creator videos for a product',
					},
					{
						name: 'Get Details',
						value: 'productDetails',
						description: 'Fetch the full product page: price, variants, shop and rating',
						action: 'Get product details',
					},
					{
						name: 'Get Listing Health',
						value: 'productListingHealth',
						description: 'Score a listing and return a ranked list of fixes',
						action: 'Get listing health for a product',
					},
					{
						name: 'Get Recommendations',
						value: 'productRecommendations',
						description: 'Read a product page recommendation carousel',
						action: 'Get recommendations for a product',
					},
					{
						name: 'Get Review Insights',
						value: 'productReviewInsights',
						description: 'Rank the pain points and praise found across a product reviews',
						action: 'Get review insights for a product',
					},
					{
						name: 'Get Reviews',
						value: 'productReviews',
						description: 'List reviews with ratings, photos and buyer details',
						action: 'Get reviews for a product',
					},
				],
				default: 'productDetails',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['search'] } },
				options: [
					{
						name: 'Get Search Insights',
						value: 'searchInsights',
						description: 'Read related terms, recommended shops and bundles for a keyword',
						action: 'Get search insights',
					},
					{
						name: 'Search Products',
						value: 'searchProducts',
						description: 'Search TikTok Shop for products matching a keyword',
						action: 'Search products',
					},
				],
				default: 'searchProducts',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['seller'] } },
				options: [
					{
						name: 'Get Products',
						value: 'sellerProducts',
						description: 'Export a seller full product catalog',
						action: 'Get products for a seller',
					},
					{
						name: 'Get Shop Info',
						value: 'sellerInfo',
						description: 'Fetch a seller rating, follower count and sales figures',
						action: 'Get shop info for a seller',
					},
				],
				default: 'sellerInfo',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['category'] } },
				options: [
					{
						name: 'Get Products',
						value: 'categoryProducts',
						description: 'List the products, brands and prices in a category',
						action: 'Get products in a category',
					},
				],
				default: 'categoryProducts',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['trending'] } },
				options: [
					{
						name: 'Get Trending Products',
						value: 'trendingProducts',
						description: 'Read the flash sale and top seller rails for a storefront',
						action: 'Get trending products',
					},
				],
				default: 'trendingProducts',
			},
			// ---------------------------------------------------------------
			// Targets
			// ---------------------------------------------------------------
			{
				displayName: 'Products',
				name: 'productIds',
				type: 'string',
				typeOptions: { rows: 4 },
				default: 'https://shop.tiktok.com/us/pdp/1730927783781307026',
				required: true,
				placeholder: 'https://shop.tiktok.com/us/pdp/1730927783781307026',
				description:
					'One TikTok Shop product page link or product ID per line. Links and bare IDs can be mixed, and commas are also accepted as a separator.',
				displayOptions: { show: { operation: operationsWith('productIds') } },
			},
			{
				displayName: 'Search Keyword',
				name: 'keyword',
				type: 'string',
				default: 'wireless earbuds',
				required: true,
				placeholder: 'wireless earbuds',
				description: 'Product keyword to search for on TikTok Shop',
				displayOptions: { show: { operation: operationsWith('keyword') } },
			},
			{
				displayName: 'Search Keyword',
				name: 'keyword',
				type: 'string',
				default: '',
				placeholder: 'wireless earbuds',
				description:
					'Optional keyword the listing should rank for. Supplying one unlocks the keyword coverage and competitive position checks; without it the rest of the report is still returned.',
				displayOptions: { show: { operation: operationsWith('keywordOptional') } },
			},
			{
				displayName: 'Category',
				name: 'categoryId',
				type: 'string',
				default: 'https://shop.tiktok.com/us/c/category/601450',
				required: true,
				placeholder: 'https://shop.tiktok.com/us/c/category/601450',
				description: 'A TikTok Shop category page link, or a bare category ID',
				displayOptions: { show: { operation: operationsWith('categoryId') } },
			},
			{
				displayName: 'Seller',
				name: 'sellerId',
				type: 'string',
				default: '',
				required: true,
				placeholder: '7495516049083828882',
				description: 'A TikTok Shop seller page link, or a bare seller ID',
				displayOptions: { show: { operation: operationsWith('sellerId') } },
			},
			// ---------------------------------------------------------------
			// Which sub-collection (maps to the Actors' scraperType)
			// ---------------------------------------------------------------
			{
				displayName: 'Carousel',
				name: 'scraperType',
				type: 'options',
				default: 'youMayLike',
				description: 'Which product page recommendation carousel to collect',
				options: [
					{ name: 'More From This Shop', value: 'moreFromShop' },
					{ name: 'Top Reviewed From This Shop', value: 'topReviewed' },
					{ name: 'You May Like', value: 'youMayLike' },
				],
				displayOptions: { show: { operation: ['productRecommendations'] } },
			},
			{
				displayName: 'Insight',
				name: 'scraperType',
				type: 'options',
				default: 'relatedTerms',
				description: 'Which part of the TikTok Shop search page to collect',
				options: [
					{ name: 'Frequently Bought Together', value: 'frequentlyBoughtTogether' },
					{ name: 'Recommended for You', value: 'recommendedForYou' },
					{ name: 'Related Search Terms', value: 'relatedTerms' },
					{ name: 'Shops for This Keyword', value: 'recommendedShops' },
				],
				displayOptions: { show: { operation: ['searchInsights'] } },
			},
			// ---------------------------------------------------------------
			// Region
			// ---------------------------------------------------------------
			{
				displayName: 'Region',
				name: 'region',
				type: 'options',
				default: 'US',
				description:
					'Which TikTok Shop storefront to read. This changes the products, prices and currency you get back, not just the display language.',
				options: REGION_OPTIONS,
				displayOptions: { show: { operation: REGION_OPERATIONS } },
			},
			{
				displayName: 'Region',
				name: 'region',
				type: 'options',
				default: 'US',
				description:
					'United States only. TikTok publishes this page for its US storefront alone, so other storefronts return nothing and are not offered here.',
				options: [{ name: 'United States', value: 'US' }],
				displayOptions: { show: { operation: US_REGION_OPERATIONS } },
			},
			// ---------------------------------------------------------------
			// Result volume
			// ---------------------------------------------------------------
			{
				displayName: 'Return All',
				name: 'returnAll',
				type: 'boolean',
				default: false,
				description: 'Whether to return all results or only up to a given limit',
				displayOptions: { show: { operation: MAX_ITEMS_OPERATIONS } },
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				default: 50,
				typeOptions: { minValue: 1 },
				description: 'Max number of results to return',
				displayOptions: { show: { operation: MAX_ITEMS_OPERATIONS, returnAll: [false] } },
			},
			// ---------------------------------------------------------------
			// Review shaping
			// ---------------------------------------------------------------
			{
				displayName: 'Sort Reviews By',
				name: 'reviewSort',
				type: 'options',
				default: 'recommended',
				description:
					'Order reviews are returned in. Most recent walks the newest first, which is the right choice for tracking sentiment over time.',
				options: [
					{ name: 'Most Recent', value: 'most_recent' },
					{ name: 'Recommended', value: 'recommended' },
				],
				displayOptions: { show: { operation: operationsWith('reviewSort') } },
			},
			{
				displayName: 'Filter Reviews',
				name: 'reviewFilter',
				type: 'options',
				default: 'all',
				description:
					'Narrow to one star rating, to reviews carrying photos or video, or to confirmed purchases. Only one filter applies at a time.',
				options: [
					{ name: '1 Star Only', value: '1_star' },
					{ name: '2 Star Only', value: '2_star' },
					{ name: '3 Star Only', value: '3_star' },
					{ name: '4 Star Only', value: '4_star' },
					{ name: '5 Star Only', value: '5_star' },
					{ name: 'All Reviews', value: 'all' },
					{ name: 'Verified Purchases Only', value: 'verified_purchase' },
					{ name: 'With Photos or Video', value: 'with_media' },
				],
				displayOptions: { show: { operation: operationsWith('reviewFilter') } },
			},
			{
				displayName: 'Review Sample Size',
				name: 'reviewSampleSize',
				type: 'number',
				default: 100,
				typeOptions: { minValue: 0 },
				description:
					'How many recent reviews to pull per product before analysing them. A larger sample surfaces quieter themes at the cost of a larger request per product. Set 0 to skip review analysis entirely.',
				displayOptions: { show: { operation: REVIEW_SAMPLE_OPERATIONS } },
			},
			// ---------------------------------------------------------------
			// Enrichment
			// ---------------------------------------------------------------
			{
				displayName: 'Enrich With Product Details',
				name: 'enrichProductDetails',
				type: 'boolean',
				default: false,
				description:
					'Whether to add the full product page to every row: description, all variants, shop profile, a page of reviews with the star breakdown, and the category path. This costs one extra request per product.',
				displayOptions: { show: { operation: ENRICH_OPERATIONS } },
			},
			{
				displayName: 'Scoring',
				name: 'scoringOptions',
				type: 'collection',
				placeholder: 'Add Scoring Option',
				default: {},
				description:
					'Turn individual scoring passes off. Every pass runs by default; each one adds requests to the run.',
				displayOptions: { show: { operation: operationsWith('scoringOptions') } },
				options: [
					{
						displayName: 'Score Category Benchmark',
						name: 'includeCategoryBenchmark',
						type: 'boolean',
						default: true,
						description:
							'Whether to compare the rating against the best-reviewed items TikTok Shop surfaces on its own page. Adds one request per product.',
					},
					{
						displayName: 'Score Competitive Position',
						name: 'includeCompetitive',
						type: 'boolean',
						default: true,
						description:
							'Whether to compare price and rating against the top search results for the keyword, and flag if the product does not appear in them at all. Needs a Search Keyword.',
					},
					{
						displayName: 'Score Creator Presence',
						name: 'includeCreators',
						type: 'boolean',
						default: true,
						description:
							'Whether to check how many creators promote the product, their combined view count, and whether any carry a paid-partnership label. Adds one request per product.',
					},
					{
						displayName: 'Score Keyword Coverage',
						name: 'includeKeywordCoverage',
						type: 'boolean',
						default: true,
						description:
							"Whether to check the title against TikTok's own related search terms for the keyword and flag high-intent terms missing from it. Needs a Search Keyword.",
					},
					{
						displayName: 'Score Shop Signal',
						name: 'includeShopSignal',
						type: 'boolean',
						default: true,
						description:
							"Whether to add the seller's shop-level rating to the report. Adds one request per distinct shop, shared across products from the same shop.",
					},
				],
			},
			// ---------------------------------------------------------------
			// Run options
			// ---------------------------------------------------------------
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Actor Memory (MB)',
						name: 'memoryMbytes',
						type: 'options',
						default: 0,
						description:
							'Memory to allocate to the Actor run. Higher memory can shorten large runs at a higher cost per minute.',
						options: [
							{ name: 'Use Actor Default', value: 0 },
							{ name: '256 MB', value: 256 },
							{ name: '512 MB', value: 512 },
							{ name: '1024 MB', value: 1024 },
							{ name: '2048 MB', value: 2048 },
							{ name: '4096 MB', value: 4096 },
							{ name: '8192 MB', value: 8192 },
						],
					},
					{
						displayName: 'Poll Timeout (Minutes)',
						name: 'pollTimeoutMinutes',
						type: 'number',
						default: 10,
						description:
							"Maximum time for this node to wait for the Actor run to finish before it stops polling and throws a timeout error. The run keeps executing on Apify's side even after this node gives up waiting for it.",
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const operation = this.getNodeParameter('operation', itemIndex) as string;
				const spec = OPERATIONS[operation];

				if (!spec) {
					throw new NodeOperationError(this.getNode(), `Unknown operation "${operation}".`, {
						itemIndex,
					});
				}

				// Only the parameters this operation declares are read, so a field
				// hidden for the current operation never reaches the Actor input.
				const values: OperationValues = {};
				for (const field of spec.fields) {
					switch (field) {
						case 'productIds':
							values.productIds = this.getNodeParameter('productIds', itemIndex, '') as string;
							break;
						case 'keyword':
						case 'keywordOptional':
							values.keyword = this.getNodeParameter('keyword', itemIndex, '') as string;
							break;
						case 'categoryId':
							values.categoryId = this.getNodeParameter('categoryId', itemIndex, '') as string;
							break;
						case 'sellerId':
							values.sellerId = this.getNodeParameter('sellerId', itemIndex, '') as string;
							break;
						case 'region':
							values.region = this.getNodeParameter('region', itemIndex, 'US') as string;
							break;
						case 'maxItems':
							values.returnAll = this.getNodeParameter('returnAll', itemIndex, false) as boolean;
							values.limit = this.getNodeParameter('limit', itemIndex, 50) as number;
							break;
						case 'enrichProductDetails':
							values.enrichProductDetails = this.getNodeParameter(
								'enrichProductDetails',
								itemIndex,
								false,
							) as boolean;
							break;
						case 'reviewSort':
							values.reviewSort = this.getNodeParameter(
								'reviewSort',
								itemIndex,
								'recommended',
							) as string;
							break;
						case 'reviewFilter':
							values.reviewFilter = this.getNodeParameter(
								'reviewFilter',
								itemIndex,
								'all',
							) as string;
							break;
						case 'reviewSampleSize':
							values.reviewSampleSize = this.getNodeParameter(
								'reviewSampleSize',
								itemIndex,
								100,
							) as number;
							break;
						case 'scraperType':
							values.scraperType = this.getNodeParameter('scraperType', itemIndex, '') as string;
							break;
						case 'scoringOptions': {
							const raw = this.getNodeParameter('scoringOptions', itemIndex, {}) as IDataObject;
							const scoring: Partial<Record<ScoringOptionKey, boolean>> = {};
							for (const key of SCORING_OPTION_KEYS) {
								if (typeof raw[key] === 'boolean') {
									scoring[key] = raw[key] as boolean;
								}
							}
							values.scoringOptions = scoring;
							break;
						}
					}
				}

				let plan;
				try {
					plan = buildRunPlan(operation, values);
				} catch (error) {
					throw new NodeOperationError(this.getNode(), (error as Error).message, { itemIndex });
				}

				const actorSlug = toApifyActorSlug(plan.actor);

				const options = this.getNodeParameter('options', itemIndex, {}) as {
					memoryMbytes?: number;
					pollTimeoutMinutes?: number;
				};
				const memoryMbytes = options.memoryMbytes ?? 0;
				const pollTimeoutMinutes =
					options.pollTimeoutMinutes && options.pollTimeoutMinutes > 0
						? options.pollTimeoutMinutes
						: 10;

				// -----------------------------------------------------------
				// 1. Start the Actor run
				// -----------------------------------------------------------
				const startQs: IDataObject = { waitForFinish: 30 };
				if (memoryMbytes) {
					startQs.memory = memoryMbytes;
				}

				const startResponse = (await apifyRequest(this, {
					method: 'POST',
					url: `${APIFY_API_BASE}/acts/${actorSlug}/runs`,
					qs: startQs,
					body: plan.input,
					json: true,
				})) as unknown as ApifyRunEnvelope;

				const runId = startResponse?.data?.id;
				if (!runId) {
					throw new NodeOperationError(
						this.getNode(),
						'Apify did not return a run ID when starting the Actor run.',
						{ itemIndex },
					);
				}

				const consoleRunUrl = `https://console.apify.com/actors/${actorSlug}/runs/${runId}`;

				// -----------------------------------------------------------
				// 2. Poll until the run reaches a terminal status
				// -----------------------------------------------------------
				let runInfo = startResponse.data;
				const deadline = Date.now() + pollTimeoutMinutes * 60_000;

				while (!isTerminalRunStatus(runInfo.status)) {
					if (Date.now() > deadline) {
						throw new NodeOperationError(
							this.getNode(),
							`Timed out after ${pollTimeoutMinutes} minute(s) waiting for the Apify run to finish. The run is still executing on Apify's side; check its progress at ${consoleRunUrl}.`,
							{ itemIndex },
						);
					}

					const pollResponse = (await apifyRequest(this, {
						method: 'GET',
						url: `${APIFY_API_BASE}/actor-runs/${runId}`,
						qs: { waitForFinish: 30 },
						json: true,
					})) as unknown as ApifyRunEnvelope;
					runInfo = pollResponse.data;

					if (!isTerminalRunStatus(runInfo.status)) {
						await sleep(1000);
					}
				}

				if (runInfo.status !== 'SUCCEEDED') {
					throw new NodeApiError(
						this.getNode(),
						{ message: `Apify run ${runId} ended with status ${runInfo.status}.` },
						{
							message: `Apify run ended with status ${runInfo.status}`,
							description: `Inspect the run for details: ${consoleRunUrl}`,
							itemIndex,
						},
					);
				}

				// -----------------------------------------------------------
				// 3. Fetch the resulting dataset items
				// -----------------------------------------------------------
				const datasetItems = (await apifyRequest(this, {
					method: 'GET',
					url: `${APIFY_API_BASE}/datasets/${runInfo.defaultDatasetId}/items`,
					qs: { format: 'json', clean: true },
					json: true,
				})) as unknown as IDataObject[];

				if (datasetItems.length === 0) {
					this.logger.warn(
						`TikTok Shop: run ${runId} finished successfully but returned no items. TikTok serves some pages to a subset of regions only; check ${consoleRunUrl} for the run log.`,
					);
				}

				for (const item of datasetItems) {
					returnData.push({
						json: { ...item },
						pairedItem: { item: itemIndex },
					});
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: itemIndex },
					});
					continue;
				}
				// Errors raised above are already NodeApiError/NodeOperationError
				// carrying the failing run's Console URL and item index; re-wrapping
				// them would drop that detail. Anything else — a transport failure, a
				// malformed response — is wrapped so no raw error reaches the user.
				throw error instanceof NodeApiError || error instanceof NodeOperationError
					? error
					: new NodeOperationError(this.getNode(), error as Error, { itemIndex });
			}
		}

		return [returnData];
	}
}
