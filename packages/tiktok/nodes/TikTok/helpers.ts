/**
 * Pure, framework-free helpers for driving an Apify Actor run.
 *
 * Kept free of imports so the unit tests can load this file directly under
 * Node's native TypeScript support, which does not resolve extensionless
 * relative specifiers. Input-shaping logic lives in `operations.ts`, which is
 * self-contained for the same reason.
 */

const TERMINAL_RUN_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT']);

/** Whether an Apify run status is a terminal one (the run has stopped). */
export function isTerminalRunStatus(status: string): boolean {
	return TERMINAL_RUN_STATUSES.has(status);
}

/**
 * Apify Console/website actor references use `owner/actor-name`, but the REST
 * API path segment requires the tilde-separated form (`owner~actor-name`) or
 * an opaque Actor ID. This package's Actor ID constants use the slash form
 * (matching each Actor's public page URL), so every REST call must convert it.
 */
export function toApifyActorSlug(actorId: string): string {
	return actorId.replace('/', '~');
}

/**
 * Name the binary file attached to a downloaded video.
 *
 * The downloader Actor stores each file under an opaque key-value store key
 * with no extension (`57gpkjqowpdt`), which downstream nodes like Google Drive
 * would happily save as an extensionless blob. The container format travels in
 * a sibling `format` field, so it is appended here unless the key already
 * carries it.
 */
export function buildDownloadFileName(item: { key?: unknown; format?: unknown }): string {
	const key =
		typeof item.key === 'string' && item.key.trim() !== '' ? item.key.trim() : 'tiktok-video';
	const format = typeof item.format === 'string' ? item.format.trim().toLowerCase() : '';

	if (format === '' || key.toLowerCase().endsWith(`.${format}`)) {
		return key;
	}

	return `${key}.${format}`;
}
