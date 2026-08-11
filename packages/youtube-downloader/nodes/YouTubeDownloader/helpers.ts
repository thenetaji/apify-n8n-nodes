/**
 * Pure, framework-free helpers for the YouTube Downloader node.
 *
 * Kept separate from YouTubeDownloader.node.ts so the input-transformation
 * logic (the part most likely to have edge cases) can be unit tested without
 * an n8n runtime or network access.
 */

export interface RequestListEntry {
	url: string;
}

/**
 * Convert the newline/comma-separated block of YouTube URLs or video IDs
 * from the node's "urls" field into the array-of-objects shape
 * (`[{ url: "..." }]`) that the Apify Actors' `requestListSources` editor
 * publishes in its input schema. De-duplicates on the raw trimmed string;
 * the Actor performs its own, smarter de-duplication downstream.
 */
export function parseUrlsInput(raw: string): RequestListEntry[] {
	const seen = new Set<string>();
	const entries: RequestListEntry[] = [];

	for (const token of (raw ?? '').split(/[\n,]+/)) {
		const trimmed = token.trim();
		if (trimmed === '' || seen.has(trimmed)) {
			continue;
		}
		seen.add(trimmed);
		entries.push({ url: trimmed });
	}

	return entries;
}

const REGION_PATTERN = /^[A-Za-z]{2}$/;

/**
 * Validate and normalize a 2-letter country code. The Apify schema validates
 * `region` with `^[A-Za-z]{2}$` and the Actor always uppercases it before
 * use, so the node uppercases it up front and fails fast with a clear
 * message rather than letting an invalid value reach the Actor run.
 */
export function normalizeRegion(raw: string, fieldLabel: string): string {
	const trimmed = (raw ?? '').trim();

	if (!REGION_PATTERN.test(trimmed)) {
		throw new Error(
			`${fieldLabel} "${raw}" is not valid. Use a 2-letter country code, such as US or DE.`,
		);
	}

	return trimmed.toUpperCase();
}

const SUBTITLE_LANGUAGE_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

/**
 * Validate an optional subtitle/caption language code. Returns `undefined`
 * for an empty value so callers can omit the key from the run input instead
 * of sending an empty string.
 */
export function normalizeSubtitleLanguage(raw: string): string | undefined {
	const trimmed = (raw ?? '').trim();

	if (trimmed === '') {
		return undefined;
	}

	if (!SUBTITLE_LANGUAGE_PATTERN.test(trimmed)) {
		throw new Error(
			`Subtitle language "${raw}" is not valid. Use a language code, such as en, es, or pt-BR.`,
		);
	}

	return trimmed;
}

const TERMINAL_RUN_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT']);

/** Whether an Apify run status is a terminal one (the run has stopped). */
export function isTerminalRunStatus(status: string): boolean {
	return TERMINAL_RUN_STATUSES.has(status);
}

/**
 * Apify Console/website actor references use `owner/actor-name`, but the
 * REST API path segment requires the tilde-separated form
 * (`owner~actor-name`) or an opaque Actor ID. This node's exported Actor ID
 * constants use the slash form (matching the Actor's public page URL), so
 * every REST call must convert it first.
 */
export function toApifyActorSlug(actorId: string): string {
	return actorId.replace('/', '~');
}
