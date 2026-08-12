import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestOptions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError, sleep } from 'n8n-workflow';

import { isTerminalRunStatus, toApifyActorSlug } from './helpers';
import { buildRunPlan, OPERATIONS, type OperationField, type OperationValues } from './operations';

const APIFY_API_BASE = 'https://api.apify.com/v2';

/**
 * Fields collected from the shared Options collection rather than from a
 * top-level property, so the node panel stays short for the common case.
 */
const OPTION_FIELDS = new Set<OperationField>(['regionCode', 'languageCode', 'resumeCursor']);

/**
 * Operations whose backing Actor accepts a given field. Derived from the
 * registry rather than hand-listed so the UI cannot drift out of step with the
 * Actor mapping when an operation is added or its schema changes.
 */
function operationsWith(field: OperationField): string[] {
	return Object.keys(OPERATIONS).filter((name) => OPERATIONS[name].fields.includes(field));
}

const MAX_ITEMS_OPERATIONS = operationsWith('maxItems');

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

export class YouTubeScraper implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'YouTube Scraper',
		name: 'youTubeScraper',
		icon: { light: 'file:youTubeScraper.svg', dark: 'file:youTubeScraper.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description:
			'Scrape YouTube videos, channels, playlists, comments, transcripts and search via Apify Actors',
		defaults: {
			name: 'YouTube Scraper',
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
						name: 'Channel',
						value: 'channel',
						description: 'Read a channel profile and its sections',
					},
					{
						name: 'Playlist',
						value: 'playlist',
						description: 'Read the videos in a playlist',
					},
					{
						name: 'Search',
						value: 'search',
						description: 'Search YouTube, or read its trending and discovery feeds',
					},
					{
						name: 'Video',
						value: 'video',
						description: 'Read video details, comments and transcripts',
					},
				],
				default: 'video',
			},
			// ---------------------------------------------------------------
			// Operations, one property per resource
			// ---------------------------------------------------------------
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['video'] } },
				options: [
					{
						name: 'Get Comments',
						value: 'videoComments',
						description: 'List the comments on videos, Shorts or community posts',
						action: 'Get comments for a video',
					},
					{
						name: 'Get Details',
						value: 'videoDetails',
						description: 'Fetch title, views, likes, channel and metadata for videos',
						action: 'Get video details',
					},
					{
						name: 'Get Extended Details',
						value: 'videoExtendedDetails',
						description: 'Fetch details plus related videos, transcript and captions',
						action: 'Get extended video details',
					},
					{
						name: 'Get Transcript',
						value: 'videoTranscript',
						description: 'Fetch timed transcript segments and optional subtitle files',
						action: 'Get a transcript for a video',
					},
				],
				default: 'videoDetails',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['channel'] } },
				options: [
					{
						name: 'Get Channel',
						value: 'channelGet',
						description: 'Read a channel profile and the sections you choose',
						action: 'Get a channel',
					},
				],
				default: 'channelGet',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['playlist'] } },
				options: [
					{
						name: 'Get Playlist',
						value: 'playlistGet',
						description: 'List the videos in a playlist',
						action: 'Get a playlist',
					},
				],
				default: 'playlistGet',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['search'] } },
				options: [
					{
						name: 'Get Home Feed',
						value: 'searchHome',
						description: 'Read the YouTube home feed for a country',
						action: 'Get the home feed',
					},
					{
						name: 'Get Hype',
						value: 'searchHype',
						description: 'Read the Hype chart of rising videos',
						action: 'Get hype videos',
					},
					{
						name: 'Get Search Suggestions',
						value: 'searchSuggestions',
						description: 'Read the autocomplete suggestions for a partial query',
						action: 'Get search suggestions',
					},
					{
						name: 'Get Trending',
						value: 'searchTrending',
						description: 'Read the trending, music or games chart for a country',
						action: 'Get trending videos',
					},
					{
						name: 'Search',
						value: 'searchVideos',
						description: 'Search YouTube by keyword, with type and date filters',
						action: 'Search videos',
					},
					{
						name: 'Search by Hashtag',
						value: 'searchHashtag',
						description: 'Read the video or Shorts feed for a hashtag',
						action: 'Search by hashtag',
					},
				],
				default: 'searchVideos',
			},
			// ---------------------------------------------------------------
			// Targets
			// ---------------------------------------------------------------
			{
				displayName: 'Videos',
				name: 'videoIds',
				type: 'string',
				typeOptions: { rows: 4 },
				default: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
				required: true,
				placeholder: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
				description:
					'One YouTube video URL or 11-character video ID per line. Commas are also accepted as a separator.',
				displayOptions: { show: { operation: operationsWith('videoIds') } },
			},
			{
				displayName: 'Videos',
				name: 'videoSources',
				type: 'string',
				typeOptions: { rows: 4 },
				default: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
				required: true,
				placeholder: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
				description:
					'One YouTube video or Shorts URL (or an 11-character video ID) per line. Commas are also accepted as a separator.',
				displayOptions: { show: { operation: operationsWith('videoSources') } },
			},
			{
				displayName: 'Videos or Posts',
				name: 'commentSources',
				type: 'string',
				typeOptions: { rows: 4 },
				default: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
				required: true,
				placeholder: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
				description:
					'One video, Shorts or community-post URL or ID per line, whose comments should be collected. Commas are also accepted as a separator.',
				displayOptions: { show: { operation: operationsWith('commentSources') } },
			},
			{
				displayName: 'Channels',
				name: 'channelSources',
				type: 'string',
				typeOptions: { rows: 4 },
				default: 'https://www.youtube.com/@TED',
				required: true,
				placeholder: 'https://www.youtube.com/@TED',
				description:
					'One channel per line. Full URLs, @handles, usernames and UC channel IDs are all accepted, and commas work as a separator.',
				displayOptions: { show: { operation: operationsWith('channelSources') } },
			},
			{
				displayName: 'Playlists',
				name: 'playlistSources',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
				required: true,
				placeholder: 'https://www.youtube.com/playlist?list=PLMC9KNkIncKtPzgY-5rmhvj7fax8fdxoj',
				description:
					'One playlist URL or playlist ID per line. Commas are also accepted as a separator.',
				displayOptions: { show: { operation: operationsWith('playlistSources') } },
			},
			{
				displayName: 'Search Query',
				name: 'searchTerm',
				type: 'string',
				default: 'indoor herb garden',
				required: true,
				placeholder: 'indoor herb garden',
				description:
					'Words or a phrase to search for. Search Suggestions also accepts a partial phrase.',
				displayOptions: { show: { operation: operationsWith('searchTerm') } },
			},
			{
				displayName: 'Hashtag',
				name: 'hashtag',
				type: 'string',
				default: 'urbanphotography',
				required: true,
				placeholder: 'urbanphotography',
				description: 'Hashtag text without the # symbol',
				displayOptions: { show: { operation: operationsWith('hashtag') } },
			},
			// ---------------------------------------------------------------
			// Channel sections
			// ---------------------------------------------------------------
			{
				displayName: 'Channel Content',
				name: 'channelSections',
				type: 'multiOptions',
				default: ['about', 'videos'],
				required: true,
				description:
					'Which channel sections to collect. Channel details produces one profile record per channel.',
				options: [
					{ name: 'Channel Details', value: 'about' },
					{ name: 'Community Posts', value: 'community_posts' },
					{ name: 'Home Sections', value: 'home_sections' },
					{ name: 'Live Streams', value: 'live_streams' },
					{ name: 'Playlists', value: 'playlists' },
					{ name: 'Search Within Channel', value: 'search_results' },
					{ name: 'Shorts', value: 'shorts' },
					{ name: 'Store Products', value: 'store_products' },
					{ name: 'Videos', value: 'videos' },
				],
				displayOptions: { show: { operation: operationsWith('channelSections') } },
			},
			{
				displayName: 'Search Within Channel',
				name: 'channelSearchTerm',
				type: 'string',
				default: '',
				placeholder: 'climate',
				description:
					'Words or a phrase to find inside the channel. Only used when Search Within Channel is one of the selected sections.',
				displayOptions: {
					show: {
						operation: operationsWith('channelSearchTerm'),
						channelSections: ['search_results'],
					},
				},
			},
			// ---------------------------------------------------------------
			// Search filters
			// ---------------------------------------------------------------
			{
				displayName: 'Result Type',
				name: 'resultKind',
				type: 'options',
				default: '',
				description: 'Limit results to one public content type',
				options: [
					{ name: 'Any', value: '' },
					{ name: 'Channels', value: 'channel' },
					{ name: 'Movies', value: 'movie' },
					{ name: 'Playlists', value: 'playlist' },
					{ name: 'Shorts', value: 'shorts' },
					{ name: 'Videos', value: 'video' },
				],
				displayOptions: { show: { operation: operationsWith('resultKind') } },
			},
			{
				displayName: 'Video Duration',
				name: 'lengthFilter',
				type: 'options',
				default: '',
				description: 'Keep videos within one duration range',
				options: [
					{ name: 'Any', value: '' },
					{ name: '3-20 Minutes', value: 'between_3_and_20_minutes' },
					{ name: 'Over 20 Minutes', value: 'over_20_minutes' },
					{ name: 'Under 3 Minutes', value: 'under_3_minutes' },
				],
				displayOptions: { show: { operation: operationsWith('lengthFilter') } },
			},
			{
				displayName: 'Published Within',
				name: 'publishedWithin',
				type: 'options',
				default: '',
				description: 'Restrict results by upload period',
				options: [
					{ name: 'Any Time', value: '' },
					{ name: 'Past Month', value: 'month' },
					{ name: 'Past Week', value: 'week' },
					{ name: 'Past Year', value: 'year' },
					{ name: 'Today', value: 'today' },
				],
				displayOptions: { show: { operation: operationsWith('publishedWithin') } },
			},
			{
				displayName: 'Result Order',
				name: 'sortOrder',
				type: 'options',
				default: '',
				description: 'Order the returned search results',
				options: [
					{ name: 'Default', value: '' },
					{ name: 'Newest', value: 'newest' },
					{ name: 'Popularity', value: 'popularity' },
					{ name: 'Relevance', value: 'relevance' },
					{ name: 'Top', value: 'top' },
				],
				displayOptions: { show: { operation: ['searchVideos'] } },
			},
			{
				displayName: 'Result Order',
				name: 'sortOrder',
				type: 'options',
				default: '',
				description: 'Order the returned comments',
				options: [
					{ name: 'Default', value: '' },
					{ name: 'Newest Comments', value: 'newest' },
					{ name: 'Top Comments', value: 'top' },
				],
				displayOptions: { show: { operation: ['videoComments'] } },
			},
			{
				displayName: 'Hashtag Content',
				name: 'contentKind',
				type: 'options',
				default: 'all',
				description: "Whether to read the hashtag's video feed or its Shorts feed",
				options: [
					{ name: 'Shorts', value: 'shorts' },
					{ name: 'Videos', value: 'all' },
				],
				displayOptions: { show: { operation: operationsWith('contentKind') } },
			},
			{
				displayName: 'Trending Category',
				name: 'trendCategory',
				type: 'options',
				default: 'now',
				description: 'Which regional chart to collect',
				options: [
					{ name: 'Games', value: 'games' },
					{ name: 'Music', value: 'music' },
					{ name: 'Trending Now', value: 'now' },
				],
				displayOptions: { show: { operation: operationsWith('trendCategory') } },
			},
			{
				displayName: 'Content Type',
				name: 'videoKind',
				type: 'options',
				default: 'auto',
				description: 'Whether to treat the inputs as regular videos, Shorts, or detect each one',
				options: [
					{ name: 'Detect Automatically', value: 'auto' },
					{ name: 'Shorts', value: 'shorts' },
					{ name: 'Videos', value: 'video' },
				],
				displayOptions: { show: { operation: operationsWith('videoKind') } },
			},
			// ---------------------------------------------------------------
			// Enrichment
			// ---------------------------------------------------------------
			{
				displayName: 'Add Related Content',
				name: 'includeRelatedContent',
				type: 'boolean',
				default: false,
				description:
					'Whether to attach related videos and playlists to every eligible result. One request per page of related items, charged only when it succeeds.',
				displayOptions: { show: { operation: operationsWith('includeRelatedContent') } },
			},
			{
				displayName: 'Add Shorts Using the Same Sound',
				name: 'includeSoundShorts',
				type: 'boolean',
				default: false,
				description:
					'Whether to attach other Shorts using the same sound, for Shorts inputs. One request per page, charged only when it succeeds.',
				displayOptions: { show: { operation: operationsWith('includeSoundShorts') } },
			},
			{
				displayName: 'Max Related Results',
				name: 'maxRelatedItems',
				type: 'number',
				default: 20,
				typeOptions: { minValue: 0 },
				description:
					'Maximum related or same-sound items attached to each video. Set 0 to collect all available pages.',
				displayOptions: {
					show: {
						operation: operationsWith('maxRelatedItems'),
					},
				},
			},
			{
				displayName: 'Add Full Video Details',
				name: 'includeVideoDetails',
				type: 'boolean',
				default: false,
				description:
					'Whether to attach a separate full video-detail record to every eligible playlist item. One extra request per item, charged only when it succeeds.',
				displayOptions: { show: { operation: operationsWith('includeVideoDetails') } },
			},
			{
				displayName: 'Add Parent Content Details',
				name: 'includeParentDetails',
				type: 'boolean',
				default: false,
				description:
					'Whether to attach the video, Shorts or community-post details to comments from the same target. One extra request per target.',
				displayOptions: { show: { operation: operationsWith('includeParentDetails') } },
			},
			{
				displayName: 'Community Post Channel ID',
				name: 'ownerChannel',
				type: 'string',
				default: '',
				placeholder: 'UCsT0YIqwnpJCM-mx7-gSA4Q',
				description:
					'Channel ID that owns a community post. Only needed when you provide a bare post ID rather than a full URL.',
				displayOptions: { show: { operation: operationsWith('ownerChannel') } },
			},
			{
				displayName: 'Add Transcript',
				name: 'includeTranscript',
				type: 'boolean',
				default: false,
				description:
					'Whether to attach timed transcript segments when a transcript is available. One extra request per video, charged only when a transcript is returned.',
				displayOptions: { show: { operation: operationsWith('includeTranscript') } },
			},
			{
				displayName: 'Add Caption Text',
				name: 'includeCaption',
				type: 'boolean',
				default: false,
				description:
					'Whether to attach one caption track in the selected language when available. Two extra requests per video, charged only when the track is returned.',
				displayOptions: { show: { operation: operationsWith('includeCaption') } },
			},
			{
				displayName: 'Caption Language',
				name: 'captionLanguage',
				type: 'string',
				default: 'en',
				placeholder: 'en',
				description: 'Language code of the caption track to attach, such as en, es, or pt-BR',
				displayOptions: {
					show: { operation: operationsWith('captionLanguage'), includeCaption: [true] },
				},
			},
			{
				displayName: 'Transcript Language',
				name: 'transcriptLanguage',
				type: 'string',
				default: '',
				placeholder: 'en',
				description:
					'Language code of the transcript to request, such as en, de, or ja. YouTube serves whichever track it has, so leave it empty to take the default.',
				displayOptions: { show: { operation: operationsWith('transcriptLanguage') } },
			},
			{
				displayName: 'Add Subtitle File',
				name: 'includeSubtitleFile',
				type: 'boolean',
				default: false,
				description:
					'Whether to attach the caption track as a ready-to-use subtitle file alongside the transcript. Two extra requests per video.',
				displayOptions: { show: { operation: operationsWith('includeSubtitleFile') } },
			},
			{
				displayName: 'Subtitle Format',
				name: 'captionFormat',
				type: 'options',
				default: 'vtt',
				description: 'File format for the attached subtitle track',
				options: [
					{ name: 'SubRip (.srt)', value: 'srt' },
					{ name: 'WebVTT (.vtt)', value: 'vtt' },
				],
				displayOptions: {
					show: { operation: operationsWith('captionFormat'), includeSubtitleFile: [true] },
				},
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
						displayName: 'Country',
						name: 'regionCode',
						type: 'string',
						default: 'US',
						placeholder: 'US',
						description: 'Two-letter country code used to localize results, such as US, IN, or DE',
						displayOptions: { show: { '/operation': operationsWith('regionCode') } },
					},
					{
						displayName: 'Language',
						name: 'languageCode',
						type: 'string',
						default: 'en',
						placeholder: 'en',
						description: 'Language code used to localize result text, such as en, es, or pt-BR',
						displayOptions: { show: { '/operation': operationsWith('languageCode') } },
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
						displayName: 'Resume From',
						name: 'resumeCursor',
						type: 'string',
						default: '',
						description:
							"Continue a previous run instead of starting again. Paste the resume token printed near the end of that run's log.",
						displayOptions: { show: { '/operation': operationsWith('resumeCursor') } },
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
					if (field === 'maxItems') {
						values.returnAll = this.getNodeParameter('returnAll', itemIndex, false) as boolean;
						values.limit = this.getNodeParameter('limit', itemIndex, 50) as number;
					} else if (OPTION_FIELDS.has(field)) {
						values[field] = options[field] ?? '';
					} else {
						values[field] = this.getNodeParameter(field, itemIndex, undefined);
					}
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
						`YouTube Scraper: run ${runId} finished successfully but returned no items. Private, age-restricted and region-blocked targets come back empty; check ${consoleRunUrl} for the run log.`,
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
