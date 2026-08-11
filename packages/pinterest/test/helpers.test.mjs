/**
 * Pure unit tests for the framework-free helpers and the operation registry
 * behind the Pinterest node. No network access, no n8n runtime — run with
 * `node --test` (Node.js 22.6+/23+ with native TypeScript support to load the
 * imported .ts files). Plain JavaScript (not .ts) so it falls outside both the
 * package's tsconfig include (never ships in `dist`) and the ESLint `**\/*.ts`
 * community-node ruleset.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isTerminalRunStatus, toApifyActorSlug } from '../nodes/Pinterest/helpers.ts';
import {
	buildRunPlan,
	OPERATIONS,
	parseListInput,
	resolveMaxItems,
} from '../nodes/Pinterest/operations.ts';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

void test('parseListInput splits, trims and de-duplicates', () => {
	assert.deepEqual(parseListInput('pinterest, nasa\n pinterest \nnat-geo'), [
		'pinterest',
		'nasa',
		'nat-geo',
	]);
	assert.deepEqual(parseListInput('  \n , '), []);
});

void test('resolveMaxItems maps returnAll and non-positive limits to unlimited', () => {
	assert.equal(resolveMaxItems(true, 50), 0);
	assert.equal(resolveMaxItems(false, 0), 0);
	assert.equal(resolveMaxItems(false, 20), 20);
});

void test('isTerminalRunStatus recognises every terminal Apify status', () => {
	for (const status of ['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT']) {
		assert.equal(isTerminalRunStatus(status), true, status);
	}
	assert.equal(isTerminalRunStatus('RUNNING'), false);
});

void test('toApifyActorSlug converts the owner/name form to the REST tilde form', () => {
	assert.equal(
		toApifyActorSlug('thenetaji/pinterest-search-scraper'),
		'thenetaji~pinterest-search-scraper',
	);
});

// ---------------------------------------------------------------------------
// operation registry
// ---------------------------------------------------------------------------

void test('every operation points at a thenetaji Pinterest Actor', () => {
	for (const [name, spec] of Object.entries(OPERATIONS)) {
		assert.match(spec.actor, /^thenetaji\/pinterest-/, name);
		assert.ok(spec.fields.length > 0, `${name} declares no fields`);
	}
});

void test('pin and profile detail run the all-in-one Actor with a pinned scraperType', () => {
	const pin = buildRunPlan('pinDetails', { pinIdOrUrl: '1136384918502158229' });
	assert.equal(pin.actor, 'thenetaji/pinterest-scraper');
	assert.equal(pin.input.scraperType, 'pinDetail');
	assert.equal(pin.input.pin_id_or_url, '1136384918502158229');

	const profile = buildRunPlan('profileGet', { profileUsername: 'pinterest' });
	assert.equal(profile.actor, 'thenetaji/pinterest-scraper');
	assert.equal(profile.input.scraperType, 'userProfile');
	assert.equal(profile.input.username_or_url, 'pinterest');
});

void test('the standalone Actors take a list under the same Actor key', () => {
	const boards = buildRunPlan('profileBoards', {
		profileUsernames: 'pinterest\nnasa',
		returnAll: true,
	});
	assert.equal(boards.actor, 'thenetaji/pinterest-boards-scraper');
	assert.deepEqual(boards.input.username_or_url, ['pinterest', 'nasa']);
	assert.equal('scraperType' in boards.input, false);

	const pins = buildRunPlan('boardPins', { boardIds: '123, 456', returnAll: false, limit: 25 });
	assert.deepEqual(pins.input.board_id_or_url, ['123', '456']);
	assert.equal(pins.input.maxItems, 25);
});

void test('search forwards its scope and limit', () => {
	const plan = buildRunPlan('searchPins', {
		query: ' coffee ',
		scope: 'videos',
		returnAll: false,
		limit: 10,
	});
	assert.equal(plan.actor, 'thenetaji/pinterest-search-scraper');
	assert.equal(plan.input.query, 'coffee');
	assert.equal(plan.input.scope, 'videos');
	assert.equal(plan.input.maxItems, 10);
});

void test('per-target maxima fall back to the Actors keep-paginating sentinel', () => {
	const plan = buildRunPlan('profileGet', {
		profileUsername: 'pinterest',
		addonBoards: true,
		maxBoardsPerProfile: undefined,
	});
	assert.equal(plan.input.addonBoards, true);
	assert.equal(plan.input.maxBoardsPerProfile, 0);
});

void test('add-on booleans always reach the Actor, defaulting to false', () => {
	const plan = buildRunPlan('boardPins', { boardIds: '123', returnAll: true });
	assert.equal(plan.input.addonPinDetails, false);
	assert.equal(plan.input.addonPinnerProfile, false);
});

void test('missing required targets are rejected', () => {
	assert.throws(() => buildRunPlan('pinDetails', { pinIdOrUrl: '  ' }), /Pin is required/);
	assert.throws(
		() => buildRunPlan('boardPins', { boardIds: '', returnAll: true }),
		/Boards is required/,
	);
	assert.throws(
		() => buildRunPlan('searchPins', { query: '', scope: 'pins', returnAll: true }),
		/Search Keywords is required/,
	);
});

void test('buildRunPlan rejects an unknown operation', () => {
	assert.throws(() => buildRunPlan('nope', {}), /Unknown operation/);
});
