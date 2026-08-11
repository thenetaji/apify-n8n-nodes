/**
 * The operation registry: which Apify Actor backs each node operation, and how
 * the node's parameters are folded into that Actor's run input.
 *
 * Three Actors (post, profile and the mixed-URL scraper) share one input shape,
 * and the Top Ads Actor multiplexes three workflows behind a `scraperType`.
 * Keeping the mapping as data here means `execute()` has no per-operation
 * branching: adding an Actor is one entry below plus its UI properties.
 *
 * Actor pages: https://apify.com/thenetaji
 *
 * Deliberately import-free so the unit tests can load it directly under Node's
 * native TypeScript support, which does not resolve extensionless relative
 * specifiers.
 */

/**
 * Split a newline/comma-separated block of URLs or IDs into trimmed, unique
 * entries. The Actors de-duplicate again downstream; this keeps the run input
 * honest about what the user actually typed.
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

/**
 * How a node parameter is converted before it reaches the Actor input.
 *
 * - `sourceList` — the `requestListSources` editor: `[{ url }]` objects
 * - `idList` — an array of plain strings
 * - `multiSelect` — an array of enum values, at least one required
 * - `proxy` — Apify's proxy object, omitted entirely when left on Automatic
 * - `optional*` — omitted when blank, so the Actor's own default applies
 */
type FieldKind =
	| 'sourceList'
	| 'idList'
	| 'multiSelect'
	| 'text'
	| 'optionalText'
	| 'select'
	| 'optionalSelect'
	| 'boolean'
	| 'number'
	| 'boundedNumber'
	| 'proxy'
	| 'maxItems';

interface FieldDef {
	/** Key as it appears in the Actor's input schema. */
	key: string;
	kind: FieldKind;
	/** Human label used in validation messages. */
	label: string;
}

export const FIELDS = {
	urls: { key: 'urls', kind: 'sourceList', label: 'URLs' },
	proxyGroup: { key: 'proxy', kind: 'proxy', label: 'Proxy' },
	quality: { key: 'quality', kind: 'select', label: 'Video Quality' },
	format: { key: 'format', kind: 'select', label: 'Output Format' },
	cookies: { key: 'cookies', kind: 'optionalText', label: 'Session Cookies' },
	sleepBetweenDownloads: {
		key: 'sleepBetweenDownloads',
		kind: 'number',
		label: 'Delay Between Downloads',
	},
	adsQuery: { key: 'query', kind: 'text', label: 'Search Query' },
	searchType: { key: 'search_type', kind: 'select', label: 'Search Type' },
	advertiserId: { key: 'advertiser_id', kind: 'optionalText', label: 'Advertiser ID' },
	startUrl: { key: 'startUrl', kind: 'optionalText', label: 'TikTok URL' },
	adsRegion: { key: 'region', kind: 'optionalText', label: 'Country' },
	startTime: { key: 'start_time', kind: 'optionalText', label: 'Start Date' },
	endTime: { key: 'end_time', kind: 'optionalText', label: 'End Date' },
	adsSort: { key: 'sort', kind: 'select', label: 'Sort Ads' },
	enrichAdDetails: { key: 'enrichAdDetails', kind: 'boolean', label: 'Add Full Ad Details' },
	includeAdvertiserReport: {
		key: 'includeAdvertiserReport',
		kind: 'boolean',
		label: 'Add Advertiser Activity Report',
	},
	keyword: { key: 'keyword', kind: 'text', label: 'Brand or Product Keyword' },
	materialIds: { key: 'material_ids', kind: 'idList', label: 'Top Ad Material IDs' },
	countryCodes: { key: 'country_codes', kind: 'multiSelect', label: 'Countries' },
	period: { key: 'period', kind: 'select', label: 'Ranking Period' },
	topAdsSort: { key: 'top_ads_sort', kind: 'select', label: 'Rank By' },
	industryIds: { key: 'industry_ids', kind: 'optionalText', label: 'Industry IDs' },
	objectiveIds: { key: 'objective_ids', kind: 'optionalText', label: 'Objective IDs' },
	adFormat: { key: 'ad_format', kind: 'optionalSelect', label: 'Ad Format' },
	likesPercentile: { key: 'likes_percentile', kind: 'optionalSelect', label: 'Likes Percentile' },
	adLanguage: { key: 'ad_language', kind: 'optionalText', label: 'Ad Language' },
	enrichTopAdDetails: {
		key: 'enrichTopAdDetails',
		kind: 'boolean',
		label: 'Add Full Details to Discovered Ads',
	},
	includeVideoTimeline: {
		key: 'includeVideoTimeline',
		kind: 'boolean',
		label: 'Add per-Second Video Performance',
	},
	timelineMetric: { key: 'timelineMetric', kind: 'select', label: 'Timeline Metric' },
	includePercentile: {
		key: 'includePercentile',
		kind: 'boolean',
		label: 'Add Performance Benchmark',
	},
	percentileMetric: { key: 'percentileMetric', kind: 'select', label: 'Percentile Metric' },
	percentilePeriod: { key: 'percentilePeriod', kind: 'select', label: 'Percentile Period' },
	includeRelatedAds: { key: 'includeRelatedAds', kind: 'boolean', label: 'Find Similar Creatives' },
	// The Actor bounds this one at 1..20; 0 is not the "unlimited" sentinel here.
	maxRelatedItems: {
		key: 'maxRelatedItems',
		kind: 'boundedNumber',
		label: 'Max Related Creatives',
	},
	maxItems: { key: 'maxItems', kind: 'maxItems', label: 'Limit' },
} satisfies Record<string, FieldDef>;

export type OperationField = keyof typeof FIELDS;

export interface OperationSpec {
	/** Apify Actor in `owner/actor-name` form, as it appears on its public page. */
	actor: string;
	/** Human label used in validation messages. */
	label: string;
	/** Which node parameters are folded into the run input. */
	fields: OperationField[];
	/** Input keys pinned by the operation rather than by the user. */
	fixedInput?: Record<string, unknown>;
	/** True when the Actor saves a media file the node can attach as binary. */
	producesFiles?: boolean;
	/**
	 * Minimum number of list entries the Actor's schema demands. The post and
	 * mixed-URL Actors declare `minItems: 4` on `urls`, and reject a shorter run
	 * with a raw validation error; catching it here gives the user a message
	 * that names the field and the number.
	 */
	minEntries?: number;
}

export const OPERATIONS: Record<string, OperationSpec> = {
	postDetails: {
		actor: 'thenetaji/tiktok-post-scraper',
		label: 'Get Post Details',
		fields: ['urls', 'proxyGroup'],
		minEntries: 4,
	},
	postAnyUrl: {
		actor: 'thenetaji/tiktok-scraper',
		label: 'Scrape Any URL',
		fields: ['urls', 'proxyGroup'],
		minEntries: 4,
	},
	profileDetails: {
		actor: 'thenetaji/tiktok-profile-scraper',
		label: 'Get Profile Details',
		fields: ['urls', 'proxyGroup'],
	},
	videoDownload: {
		actor: 'thenetaji/tiktok-video-downloader',
		label: 'Download Video',
		fields: ['urls', 'quality', 'format', 'cookies', 'sleepBetweenDownloads'],
		producesFiles: true,
	},
	adsLibrary: {
		actor: 'thenetaji/tiktok-ads-library-scraper',
		label: 'Search Ads Library',
		fields: [
			'adsQuery',
			'searchType',
			'adsRegion',
			'adsSort',
			'maxItems',
			'enrichAdDetails',
			'includeAdvertiserReport',
			'advertiserId',
			'startUrl',
			'startTime',
			'endTime',
		],
	},
	topAdsRanked: {
		actor: 'thenetaji/tiktok-top-ads-scraper',
		label: 'Get Top Ads',
		fixedInput: { scraperType: 'topRanked' },
		fields: [
			'keyword',
			'countryCodes',
			'period',
			'topAdsSort',
			'maxItems',
			'enrichTopAdDetails',
			'includeVideoTimeline',
			'timelineMetric',
			'includePercentile',
			'percentileMetric',
			'percentilePeriod',
			'industryIds',
			'objectiveIds',
			'adFormat',
			'likesPercentile',
			'adLanguage',
			'startUrl',
		],
	},
	topAdsSpotlight: {
		actor: 'thenetaji/tiktok-top-ads-scraper',
		label: 'Browse Spotlight Creatives',
		fixedInput: { scraperType: 'topSpotlight' },
		fields: [
			'maxItems',
			'enrichTopAdDetails',
			'includeVideoTimeline',
			'timelineMetric',
			'includePercentile',
			'percentileMetric',
			'percentilePeriod',
			'startUrl',
		],
	},
	topAdsAnalyze: {
		actor: 'thenetaji/tiktok-top-ads-scraper',
		label: 'Analyze Creatives',
		fixedInput: { scraperType: 'topAnalyze' },
		fields: [
			'materialIds',
			'countryCodes',
			'includeRelatedAds',
			'maxRelatedItems',
			'includeVideoTimeline',
			'timelineMetric',
			'includePercentile',
			'percentileMetric',
			'percentilePeriod',
			'startUrl',
		],
	},
};

/** Node parameter values, already read off the node by `execute()`. */
export type OperationValues = Record<string, unknown> & {
	returnAll?: boolean;
	limit?: number;
};

export interface RunPlan {
	actor: string;
	input: Record<string, unknown>;
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

	const input: Record<string, unknown> = { ...(spec.fixedInput ?? {}) };

	for (const field of spec.fields) {
		const def: FieldDef = FIELDS[field];
		const value = values[field];

		switch (def.kind) {
			case 'sourceList':
			case 'idList': {
				const entries = parseListInput((value as string) ?? '');
				if (entries.length === 0) {
					throw new Error(`${def.label} is required: provide at least one URL or ID.`);
				}
				const minEntries = def.kind === 'sourceList' ? (spec.minEntries ?? 1) : 1;
				if (entries.length < minEntries) {
					throw new Error(
						`${spec.label} needs at least ${minEntries} entries in ${def.label}, but got ${entries.length}. This Actor batches its requests and rejects shorter runs.`,
					);
				}
				input[def.key] = def.kind === 'sourceList' ? entries.map((url) => ({ url })) : entries;
				break;
			}
			case 'multiSelect': {
				const selected = Array.isArray(value) ? (value as string[]) : [];
				if (selected.length === 0) {
					throw new Error(`${def.label} is required: choose at least one.`);
				}
				input[def.key] = selected;
				break;
			}
			case 'text': {
				const text = ((value as string) ?? '').trim();
				if (text === '') {
					throw new Error(`${def.label} is required for this operation.`);
				}
				input[def.key] = text;
				break;
			}
			case 'optionalText': {
				const text = ((value as string) ?? '').trim();
				if (text !== '') {
					input[def.key] = text;
				}
				break;
			}
			case 'select':
				input[def.key] = value;
				break;
			case 'optionalSelect': {
				// An empty select means "no filter"; sending an empty string would
				// fail the Actor's enum validation.
				if (typeof value === 'string' && value !== '') {
					input[def.key] = value;
				}
				break;
			}
			case 'boolean':
				input[def.key] = value === true;
				break;
			case 'number':
				input[def.key] = typeof value === 'number' && value >= 0 ? Math.floor(value) : 0;
				break;
			case 'boundedNumber':
				// Clamped rather than defaulted to 0: this Actor's schema rejects 0,
				// so a blank or out-of-range value has to land inside 1..20.
				input[def.key] =
					typeof value === 'number' && value >= 1 ? Math.min(Math.floor(value), 20) : 5;
				break;
			case 'proxy': {
				// Left on Automatic, the key is omitted so the Actor's own proxy
				// default applies rather than this node pinning a configuration.
				const group = ((value as string) ?? '').trim();
				if (group !== '') {
					input[def.key] = { useApifyProxy: true, apifyProxyGroups: [group] };
				}
				break;
			}
			case 'maxItems':
				input[def.key] = resolveMaxItems(values.returnAll ?? false, values.limit ?? 0);
				break;
		}
	}

	return { actor: spec.actor, input };
}
