/**
 * Pure unit tests for the framework-free helpers and the operation registry
 * behind the YouTube Scraper node. No network access, no n8n runtime — run with
 * `node --test` (Node.js 22.6+/23+ with native TypeScript support to load the
 * imported .ts files). Plain JavaScript (not .ts) so it falls outside both the
 * package's tsconfig include (never ships in `dist`) and the ESLint `**\/*.ts`
 * community-node ruleset.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isTerminalRunStatus, toApifyActorSlug } from '../nodes/YouTubeScraper/helpers.ts';
import {
	buildRunPlan,
	OPERATIONS,
	parseListInput,
	resolveMaxItems,
} from '../nodes/YouTubeScraper/operations.ts';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

void test('parseListInput splits, trims and de-duplicates', () => {
	assert.deepEqual(parseListInput('abc, def\n abc \nghi'), ['abc', 'def', 'ghi']);
	assert.deepEqual(parseListInput('  \n , '), []);
});

void test('resolveMaxItems maps returnAll and non-positive limits to unlimited', () => {
	assert.equal(resolveMaxItems(true, 50), 0);
	assert.equal(resolveMaxItems(false, 0), 0);
	assert.equal(resolveMaxItems(false, -1), 0);
	assert.equal(resolveMaxItems(false, 30), 30);
});

void test('isTerminalRunStatus recognises every terminal Apify status', () => {
	for (const status of ['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT']) {
		assert.equal(isTerminalRunStatus(status), true, status);
	}
	assert.equal(isTerminalRunStatus('RUNNING'), false);
});

void test('toApifyActorSlug converts the owner/name form to the REST tilde form', () => {
	assert.equal(
		toApifyActorSlug('thenetaji/youtube-channel-scraper'),
		'thenetaji~youtube-channel-scraper',
	);
});

// ---------------------------------------------------------------------------
// operation registry
// ---------------------------------------------------------------------------

void test('every operation points at a thenetaji YouTube Actor', () => {
	for (const [name, spec] of Object.entries(OPERATIONS)) {
		assert.match(spec.actor, /^thenetaji\/youtube-/, name);
		assert.ok(spec.fields.length > 0, `${name} declares no fields`);
	}
});

void test('sourceList fields become requestListSources objects, idList fields stay strings', () => {
	const sources = buildRunPlan('videoTranscript', {
		videoSources: 'https://youtu.be/abc\nxyz',
		returnAll: true,
	});
	assert.deepEqual(sources.input.video_sources, [{ url: 'https://youtu.be/abc' }, { url: 'xyz' }]);

	const ids = buildRunPlan('videoDetails', { videoIds: 'abc, xyz' });
	assert.deepEqual(ids.input.videoIds, ['abc', 'xyz']);
});

void test('search operations pin their own scraperType', () => {
	assert.equal(
		buildRunPlan('searchTrending', { trendCategory: 'music', returnAll: true }).input.scraperType,
		'trending',
	);
	assert.equal(
		buildRunPlan('searchHashtag', {
			hashtag: 'urbanphotography',
			contentKind: 'all',
			returnAll: true,
		}).input.scraperType,
		'hashtag',
	);
	// All six search workflows share one Actor.
	const actors = new Set(
		['searchVideos', 'searchHashtag', 'searchTrending', 'searchHype', 'searchHome', 'searchSuggestions'].map(
			(op) => OPERATIONS[op].actor,
		),
	);
	assert.equal(actors.size, 1);
});

void test('empty optional selects are omitted rather than sent as empty strings', () => {
	const plan = buildRunPlan('searchVideos', {
		searchTerm: 'indoor herb garden',
		resultKind: '',
		lengthFilter: '',
		publishedWithin: '',
		sortOrder: '',
		returnAll: true,
	});
	for (const key of ['result_kind', 'length_filter', 'published_within', 'sort_order']) {
		assert.equal(key in plan.input, false, `${key} should be omitted`);
	}
	assert.equal(plan.input.search_term, 'indoor herb garden');
});

void test('set optional selects are forwarded under their snake_case key', () => {
	const plan = buildRunPlan('searchVideos', {
		searchTerm: 'herbs',
		resultKind: 'shorts',
		publishedWithin: 'week',
		returnAll: false,
		limit: 10,
	});
	assert.equal(plan.input.result_kind, 'shorts');
	assert.equal(plan.input.published_within, 'week');
	assert.equal(plan.input.maxItems, 10);
});

void test('blank optional text is omitted so the Actor default applies', () => {
	const plan = buildRunPlan('videoComments', {
		commentSources: 'https://youtu.be/abc',
		ownerChannel: '   ',
		regionCode: '',
		languageCode: 'en',
		returnAll: true,
	});
	assert.equal('owner_channel' in plan.input, false);
	assert.equal('region_code' in plan.input, false);
	assert.equal(plan.input.language_code, 'en');
});

void test('channel sections must not be empty', () => {
	assert.throws(
		() => buildRunPlan('channelGet', { channelSources: '@TED', channelSections: [] }),
		/Channel Content is required/,
	);

	const plan = buildRunPlan('channelGet', {
		channelSources: '@TED',
		channelSections: ['about', 'videos'],
		returnAll: true,
	});
	assert.deepEqual(plan.input.channel_sections, ['about', 'videos']);
});

void test('missing required targets and text are rejected', () => {
	assert.throws(() => buildRunPlan('videoDetails', { videoIds: '' }), /Videos is required/);
	assert.throws(
		() => buildRunPlan('searchSuggestions', { searchTerm: '  ', returnAll: true }),
		/Search Query is required/,
	);
});

void test('booleans always reach the Actor, defaulting to false', () => {
	const plan = buildRunPlan('playlistGet', {
		playlistSources: 'PL123',
		returnAll: true,
	});
	assert.equal(plan.input.includeVideoDetails, false);
	assert.equal(plan.input.includeTranscript, false);
});

void test('buildRunPlan rejects an unknown operation', () => {
	assert.throws(() => buildRunPlan('nope', {}), /Unknown operation/);
});
