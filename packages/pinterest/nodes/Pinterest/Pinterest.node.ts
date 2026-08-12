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

export class Pinterest implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Pinterest',
		name: 'pinterest',
		icon: { light: 'file:pinterest.svg', dark: 'file:pinterest.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Scrape Pinterest pins, profiles, boards and search results via Apify Actors',
		defaults: {
			name: 'Pinterest',
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
						name: 'Board',
						value: 'board',
						description: 'Read the pins saved to a board',
					},
					{
						name: 'Pin',
						value: 'pin',
						description: 'Read a single pin and who saved it',
					},
					{
						name: 'Profile',
						value: 'profile',
						description: 'Read a public profile and its boards',
					},
					{
						name: 'Search',
						value: 'search',
						description: 'Search Pinterest for pins by keyword',
					},
				],
				default: 'pin',
			},
			// ---------------------------------------------------------------
			// Operations, one property per resource
			// ---------------------------------------------------------------
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['pin'] } },
				options: [
					{
						name: 'Get Details',
						value: 'pinDetails',
						description: 'Fetch a pin with its save count, comment count and media',
						action: 'Get pin details',
					},
				],
				default: 'pinDetails',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['profile'] } },
				options: [
					{
						name: 'Get Boards',
						value: 'profileBoards',
						description: 'List the public boards belonging to one or more profiles',
						action: 'Get boards for a profile',
					},
					{
						name: 'Get Profile',
						value: 'profileGet',
						description: 'Fetch a public profile, optionally with its boards attached',
						action: 'Get a profile',
					},
				],
				default: 'profileGet',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['board'] } },
				options: [
					{
						name: 'Get Pins',
						value: 'boardPins',
						description: 'List the pins saved to one or more boards',
						action: 'Get pins in a board',
					},
				],
				default: 'boardPins',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['search'] } },
				options: [
					{
						name: 'Search Pins',
						value: 'searchPins',
						description: 'Find pins or video pins matching a keyword',
						action: 'Search pins',
					},
				],
				default: 'searchPins',
			},
			// ---------------------------------------------------------------
			// Targets
			// ---------------------------------------------------------------
			{
				displayName: 'Pin',
				name: 'pinIdOrUrl',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'https://www.pinterest.com/pin/1136384918502158229/',
				description:
					"A pin's numeric ID, a full pinterest.com/pin/&lt;ID&gt;/ URL, or a pin.it short link. This operation takes one pin per input item.",
				displayOptions: { show: { operation: operationsWith('pinIdOrUrl') } },
			},
			{
				displayName: 'Profile',
				name: 'profileUsername',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'pinterest',
				description:
					'A Pinterest username, or the full pinterest.com/&lt;username&gt;/ profile URL. This operation takes one profile per input item.',
				displayOptions: { show: { operation: operationsWith('profileUsername') } },
			},
			{
				displayName: 'Profiles',
				name: 'profileUsernames',
				type: 'string',
				typeOptions: { rows: 4 },
				default: 'pinterest',
				required: true,
				placeholder: 'pinterest',
				description:
					'One Pinterest username or profile URL per line. Boards are listed for each. Commas are also accepted as a separator.',
				displayOptions: { show: { operation: operationsWith('profileUsernames') } },
			},
			{
				displayName: 'Boards',
				name: 'boardIds',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
				required: true,
				placeholder: 'https://www.pinterest.com/fashion/whimsical-picnic-day-outfits/',
				description:
					'One board ID or full pinterest.com/&lt;owner&gt;/&lt;board-slug&gt;/ URL per line. A numeric ID skips the lookup a URL needs. Commas are also accepted as a separator.',
				displayOptions: { show: { operation: operationsWith('boardIds') } },
			},
			{
				displayName: 'Search Keywords',
				name: 'query',
				type: 'string',
				default: 'coffee',
				required: true,
				placeholder: 'coffee',
				description: 'Words or phrases used to find Pinterest pins',
				displayOptions: { show: { operation: operationsWith('query') } },
			},
			{
				displayName: 'Result Type',
				name: 'scope',
				type: 'options',
				default: 'pins',
				description: 'Whether the search returns pins or video pins',
				options: [
					{ name: 'Pins', value: 'pins' },
					{ name: 'Video Pins', value: 'videos' },
				],
				displayOptions: { show: { operation: operationsWith('scope') } },
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
			// Add-ons
			// ---------------------------------------------------------------
			{
				displayName: 'Add Pin Details',
				name: 'addonPinDetails',
				type: 'boolean',
				default: false,
				description:
					'Whether to fetch full pin detail — save count, comment count and media — for every pin found. This makes one extra request per pin.',
				displayOptions: { show: { operation: operationsWith('addonPinDetails') } },
			},
			{
				displayName: 'Add Pinner Profile',
				name: 'addonPinnerProfile',
				type: 'boolean',
				default: false,
				description:
					'Whether to attach the full public profile of the account that saved each pin, under `pinner_profile`. This makes one extra request per distinct account.',
				displayOptions: { show: { operation: operationsWith('addonPinnerProfile') } },
			},
			{
				displayName: 'Add Boards',
				name: 'addonBoards',
				type: 'boolean',
				default: false,
				description:
					"Whether to attach the profile's public boards, under `boards`. This paginates until Max Boards per Profile is reached.",
				displayOptions: { show: { operation: operationsWith('addonBoards') } },
			},
			{
				displayName: 'Max Boards per Profile',
				name: 'maxBoardsPerProfile',
				type: 'number',
				default: 0,
				typeOptions: { minValue: 0 },
				description:
					'Maximum boards to collect per profile when Add Boards is on. Set 0 to keep going until no further boards are available.',
				displayOptions: {
					show: { operation: operationsWith('maxBoardsPerProfile'), addonBoards: [true] },
				},
			},
			{
				displayName: 'Add Board Pins',
				name: 'addonBoardPins',
				type: 'boolean',
				default: false,
				description:
					"Whether to attach each board's pins, under `board_pins`. This paginates until Max Pins per Board is reached.",
				displayOptions: { show: { operation: operationsWith('addonBoardPins') } },
			},
			{
				displayName: 'Max Pins per Board',
				name: 'maxPinsPerBoard',
				type: 'number',
				default: 0,
				typeOptions: { minValue: 0 },
				description:
					'Maximum pins to collect per board when Add Board Pins is on. Set 0 to keep going until no further pins are available.',
				displayOptions: {
					show: { operation: operationsWith('maxPinsPerBoard'), addonBoardPins: [true] },
				},
			},
			{
				displayName: 'Add Cover Pin Details',
				name: 'addonCoverPinDetails',
				type: 'boolean',
				default: false,
				description:
					"Whether to fetch full pin detail for each board's cover pin, under `cover_pin_details`. This makes one extra request per board.",
				displayOptions: { show: { operation: operationsWith('addonCoverPinDetails') } },
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
					if (field === 'maxItems') {
						values.returnAll = this.getNodeParameter('returnAll', itemIndex, false) as boolean;
						values.limit = this.getNodeParameter('limit', itemIndex, 50) as number;
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
						`Pinterest: run ${runId} finished successfully but returned no items. Secret boards and deleted or private profiles come back empty; check ${consoleRunUrl} for the run log.`,
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
