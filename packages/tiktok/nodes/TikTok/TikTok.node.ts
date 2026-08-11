import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestOptions,
	IN8nHttpFullResponse,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError, sleep } from 'n8n-workflow';

import { buildDownloadFileName, isTerminalRunStatus, toApifyActorSlug } from './helpers';
import { buildRunPlan, OPERATIONS, type OperationField, type OperationValues } from './operations';

const APIFY_API_BASE = 'https://api.apify.com/v2';

/**
 * Fields collected from a collection rather than from a top-level property, so
 * the node panel stays short for the common case. The value is the name of the
 * collection parameter each one lives in.
 */
const COLLECTION_FIELDS: Partial<Record<OperationField, string>> = {
	proxyGroup: 'options',
	advertiserId: 'adsFilters',
	startTime: 'adsFilters',
	endTime: 'adsFilters',
	industryIds: 'rankedFilters',
	objectiveIds: 'rankedFilters',
	adFormat: 'rankedFilters',
	likesPercentile: 'rankedFilters',
	adLanguage: 'rankedFilters',
};

/**
 * Operations whose backing Actor accepts a given field. Derived from the
 * registry rather than hand-listed so the UI cannot drift out of step with the
 * Actor mapping when an operation is added or its schema changes.
 */
function operationsWith(field: OperationField): string[] {
	return Object.keys(OPERATIONS).filter((name) => OPERATIONS[name].fields.includes(field));
}

const MAX_ITEMS_OPERATIONS = operationsWith('maxItems');
const FILE_OPERATIONS = Object.keys(OPERATIONS).filter((name) => OPERATIONS[name].producesFiles);

/**
 * Operations backed by an Actor that batches its requests and rejects a run
 * with fewer than `minEntries` URLs. They get their own URL property so the
 * requirement is stated in the field the user is typing into, and a default
 * that already satisfies it.
 */
const BATCHED_URL_OPERATIONS = Object.keys(OPERATIONS).filter(
	(name) => (OPERATIONS[name].minEntries ?? 1) > 1,
);

const BATCHED_URL_DEFAULT = [
	'https://www.tiktok.com/@addisonre',
	'https://www.tiktok.com/@khaby.lame',
	'https://www.tiktok.com/@estelle.diary/video/7528195989270842655',
	'https://www.tiktok.com/@aliassafari1/video/7515041580957551890',
].join('\n');

const METRIC_OPTIONS: INodePropertyOptions[] = [
	{ name: 'Clicks', value: 'click_cnt' },
	{ name: 'Conversions', value: 'convert_cnt' },
	{ name: 'CTR', value: 'retain_ctr' },
	{ name: 'CVR', value: 'retain_cvr' },
	{ name: 'Viewer Retention', value: 'play_retain_cnt' },
];

const PERIOD_OPTIONS: INodePropertyOptions[] = [
	{ name: 'Last 7 Days', value: '7' },
	{ name: 'Last 30 Days', value: '30' },
	{ name: 'Last 180 Days', value: '180' },
];

const COUNTRY_OPTIONS: INodePropertyOptions[] = [
	{ name: 'All Countries', value: 'ALL' },
	{ name: 'Argentina', value: 'AR' },
	{ name: 'Australia', value: 'AU' },
	{ name: 'Brazil', value: 'BR' },
	{ name: 'Canada', value: 'CA' },
	{ name: 'Colombia', value: 'CO' },
	{ name: 'France', value: 'FR' },
	{ name: 'Germany', value: 'DE' },
	{ name: 'Indonesia', value: 'ID' },
	{ name: 'Italy', value: 'IT' },
	{ name: 'Japan', value: 'JP' },
	{ name: 'Malaysia', value: 'MY' },
	{ name: 'Mexico', value: 'MX' },
	{ name: 'Netherlands', value: 'NL' },
	{ name: 'Pakistan', value: 'PK' },
	{ name: 'Philippines', value: 'PH' },
	{ name: 'Romania', value: 'RO' },
	{ name: 'Saudi Arabia', value: 'SA' },
	{ name: 'Singapore', value: 'SG' },
	{ name: 'South Africa', value: 'ZA' },
	{ name: 'South Korea', value: 'KR' },
	{ name: 'Spain', value: 'ES' },
	{ name: 'Sweden', value: 'SE' },
	{ name: 'Thailand', value: 'TH' },
	{ name: 'Turkey', value: 'TR' },
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
	return (await ctx.helpers.httpRequestWithAuthentication.call(
		ctx,
		'apifyApi',
		options,
	)) as IDataObject;
}

export class TikTok implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'TikTok',
		name: 'tikTok',
		icon: { light: 'file:tikTok.svg', dark: 'file:tikTok.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description:
			'Scrape TikTok posts, profiles, the Ads Library and Top Ads, or download videos, via Apify Actors',
		defaults: {
			name: 'TikTok',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: 'apifyApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Ad',
						value: 'ad',
						description: "Research TikTok's public Ads Library and Top Ads charts",
					},
					{
						name: 'Post',
						value: 'post',
						description: 'Read post metadata, stats and author',
					},
					{
						name: 'Profile',
						value: 'profile',
						description: 'Read a creator profile and its stats',
					},
					{
						name: 'Video',
						value: 'video',
						description: 'Download a video file without a watermark',
					},
				],
				default: 'post',
			},
			// ---------------------------------------------------------------
			// Operations, one property per resource
			// ---------------------------------------------------------------
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['post'] } },
				options: [
					{
						name: 'Get Details',
						value: 'postDetails',
						description: 'Fetch post metadata, stats, music and author',
						action: 'Get post details',
					},
					{
						name: 'Scrape Any URL',
						value: 'postAnyUrl',
						description: 'Accept a mixed list of post and profile URLs and detect each one',
						action: 'Scrape any URL',
					},
				],
				default: 'postDetails',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['profile'] } },
				options: [
					{
						name: 'Get Details',
						value: 'profileDetails',
						description: 'Fetch a creator profile, follower counts and bio',
						action: 'Get profile details',
					},
				],
				default: 'profileDetails',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['video'] } },
				options: [
					{
						name: 'Download',
						value: 'videoDownload',
						description: 'Download videos without a watermark',
						action: 'Download a video',
					},
				],
				default: 'videoDownload',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['ad'] } },
				options: [
					{
						name: 'Analyze Creatives',
						value: 'topAdsAnalyze',
						description: 'Inspect known Top Ad creatives and find similar ones',
						action: 'Analyze creatives',
					},
					{
						name: 'Browse Spotlight Creatives',
						value: 'topAdsSpotlight',
						description: "Browse TikTok's curated Spotlight examples",
						action: 'Browse spotlight creatives',
					},
					{
						name: 'Get Top Ads',
						value: 'topAdsRanked',
						description: 'Search high-performing Top Ads with filters',
						action: 'Get top ads',
					},
					{
						name: 'Search Ads Library',
						value: 'adsLibrary',
						description: "Search TikTok's public Ads Library by brand, product or phrase",
						action: 'Search the ads library',
					},
				],
				default: 'adsLibrary',
			},
			// ---------------------------------------------------------------
			// Targets
			// ---------------------------------------------------------------
			{
				displayName: 'URLs',
				name: 'urls',
				type: 'string',
				typeOptions: { rows: 5 },
				default: BATCHED_URL_DEFAULT,
				required: true,
				placeholder: 'https://www.tiktok.com/@khaby.lame',
				description:
					'One TikTok post or profile URL per line, with <b>at least four</b> URLs. This Actor batches its requests and rejects shorter runs. Commas are also accepted as a separator.',
				displayOptions: { show: { operation: BATCHED_URL_OPERATIONS } },
			},
			{
				displayName: 'URLs',
				name: 'urls',
				type: 'string',
				typeOptions: { rows: 4 },
				default: 'https://www.tiktok.com/@khaby.lame',
				required: true,
				placeholder: 'https://www.tiktok.com/@khaby.lame',
				description: 'One TikTok profile URL per line. Commas are also accepted as a separator.',
				displayOptions: { show: { operation: ['profileDetails'] } },
			},
			{
				displayName: 'URLs',
				name: 'urls',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
				required: true,
				placeholder: 'https://www.tiktok.com/@nikolaisavic/video/7609823185772580118',
				description: 'One TikTok video URL per line. Commas are also accepted as a separator.',
				displayOptions: { show: { operation: ['videoDownload'] } },
			},
			{
				displayName: 'Search Query',
				name: 'adsQuery',
				type: 'string',
				default: 'running shoes',
				required: true,
				placeholder: 'running shoes',
				description: "Brand, product, message or phrase to find in TikTok's public Ads Library",
				displayOptions: { show: { operation: operationsWith('adsQuery') } },
			},
			{
				displayName: 'Search Type',
				name: 'searchType',
				type: 'options',
				default: 'free_text',
				description:
					'How TikTok should interpret the search query. Free text is best for broad research; Advertiser narrows to one brand.',
				options: [
					{ name: 'Advertiser', value: 'advertiser' },
					{ name: 'Exact Phrase', value: 'exact_phrase' },
					{ name: 'Free Text', value: 'free_text' },
					{ name: 'Keyword', value: 'keyword' },
				],
				displayOptions: { show: { operation: operationsWith('searchType') } },
			},
			{
				displayName: 'Country',
				name: 'adsRegion',
				type: 'string',
				default: 'GB',
				placeholder: 'GB',
				description:
					'Two-letter country code selecting which public Ads Library market to search, such as GB, DE, FR, or ES',
				displayOptions: { show: { operation: operationsWith('adsRegion') } },
			},
			{
				displayName: 'Sort Ads',
				name: 'adsSort',
				type: 'options',
				default: 'last_shown_desc',
				description: 'Whether newest, oldest or highest-impression ads appear first',
				options: [
					{ name: 'Impressions: Highest First', value: 'impressions_desc' },
					{ name: 'Impressions: Lowest First', value: 'impressions_asc' },
					{ name: 'Last Shown: Newest First', value: 'last_shown_desc' },
					{ name: 'Last Shown: Oldest First', value: 'last_shown_asc' },
					{ name: 'Published: Newest First', value: 'published_desc' },
					{ name: 'Published: Oldest First', value: 'published_asc' },
				],
				displayOptions: { show: { operation: operationsWith('adsSort') } },
			},
			{
				displayName: 'Brand or Product Keyword',
				name: 'keyword',
				type: 'string',
				default: 'skincare',
				required: true,
				placeholder: 'skincare',
				description: 'Brand, product or topic to search for in the Top Ads chart',
				displayOptions: { show: { operation: operationsWith('keyword') } },
			},
			{
				displayName: 'Top Ad Material IDs',
				name: 'materialIds',
				type: 'string',
				typeOptions: { rows: 3 },
				default: '',
				required: true,
				placeholder: '7631262985109602311',
				description:
					'One numeric Top Ad material ID per line — the number shown in a Creative Center Top Ad URL after /topads/. Commas are also accepted as a separator.',
				displayOptions: { show: { operation: operationsWith('materialIds') } },
			},
			{
				displayName: 'Countries',
				name: 'countryCodes',
				type: 'multiOptions',
				default: ['US'],
				required: true,
				description: 'Markets to search, and to use when finding similar creatives',
				options: COUNTRY_OPTIONS,
				displayOptions: { show: { operation: operationsWith('countryCodes') } },
			},
			{
				displayName: 'Ranking Period',
				name: 'period',
				type: 'options',
				default: '30',
				description: 'Compare ads shown during the last 7, 30 or 180 days',
				options: PERIOD_OPTIONS,
				displayOptions: { show: { operation: operationsWith('period') } },
			},
			{
				displayName: 'Rank By',
				name: 'topAdsSort',
				type: 'options',
				default: 'for_you',
				description: "Order ads by TikTok's recommendations or by a performance metric",
				options: [
					{ name: '2-Second View Rate', value: 'two_second_view_rate' },
					{ name: '6-Second View Rate', value: 'six_second_view_rate' },
					{ name: 'CTR', value: 'ctr' },
					{ name: 'CVR', value: 'cvr' },
					{ name: 'Likes', value: 'likes' },
					{ name: 'Reach', value: 'reach' },
					{ name: 'Recommended', value: 'for_you' },
				],
				displayOptions: { show: { operation: operationsWith('topAdsSort') } },
			},
			{
				displayName: 'TikTok URL',
				name: 'startUrl',
				type: 'string',
				default: '',
				placeholder: 'https://library.tiktok.com/ads?region=GB',
				description:
					'Optional shortcut: paste a public Ads Library or Creative Center URL and the node reads its filters from it, overriding the fields above',
				displayOptions: { show: { operation: operationsWith('startUrl') } },
			},
			// ---------------------------------------------------------------
			// Download settings
			// ---------------------------------------------------------------
			{
				displayName: 'Video Quality',
				name: 'quality',
				type: 'options',
				default: 'best',
				description: 'Maximum resolution to download',
				options: [
					{ name: '1080p Full HD', value: '1080p' },
					{ name: '360p Low', value: '360p' },
					{ name: '480p SD', value: '480p' },
					{ name: '720p HD', value: '720p' },
					{ name: 'Best Available', value: 'best' },
					{ name: 'Lowest Available', value: 'worst' },
				],
				displayOptions: { show: { operation: operationsWith('quality') } },
			},
			{
				displayName: 'Output Format',
				name: 'format',
				type: 'options',
				default: 'mp4',
				description:
					'Container format for the downloaded file. MP4 is the safest choice and plays on every device.',
				options: [
					{ name: 'MKV', value: 'mkv' },
					{ name: 'MP4', value: 'mp4' },
					{ name: 'WebM', value: 'webm' },
				],
				displayOptions: { show: { operation: operationsWith('format') } },
			},
			{
				displayName: 'Download File to Binary',
				name: 'downloadToBinary',
				type: 'boolean',
				default: true,
				description:
					'Whether to download the saved video from Apify and attach it as binary data on the output item, ready to chain into Google Drive, S3, Telegram and similar nodes',
				displayOptions: { show: { operation: FILE_OPERATIONS } },
			},
			{
				displayName: 'Put Output File in Field',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				description: 'Name of the binary property to write the downloaded file to',
				displayOptions: { show: { operation: FILE_OPERATIONS, downloadToBinary: [true] } },
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
			// Enrichment and analysis
			// ---------------------------------------------------------------
			{
				displayName: 'Add Full Ad Details',
				name: 'enrichAdDetails',
				type: 'boolean',
				default: false,
				description:
					'Whether to make one extra request per saved ad for advertiser information, targeting, reach and campaign objective',
				displayOptions: { show: { operation: operationsWith('enrichAdDetails') } },
			},
			{
				displayName: 'Add Advertiser Activity Report',
				name: 'includeAdvertiserReport',
				type: 'boolean',
				default: false,
				description:
					'Whether to save one report with regional ad distribution and daily publication counts. Only applies to Advertiser searches.',
				displayOptions: {
					show: {
						operation: operationsWith('includeAdvertiserReport'),
						searchType: ['advertiser'],
					},
				},
			},
			{
				displayName: 'Add Full Details to Discovered Ads',
				name: 'enrichTopAdDetails',
				type: 'boolean',
				default: false,
				description:
					'Whether to make one extra request per saved ad for its caption, brand, markets and industry',
				displayOptions: { show: { operation: operationsWith('enrichTopAdDetails') } },
			},
			{
				displayName: 'Find Similar Creatives',
				name: 'includeRelatedAds',
				type: 'boolean',
				default: false,
				description:
					'Whether to save similar Top Ads for each ad you inspect. One recommendation request per ad.',
				displayOptions: { show: { operation: operationsWith('includeRelatedAds') } },
			},
			{
				displayName: 'Max Related Creatives',
				name: 'maxRelatedItems',
				type: 'number',
				default: 5,
				typeOptions: { minValue: 1, maxValue: 20 },
				description: 'Maximum number of similar ads to save for each input ad, between 1 and 20',
				displayOptions: {
					show: { operation: operationsWith('maxRelatedItems'), includeRelatedAds: [true] },
				},
			},
			{
				displayName: 'Add per-Second Video Performance',
				name: 'includeVideoTimeline',
				type: 'boolean',
				default: false,
				description:
					'Whether to fetch how the selected metric changes second by second for every eligible video, and identify highlighted moments',
				displayOptions: { show: { operation: operationsWith('includeVideoTimeline') } },
			},
			{
				displayName: 'Timeline Metric',
				name: 'timelineMetric',
				type: 'options',
				default: 'retain_ctr',
				description: 'Which signal is plotted across the video',
				options: METRIC_OPTIONS,
				displayOptions: {
					show: { operation: operationsWith('timelineMetric'), includeVideoTimeline: [true] },
				},
			},
			{
				displayName: 'Add Performance Benchmark',
				name: 'includePercentile',
				type: 'boolean',
				default: false,
				description:
					'Whether to compare every eligible ad with other Top Ads for the selected metric and period',
				displayOptions: { show: { operation: operationsWith('includePercentile') } },
			},
			{
				displayName: 'Percentile Metric',
				name: 'percentileMetric',
				type: 'options',
				default: 'retain_ctr',
				description: 'Which signal is used to compare this ad with other Top Ads',
				options: METRIC_OPTIONS,
				displayOptions: {
					show: { operation: operationsWith('percentileMetric'), includePercentile: [true] },
				},
			},
			{
				displayName: 'Percentile Period',
				name: 'percentilePeriod',
				type: 'options',
				default: '180',
				description: 'Whether the benchmark compares the last 7, 30 or 180 days',
				options: PERIOD_OPTIONS,
				displayOptions: {
					show: { operation: operationsWith('percentilePeriod'), includePercentile: [true] },
				},
			},
			// ---------------------------------------------------------------
			// Collections
			// ---------------------------------------------------------------
			{
				displayName: 'Ads Library Filters',
				name: 'adsFilters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				displayOptions: { show: { operation: ['adsLibrary'] } },
				options: [
					{
						displayName: 'Advertiser ID',
						name: 'advertiserId',
						type: 'string',
						default: '',
						description:
							'Numeric advertiser ID for Advertiser searches. Leave it empty to let the Actor find a unique exact match.',
					},
					{
						displayName: 'End Date',
						name: 'endTime',
						type: 'string',
						default: '',
						placeholder: 'YYYY-MM-DD',
						description: 'Newest ad activity date to include. Leave empty to use today.',
					},
					{
						displayName: 'Start Date',
						name: 'startTime',
						type: 'string',
						default: '',
						placeholder: 'YYYY-MM-DD',
						description:
							'Oldest ad activity date to include. Leave empty to search the 30 days before the end date.',
					},
				],
			},
			{
				displayName: 'Top Ads Filters',
				name: 'rankedFilters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				displayOptions: { show: { operation: ['topAdsRanked'] } },
				options: [
					{
						displayName: 'Ad Format',
						name: 'adFormat',
						type: 'options',
						default: '',
						description: 'Whether to return Spark Ads, non-Spark Ads, or both',
						options: [
							{ name: 'Both', value: '' },
							{ name: 'Non-Spark Ads', value: 'non_spark' },
							{ name: 'Spark Ads', value: 'spark' },
						],
					},
					{
						displayName: 'Ad Language',
						name: 'adLanguage',
						type: 'string',
						default: '',
						placeholder: 'en',
						description:
							'Language spoken or written in ranked ads, such as en, fr, or de. This filters creatives, not markets.',
					},
					{
						displayName: 'Industry IDs',
						name: 'industryIds',
						type: 'string',
						default: '',
						description:
							'Comma-separated Creative Center industry IDs. The easiest way to get these is to paste a dashboard URL into TikTok URL instead.',
					},
					{
						displayName: 'Likes Percentile',
						name: 'likesPercentile',
						type: 'options',
						default: '',
						description: 'Keep one likes-ranking group. Top 1-20% contains the most-liked ads.',
						options: [
							{ name: 'Any', value: '' },
							{ name: 'Top 1-20%', value: 'top_1_20' },
							{ name: 'Top 21-40%', value: 'top_21_40' },
							{ name: 'Top 41-60%', value: 'top_41_60' },
							{ name: 'Top 61-80%', value: 'top_61_80' },
							{ name: 'Top 81-100%', value: 'top_81_100' },
						],
					},
					{
						displayName: 'Objective IDs',
						name: 'objectiveIds',
						type: 'string',
						default: '',
						description:
							'Comma-separated campaign-objective IDs, such as 1 for Traffic or 3 for Conversions',
					},
				],
			},
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
							'Memory to allocate to the Actor run. Higher memory can shorten a large run at a higher cost per minute.',
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
						displayName: 'Delay Between Downloads (Ms)',
						name: 'sleepBetweenDownloads',
						type: 'number',
						default: 2000,
						typeOptions: { minValue: 0, maxValue: 30000 },
						description:
							'How long to wait between each URL. TikTok rate-limits aggressive downloaders, so raise this when downloading many videos at once.',
						displayOptions: { show: { '/operation': operationsWith('sleepBetweenDownloads') } },
					},
					{
						displayName: 'Poll Timeout (Minutes)',
						name: 'pollTimeoutMinutes',
						type: 'number',
						default: 10,
						description:
							"Maximum time for this node to wait for the Actor run to finish before it stops polling and throws a timeout error. The run keeps executing on Apify's side even after this node gives up waiting for it.",
					},
					{
						displayName: 'Proxy Group',
						name: 'proxyGroup',
						type: 'options',
						default: '',
						description:
							"Which Apify proxy group to route requests through. Automatic leaves the choice to the Actor's own default.",
						options: [
							{ name: 'Automatic', value: '' },
							{ name: 'Residential', value: 'RESIDENTIAL' },
						],
						displayOptions: { show: { '/operation': operationsWith('proxyGroup') } },
					},
					{
						displayName: 'Session Cookies',
						name: 'cookies',
						type: 'string',
						typeOptions: { password: true },
						default: '',
						description:
							"Your TikTok session cookies in Netscape cookie-file format. Only needed if a download fails with a 'login required' error.",
						displayOptions: { show: { '/operation': operationsWith('cookies') } },
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

				const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject & {
					memoryMbytes?: number;
					pollTimeoutMinutes?: number;
				};

				// Only the parameters this operation declares are read, so a field
				// hidden for the current operation never reaches the Actor input.
				const values: OperationValues = {};
				for (const field of spec.fields) {
					const collectionName = COLLECTION_FIELDS[field];

					if (field === 'maxItems') {
						values.returnAll = this.getNodeParameter('returnAll', itemIndex, false) as boolean;
						values.limit = this.getNodeParameter('limit', itemIndex, 50) as number;
					} else if (collectionName === 'options') {
						values[field] = options[field] ?? '';
					} else if (collectionName) {
						const collection = this.getNodeParameter(collectionName, itemIndex, {}) as IDataObject;
						values[field] = collection[field] ?? '';
					} else {
						values[field] = this.getNodeParameter(field, itemIndex, undefined);
					}
				}

				// The delay lives in the shared Options collection, but reaches the
				// Actor as an ordinary input field.
				if (spec.fields.includes('sleepBetweenDownloads')) {
					values.sleepBetweenDownloads = (options.sleepBetweenDownloads as number) ?? 2000;
				}

				let plan;
				try {
					plan = buildRunPlan(operation, values);
				} catch (error) {
					throw new NodeOperationError(this.getNode(), (error as Error).message, { itemIndex });
				}

				const actorSlug = toApifyActorSlug(plan.actor);
				const memoryMbytes = options.memoryMbytes ?? 0;
				const pollTimeoutMinutes =
					options.pollTimeoutMinutes && options.pollTimeoutMinutes > 0
						? options.pollTimeoutMinutes
						: 10;

				const downloadToBinary = spec.producesFiles
					? (this.getNodeParameter('downloadToBinary', itemIndex, true) as boolean)
					: false;
				const binaryPropertyName = this.getNodeParameter(
					'binaryPropertyName',
					itemIndex,
					'data',
				) as string;

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
						`TikTok: run ${runId} finished successfully but returned no items. Private, deleted and region-blocked targets come back empty; check ${consoleRunUrl} for the run log.`,
					);
				}

				for (const item of datasetItems) {
					const outputJson: IDataObject = { ...item };
					const outputItem: INodeExecutionData = {
						json: outputJson,
						pairedItem: { item: itemIndex },
					};

					// The downloader Actor reports its saved file as flat fields on the
					// row — `downloadUrl` pointing at a key-value store record, plus
					// `key`, `contentType` and `format` — rather than nesting them
					// under a `savedFile` object.
					const downloadUrl = item.downloadUrl as string | undefined;

					if (downloadToBinary && downloadUrl) {
						try {
							const fileResponse = (await this.helpers.httpRequestWithAuthentication.call(
								this,
								'apifyApi',
								{
									method: 'GET',
									url: downloadUrl,
									encoding: 'arraybuffer',
									returnFullResponse: true,
								},
							)) as IN8nHttpFullResponse;

							const buffer = Buffer.isBuffer(fileResponse.body)
								? fileResponse.body
								: Buffer.from(fileResponse.body as unknown as ArrayBuffer);

							outputItem.binary = {
								[binaryPropertyName]: await this.helpers.prepareBinaryData(
									buffer,
									buildDownloadFileName(item),
									(item.contentType as string) ?? undefined,
								),
							};
						} catch (error) {
							this.logger.warn(
								`TikTok: failed to download the saved file for an item, emitting metadata without binary data. ${(error as Error).message}`,
							);
							outputJson.binaryDownloadError = (error as Error).message;
						}
					} else if (downloadToBinary) {
						outputJson.binaryDownloadSkippedReason =
							item.status === 'success'
								? 'This item reports a successful download but carries no downloadUrl.'
								: `The Actor did not save a file for this URL (status: ${String(item.status ?? 'unknown')}).`;
					}

					returnData.push(outputItem);
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
