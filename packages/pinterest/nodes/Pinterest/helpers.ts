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
