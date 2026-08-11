/**
 * The operation registry: which Apify Actor backs each node operation, and how
 * the node's parameters are folded into that Actor's run input.
 *
 * The YouTube Actors share a field vocabulary (`maxItems`, `region_code`,
 * `language_code`, a list of target URLs, ...), so the mapping is kept as data
 * here rather than as a branch per operation in `execute()`. Adding an Actor
 * means adding one entry below plus its UI properties in the node description —
 * no changes to the run/poll/collect machinery.
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
 * - `idList` — the `stringList` editor: plain strings
 * - `multiSelect` — an array of enum values, at least one required
 * - `text` / `select` — always sent
 * - `optionalText` / `optionalSelect` — omitted when blank, so the Actor's own
 *   default applies instead of an empty value it would have to interpret
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
	| 'maxItems';

interface FieldDef {
	/** Key as it appears in the Actor's input schema. */
	key: string;
	kind: FieldKind;
	/** Human label used in validation messages. */
	label: string;
}

export const FIELDS = {
	videoIds: { key: 'videoIds', kind: 'idList', label: 'Videos' },
	videoSources: { key: 'video_sources', kind: 'sourceList', label: 'Videos' },
	channelSources: { key: 'channel_sources', kind: 'sourceList', label: 'Channels' },
	playlistSources: { key: 'playlist_sources', kind: 'sourceList', label: 'Playlists' },
	commentSources: { key: 'comment_sources', kind: 'sourceList', label: 'Videos or Posts' },
	channelSections: { key: 'channel_sections', kind: 'multiSelect', label: 'Channel Content' },
	channelSearchTerm: {
		key: 'channel_search_term',
		kind: 'optionalText',
		label: 'Search Within Channel',
	},
	ownerChannel: { key: 'owner_channel', kind: 'optionalText', label: 'Community Post Channel ID' },
	searchTerm: { key: 'search_term', kind: 'text', label: 'Search Query' },
	hashtag: { key: 'hashtag', kind: 'text', label: 'Hashtag' },
	resumeCursor: { key: 'resume_cursor', kind: 'optionalText', label: 'Resume From' },
	resultKind: { key: 'result_kind', kind: 'optionalSelect', label: 'Result Type' },
	lengthFilter: { key: 'length_filter', kind: 'optionalSelect', label: 'Video Duration' },
	publishedWithin: { key: 'published_within', kind: 'optionalSelect', label: 'Published Within' },
	sortOrder: { key: 'sort_order', kind: 'optionalSelect', label: 'Result Order' },
	contentKind: { key: 'content_kind', kind: 'select', label: 'Hashtag Content' },
	trendCategory: { key: 'trend_category', kind: 'select', label: 'Trending Category' },
	videoKind: { key: 'video_kind', kind: 'select', label: 'Content Type' },
	captionFormat: { key: 'caption_format', kind: 'select', label: 'Subtitle Format' },
	transcriptLanguage: {
		key: 'transcript_language',
		kind: 'optionalText',
		label: 'Transcript Language',
	},
	captionLanguage: { key: 'caption_language', kind: 'optionalText', label: 'Caption Language' },
	regionCode: { key: 'region_code', kind: 'optionalText', label: 'Country' },
	languageCode: { key: 'language_code', kind: 'optionalText', label: 'Language' },
	includeRelatedContent: {
		key: 'includeRelatedContent',
		kind: 'boolean',
		label: 'Add Related Content',
	},
	includeTranscript: { key: 'includeTranscript', kind: 'boolean', label: 'Add Transcript' },
	includeCaption: { key: 'includeCaption', kind: 'boolean', label: 'Add Caption Text' },
	includeSoundShorts: {
		key: 'includeSoundShorts',
		kind: 'boolean',
		label: 'Add Shorts Using the Same Sound',
	},
	includeVideoDetails: {
		key: 'includeVideoDetails',
		kind: 'boolean',
		label: 'Add Full Video Details',
	},
	includeParentDetails: {
		key: 'includeParentDetails',
		kind: 'boolean',
		label: 'Add Parent Content Details',
	},
	includeSubtitleFile: { key: 'includeSubtitleFile', kind: 'boolean', label: 'Add Subtitle File' },
	maxRelatedItems: { key: 'maxRelatedItems', kind: 'number', label: 'Max Related Results' },
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
	/**
	 * Input keys pinned by the operation itself rather than by the user. The
	 * Search Actor multiplexes six workflows behind one `scraperType`; each is
	 * surfaced as its own node operation so the UI shows only that workflow's
	 * fields.
	 */
	fixedInput?: Record<string, unknown>;
}

export const OPERATIONS: Record<string, OperationSpec> = {
	videoDetails: {
		actor: 'thenetaji/youtube-video-details-scraper',
		label: 'Get Video Details',
		fields: ['videoIds'],
	},
	videoExtendedDetails: {
		actor: 'thenetaji/youtube-video-scraper',
		label: 'Get Extended Video Details',
		fields: [
			'videoSources',
			'videoKind',
			'includeRelatedContent',
			'includeSoundShorts',
			'maxRelatedItems',
			'includeTranscript',
			'includeCaption',
			'captionLanguage',
			'maxItems',
			'regionCode',
			'languageCode',
		],
	},
	videoTranscript: {
		actor: 'thenetaji/youtube-transcript-scraper',
		label: 'Get Transcript',
		fields: [
			'videoSources',
			'transcriptLanguage',
			'includeSubtitleFile',
			'captionFormat',
			'maxItems',
		],
	},
	videoComments: {
		actor: 'thenetaji/youtube-comments-scraper',
		label: 'Get Comments',
		fields: [
			'commentSources',
			'ownerChannel',
			'includeParentDetails',
			'sortOrder',
			'maxItems',
			'regionCode',
			'languageCode',
		],
	},
	channelGet: {
		actor: 'thenetaji/youtube-channel-scraper',
		label: 'Get Channel',
		fields: [
			'channelSources',
			'channelSections',
			'channelSearchTerm',
			'maxItems',
			'regionCode',
			'languageCode',
		],
	},
	playlistGet: {
		actor: 'thenetaji/youtube-playlist-scraper',
		label: 'Get Playlist',
		fields: [
			'playlistSources',
			'includeVideoDetails',
			'includeTranscript',
			'maxItems',
			'regionCode',
			'languageCode',
		],
	},
	searchVideos: {
		actor: 'thenetaji/youtube-search-scraper',
		label: 'Search',
		fixedInput: { scraperType: 'search' },
		fields: [
			'searchTerm',
			'resultKind',
			'lengthFilter',
			'publishedWithin',
			'sortOrder',
			'maxItems',
			'resumeCursor',
			'regionCode',
			'languageCode',
		],
	},
	searchHashtag: {
		actor: 'thenetaji/youtube-search-scraper',
		label: 'Search by Hashtag',
		fixedInput: { scraperType: 'hashtag' },
		fields: ['hashtag', 'contentKind', 'maxItems', 'resumeCursor', 'regionCode', 'languageCode'],
	},
	searchTrending: {
		actor: 'thenetaji/youtube-search-scraper',
		label: 'Get Trending',
		fixedInput: { scraperType: 'trending' },
		fields: ['trendCategory', 'maxItems', 'regionCode', 'languageCode'],
	},
	searchHype: {
		actor: 'thenetaji/youtube-search-scraper',
		label: 'Get Hype',
		fixedInput: { scraperType: 'hype' },
		fields: ['maxItems', 'regionCode', 'languageCode'],
	},
	searchHome: {
		actor: 'thenetaji/youtube-search-scraper',
		label: 'Get Home Feed',
		fixedInput: { scraperType: 'home' },
		fields: ['maxItems', 'resumeCursor', 'regionCode', 'languageCode'],
	},
	searchSuggestions: {
		actor: 'thenetaji/youtube-search-scraper',
		label: 'Get Search Suggestions',
		fixedInput: { scraperType: 'suggestions' },
		fields: ['searchTerm', 'maxItems', 'regionCode', 'languageCode'],
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
				// An empty select means "leave it to YouTube"; sending an empty string
				// would fail the Actor's enum validation.
				if (typeof value === 'string' && value !== '') {
					input[def.key] = value;
				}
				break;
			}
			case 'boolean':
				input[def.key] = value === true;
				break;
			case 'number':
				input[def.key] = typeof value === 'number' ? value : 0;
				break;
			case 'maxItems':
				input[def.key] = resolveMaxItems(values.returnAll ?? false, values.limit ?? 0);
				break;
		}
	}

	return { actor: spec.actor, input };
}
