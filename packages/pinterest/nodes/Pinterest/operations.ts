/**
 * The operation registry: which Apify Actor backs each node operation, and how
 * the node's parameters are folded into that Actor's run input.
 *
 * Two operations — Pin → Get Details and Profile → Get Profile — run the
 * All-in-One Pinterest Actor with a pinned `scraperType`, because the
 * standalone Pin and Profile Actors are not published. The All-in-One Actor
 * takes a single target for those modes, while the standalone Boards and Board
 * Pins Actors take a list; the field table below keeps that distinction honest
 * rather than papering over it.
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
 * - `idList` — the `stringList` editor: an array of plain strings
 * - `text` — a single required value (the All-in-One Actor's single-target modes)
 * - `select` / `boolean` / `number` — always sent
 */
type FieldKind = 'idList' | 'text' | 'select' | 'boolean' | 'number' | 'maxItems';

interface FieldDef {
	/** Key as it appears in the Actor's input schema. */
	key: string;
	kind: FieldKind;
	/** Human label used in validation messages. */
	label: string;
}

export const FIELDS = {
	pinIdOrUrl: { key: 'pin_id_or_url', kind: 'text', label: 'Pin' },
	profileUsername: { key: 'username_or_url', kind: 'text', label: 'Profile' },
	profileUsernames: { key: 'username_or_url', kind: 'idList', label: 'Profiles' },
	boardIds: { key: 'board_id_or_url', kind: 'idList', label: 'Boards' },
	query: { key: 'query', kind: 'text', label: 'Search Keywords' },
	scope: { key: 'scope', kind: 'select', label: 'Result Type' },
	addonPinDetails: { key: 'addonPinDetails', kind: 'boolean', label: 'Add Pin Details' },
	addonPinnerProfile: { key: 'addonPinnerProfile', kind: 'boolean', label: 'Add Pinner Profile' },
	addonBoards: { key: 'addonBoards', kind: 'boolean', label: 'Add Boards' },
	addonBoardPins: { key: 'addonBoardPins', kind: 'boolean', label: 'Add Board Pins' },
	addonCoverPinDetails: {
		key: 'addonCoverPinDetails',
		kind: 'boolean',
		label: 'Add Cover Pin Details',
	},
	maxBoardsPerProfile: {
		key: 'maxBoardsPerProfile',
		kind: 'number',
		label: 'Max Boards per Profile',
	},
	maxPinsPerBoard: { key: 'maxPinsPerBoard', kind: 'number', label: 'Max Pins per Board' },
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
}

export const OPERATIONS: Record<string, OperationSpec> = {
	pinDetails: {
		actor: 'thenetaji/pinterest-scraper',
		label: 'Get Pin Details',
		fixedInput: { scraperType: 'pinDetail' },
		fields: ['pinIdOrUrl', 'addonPinnerProfile'],
	},
	profileGet: {
		actor: 'thenetaji/pinterest-scraper',
		label: 'Get Profile',
		fixedInput: { scraperType: 'userProfile' },
		fields: ['profileUsername', 'addonBoards', 'maxBoardsPerProfile'],
	},
	profileBoards: {
		actor: 'thenetaji/pinterest-boards-scraper',
		label: 'Get Boards',
		fields: [
			'profileUsernames',
			'maxItems',
			'addonBoardPins',
			'maxPinsPerBoard',
			'addonCoverPinDetails',
		],
	},
	boardPins: {
		actor: 'thenetaji/pinterest-board-pins-scraper',
		label: 'Get Board Pins',
		fields: ['boardIds', 'maxItems', 'addonPinDetails', 'addonPinnerProfile'],
	},
	searchPins: {
		actor: 'thenetaji/pinterest-search-scraper',
		label: 'Search Pins',
		fields: ['query', 'scope', 'maxItems', 'addonPinDetails', 'addonPinnerProfile'],
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
			case 'idList': {
				const entries = parseListInput((value as string) ?? '');
				if (entries.length === 0) {
					throw new Error(`${def.label} is required: provide at least one URL or ID.`);
				}
				input[def.key] = entries;
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
			case 'select':
				input[def.key] = value;
				break;
			case 'boolean':
				input[def.key] = value === true;
				break;
			case 'number':
				// 0 means "keep paginating", which is the Actors' own default.
				input[def.key] = typeof value === 'number' && value > 0 ? Math.floor(value) : 0;
				break;
			case 'maxItems':
				input[def.key] = resolveMaxItems(values.returnAll ?? false, values.limit ?? 0);
				break;
		}
	}

	return { actor: spec.actor, input };
}
