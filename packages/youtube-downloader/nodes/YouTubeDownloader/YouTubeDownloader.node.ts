import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestOptions,
	IN8nHttpFullResponse,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError, sleep } from 'n8n-workflow';

import {
	isTerminalRunStatus,
	normalizeRegion,
	normalizeSubtitleLanguage,
	parseUrlsInput,
	toApifyActorSlug,
} from './helpers';

/**
 * Apify Actor IDs backing this node.
 * https://apify.com/thenetaji/youtube-video-downloader
 * https://apify.com/thenetaji/youtube-music-downloader
 */
export const VIDEO_DOWNLOADER_ACTOR_ID = 'thenetaji/youtube-video-downloader';
export const MUSIC_DOWNLOADER_ACTOR_ID = 'thenetaji/youtube-music-downloader';

const APIFY_API_BASE = 'https://api.apify.com/v2';

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

export class YouTubeDownloader implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'YouTube Downloader',
		name: 'youTubeDownloader',
		icon: { light: 'file:youtubeDownloader.svg', dark: 'file:youtubeDownloader.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Download YouTube videos and music via the Apify YouTube Downloader Actors',
		defaults: {
			name: 'YouTube Downloader',
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
						name: 'Video',
						value: 'video',
						description: 'Download a YouTube video',
					},
					{
						name: 'Music',
						value: 'music',
						description: 'Download YouTube Music / audio',
					},
				],
				default: 'video',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['video'],
					},
				},
				options: [
					{
						name: 'Download Video',
						value: 'downloadVideo',
						description: 'Run the YouTube Video Downloader Actor',
						action: 'Download a video',
					},
				],
				default: 'downloadVideo',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['music'],
					},
				},
				options: [
					{
						name: 'Download Music',
						value: 'downloadMusic',
						description: 'Run the YouTube Music Downloader Actor',
						action: 'Download music',
					},
				],
				default: 'downloadMusic',
			},
			// ---------------------------------------------------------------
			// urls
			// ---------------------------------------------------------------
			{
				displayName: 'YouTube URLs',
				name: 'urls',
				type: 'string',
				typeOptions: { rows: 4 },
				default: 'https://www.youtube.com/watch?v=arj7oStGLkU',
				required: true,
				placeholder: 'https://www.youtube.com/watch?v=arj7oStGLkU',
				description:
					'One YouTube video, Shorts, or Music URL (or an 11-character video ID) per line. Commas are also accepted as a separator between entries.',
				displayOptions: {
					show: {
						resource: ['video'],
					},
				},
			},
			{
				displayName: 'YouTube Music URLs',
				name: 'urls',
				type: 'string',
				typeOptions: { rows: 4 },
				default: 'https://music.youtube.com/watch?v=arj7oStGLkU',
				required: true,
				placeholder: 'https://music.youtube.com/watch?v=arj7oStGLkU',
				description:
					'One YouTube Music or YouTube video URL (or an 11-character video ID) per line. Commas are also accepted as a separator between entries.',
				displayOptions: {
					show: {
						resource: ['music'],
					},
				},
			},
			// ---------------------------------------------------------------
			// region
			// ---------------------------------------------------------------
			{
				displayName: 'Access Country',
				name: 'region',
				type: 'string',
				default: 'US',
				required: true,
				placeholder: 'US',
				description:
					'2-letter country code used to access the video, such as US or DE. It is automatically uppercased before being sent to the Actor.',
				displayOptions: {
					show: {
						resource: ['video'],
					},
				},
			},
			{
				displayName: 'Download Country',
				name: 'region',
				type: 'string',
				default: 'US',
				required: true,
				placeholder: 'US',
				description:
					'2-letter country code used to retrieve the saved audio file, such as US or DE. It is automatically uppercased before being sent to the Actor.',
				displayOptions: {
					show: {
						resource: ['music'],
					},
				},
			},
			// ---------------------------------------------------------------
			// video-only: saveMedia, quality, format
			// ---------------------------------------------------------------
			{
				displayName: 'Save Playable Files',
				name: 'saveMedia',
				type: 'boolean',
				default: false,
				description:
					'Whether to create one playable file for each video and return its download URL. Saved files are billed per MB, and only after a successful transfer.',
				displayOptions: {
					show: {
						resource: ['video'],
					},
				},
			},
			{
				displayName: 'Maximum Quality',
				name: 'quality',
				type: 'options',
				default: 'best',
				description:
					'Maximum resolution to save. Only takes effect when Save Playable Files is enabled.',
				options: [
					{ name: '144p', value: '144' },
					{ name: '240p', value: '240' },
					{ name: '360p', value: '360' },
					{ name: '480p', value: '480' },
					{ name: '720p HD', value: '720' },
					{ name: '1080p Full HD', value: '1080' },
					{ name: '1440p', value: '1440' },
					{ name: '2160p 4K', value: '2160' },
					{ name: '4320p 8K', value: '4320' },
					{ name: 'Best Available', value: 'best' },
				],
				displayOptions: {
					show: {
						resource: ['video'],
						saveMedia: [true],
					},
				},
			},
			{
				displayName: 'File Format',
				name: 'format',
				type: 'options',
				default: 'default',
				description:
					'Container format for the saved file. Only takes effect when Save Playable Files is enabled.',
				options: [
					{ name: 'Default (MP4)', value: 'default' },
					{ name: 'MP4', value: 'mp4' },
					{ name: 'WebM', value: 'webm' },
					{ name: 'MKV', value: 'mkv' },
				],
				displayOptions: {
					show: {
						resource: ['video'],
						saveMedia: [true],
					},
				},
			},
			// ---------------------------------------------------------------
			// music-only: audioFormat
			// ---------------------------------------------------------------
			{
				displayName: 'Audio Format',
				name: 'audioFormat',
				type: 'options',
				default: 'mp3',
				description:
					'File format for the saved audio. MP3 is broadly compatible; M4A and WebM preserve the source audio without re-encoding when available.',
				options: [
					{ name: 'MP3', value: 'mp3' },
					{ name: 'M4A (AAC)', value: 'm4a' },
					{ name: 'WebM (Opus)', value: 'webm' },
				],
				displayOptions: {
					show: {
						resource: ['music'],
					},
				},
			},
			// ---------------------------------------------------------------
			// includeTranscript
			// ---------------------------------------------------------------
			{
				displayName: 'Add Transcript',
				name: 'includeTranscript',
				type: 'boolean',
				default: false,
				description:
					'Whether to attach timed transcript segments when a transcript is available. This adds one extra request per video, charged only when a transcript is returned.',
				displayOptions: {
					show: {
						resource: ['video'],
					},
				},
			},
			{
				displayName: 'Add Transcript',
				name: 'includeTranscript',
				type: 'boolean',
				default: false,
				description:
					'Whether to add timed transcript segments and combined text when YouTube provides them. This is a transcript or caption, not a guaranteed set of song lyrics.',
				displayOptions: {
					show: {
						resource: ['music'],
					},
				},
			},
			// ---------------------------------------------------------------
			// subtitleLanguage
			// ---------------------------------------------------------------
			{
				displayName: 'Subtitle Language',
				name: 'subtitleLanguage',
				type: 'string',
				default: '',
				placeholder: 'en',
				description: 'Optional language code for one subtitle track, such as en, es, or pt-BR',
				displayOptions: {
					show: {
						resource: ['video'],
					},
				},
			},
			{
				displayName: 'Subtitle Language',
				name: 'subtitleLanguage',
				type: 'string',
				default: '',
				placeholder: 'en',
				description:
					'Optional language code for one available caption track, such as en, es, or pt-BR. Missing captions do not prevent the audio download.',
				displayOptions: {
					show: {
						resource: ['music'],
					},
				},
			},
			// ---------------------------------------------------------------
			// binary download (both resources)
			// ---------------------------------------------------------------
			{
				displayName: 'Download File to Binary',
				name: 'downloadToBinary',
				type: 'boolean',
				default: true,
				description:
					'Whether to download the saved media file from Apify and attach it as binary data on the output item, ready to chain into Google Drive, S3, Telegram, and similar nodes. Only takes effect for items that actually have a saved file.',
			},
			{
				displayName: 'Put Output File in Field',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				description: 'Name of the binary property to write the downloaded file to',
				displayOptions: {
					show: {
						downloadToBinary: [true],
					},
				},
			},
			// ---------------------------------------------------------------
			// advanced options
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
							'Memory to allocate to the Actor run. Higher memory can speed up media transcoding at a higher cost per run.',
						options: [
							{ name: 'Use Actor Default (1024 MB)', value: 0 },
							{ name: '256 MB', value: 256 },
							{ name: '512 MB', value: 512 },
							{ name: '1024 MB', value: 1024 },
							{ name: '2048 MB', value: 2048 },
							{ name: '4096 MB', value: 4096 },
							{ name: '8192 MB', value: 8192 },
							{ name: '16384 MB', value: 16384 },
							{ name: '32768 MB', value: 32768 },
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
				const resource = this.getNodeParameter('resource', itemIndex) as 'video' | 'music';
				const actorId =
					resource === 'video' ? VIDEO_DOWNLOADER_ACTOR_ID : MUSIC_DOWNLOADER_ACTOR_ID;
				const actorSlug = toApifyActorSlug(actorId);

				const urlsRaw = this.getNodeParameter('urls', itemIndex) as string;
				const requestList = parseUrlsInput(urlsRaw);
				if (requestList.length === 0) {
					throw new NodeOperationError(
						this.getNode(),
						'Provide at least one YouTube URL or video ID.',
						{ itemIndex },
					);
				}

				const regionRaw = this.getNodeParameter('region', itemIndex) as string;
				let region: string;
				try {
					region = normalizeRegion(
						regionRaw,
						resource === 'video' ? 'Access Country' : 'Download Country',
					);
				} catch (error) {
					throw new NodeOperationError(this.getNode(), (error as Error).message, { itemIndex });
				}

				const includeTranscript = this.getNodeParameter(
					'includeTranscript',
					itemIndex,
					false,
				) as boolean;

				const subtitleLanguageRaw = this.getNodeParameter(
					'subtitleLanguage',
					itemIndex,
					'',
				) as string;
				let subtitleLanguage: string | undefined;
				try {
					subtitleLanguage = normalizeSubtitleLanguage(subtitleLanguageRaw);
				} catch (error) {
					throw new NodeOperationError(this.getNode(), (error as Error).message, { itemIndex });
				}

				const runInput: IDataObject = {
					urls: requestList,
					region,
					includeTranscript,
				};
				if (subtitleLanguage) {
					runInput.subtitleLanguage = subtitleLanguage;
				}

				if (resource === 'video') {
					const saveMedia = this.getNodeParameter('saveMedia', itemIndex, false) as boolean;
					const quality = this.getNodeParameter('quality', itemIndex, 'best') as string;
					const format = this.getNodeParameter('format', itemIndex, 'default') as string;
					runInput.saveMedia = saveMedia;
					runInput.quality = quality;
					runInput.format = format;
				} else {
					const audioFormat = this.getNodeParameter('audioFormat', itemIndex, 'mp3') as string;
					runInput.audioFormat = audioFormat;
				}

				const downloadToBinary = this.getNodeParameter(
					'downloadToBinary',
					itemIndex,
					true,
				) as boolean;
				const binaryPropertyName = this.getNodeParameter(
					'binaryPropertyName',
					itemIndex,
					'data',
				) as string;
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
					body: runInput,
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

				if (resource === 'music' && datasetItems.length < requestList.length) {
					this.logger.warn(
						`YouTube Downloader: run ${runId} returned ${datasetItems.length} of ${requestList.length} requested track(s). Tracks whose audio failed to save are skipped rather than emitted as an error row; check ${consoleRunUrl} for details.`,
					);
				}

				for (const item of datasetItems) {
					const outputJson: IDataObject = { ...item };
					const outputItem: INodeExecutionData = {
						json: outputJson,
						pairedItem: { item: itemIndex },
					};

					const savedFile = item.savedFile as IDataObject | undefined;

					if (downloadToBinary && savedFile?.url) {
						try {
							const fileResponse = (await this.helpers.httpRequestWithAuthentication.call(
								this,
								'apifyApi',
								{
									method: 'GET',
									url: savedFile.url as string,
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
									savedFile.key as string,
									savedFile.contentType as string,
								),
							};
						} catch (error) {
							this.logger.warn(
								`YouTube Downloader: failed to download the saved file for item, emitting metadata without binary data. ${(error as Error).message}`,
							);
							outputJson.binaryDownloadError = (error as Error).message;
						}
					} else if (downloadToBinary && !savedFile) {
						outputJson.binaryDownloadSkippedReason =
							resource === 'video'
								? 'No saved file on this item. Either "Save Playable Files" was off, or the save failed and this item falls back to the expiring formats[].directUrl links instead.'
								: 'No saved file on this item.';
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
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex });
			}
		}

		return [returnData];
	}
}
