/**
 * Pure unit tests for the framework-free helpers and the operation registry
 * behind the TikTok node. No network access, no n8n runtime — run with
 * `node --test` (Node.js 22.6+/23+ with native TypeScript support to load the
 * imported .ts files). Plain JavaScript (not .ts) so it falls outside both the
 * package's tsconfig include (never ships in `dist`) and the ESLint `**\/*.ts`
 * community-node ruleset.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	buildDownloadFileName,
	isTerminalRunStatus,
	toApifyActorSlug,
} from '../nodes/TikTok/helpers.ts';
import {
	buildRunPlan,
	OPERATIONS,
	parseListInput,
	resolveMaxItems,
} from '../nodes/TikTok/operations.ts';

const FOUR_URLS = ['a', 'b', 'c', 'd'].map((s) => `https://www.tiktok.com/@${s}`).join('\n');

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

void test('parseListInput splits, trims and de-duplicates', () => {
	assert.deepEqual(parseListInput('a, b\n a \nc'), ['a', 'b', 'c']);
	assert.deepEqual(parseListInput('  \n , '), []);
});

void test('resolveMaxItems maps returnAll and non-positive limits to unlimited', () => {
	assert.equal(resolveMaxItems(true, 50), 0);
	assert.equal(resolveMaxItems(false, 0), 0);
	assert.equal(resolveMaxItems(false, 15), 15);
});

void test('isTerminalRunStatus recognises every terminal Apify status', () => {
	for (const status of ['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT']) {
		assert.equal(isTerminalRunStatus(status), true, status);
	}
	assert.equal(isTerminalRunStatus('RUNNING'), false);
});

void test('toApifyActorSlug converts the owner/name form to the REST tilde form', () => {
	assert.equal(toApifyActorSlug('thenetaji/tiktok-post-scraper'), 'thenetaji~tiktok-post-scraper');
});

void test('buildDownloadFileName appends the container format to the store key', () => {
	// Shape taken from a real run: the key carries no extension of its own.
	assert.equal(buildDownloadFileName({ key: '57gpkjqowpdt', format: 'mp4' }), '57gpkjqowpdt.mp4');
});

void test('buildDownloadFileName does not double up an extension already present', () => {
	assert.equal(buildDownloadFileName({ key: 'clip.mp4', format: 'mp4' }), 'clip.mp4');
	assert.equal(buildDownloadFileName({ key: 'clip.MP4', format: 'mp4' }), 'clip.MP4');
});

void test('buildDownloadFileName falls back when the key or format is missing', () => {
	assert.equal(buildDownloadFileName({ key: 'abc' }), 'abc');
	assert.equal(buildDownloadFileName({ format: 'webm' }), 'tiktok-video.webm');
	assert.equal(buildDownloadFileName({ key: '   ', format: 'mkv' }), 'tiktok-video.mkv');
	assert.equal(buildDownloadFileName({}), 'tiktok-video');
});

// ---------------------------------------------------------------------------
// operation registry
// ---------------------------------------------------------------------------

void test('every operation points at a thenetaji TikTok Actor', () => {
	for (const [name, spec] of Object.entries(OPERATIONS)) {
		assert.match(spec.actor, /^thenetaji\/tiktok-/, name);
		assert.ok(spec.fields.length > 0, `${name} declares no fields`);
	}
});

void test('urls become requestListSources objects', () => {
	const plan = buildRunPlan('profileDetails', { urls: 'https://www.tiktok.com/@khaby.lame' });
	assert.deepEqual(plan.input.urls, [{ url: 'https://www.tiktok.com/@khaby.lame' }]);
});

void test('the batching Actors reject fewer than four URLs with a named error', () => {
	for (const op of ['postDetails', 'postAnyUrl']) {
		assert.equal(OPERATIONS[op].minEntries, 4, op);
		assert.throws(
			() => buildRunPlan(op, { urls: 'https://www.tiktok.com/@a\nhttps://www.tiktok.com/@b' }),
			/needs at least 4 entries in URLs, but got 2/,
			op,
		);
		const ok = buildRunPlan(op, { urls: FOUR_URLS });
		assert.equal(ok.input.urls.length, 4, op);
	}
});

void test('the non-batching Actors accept a single URL', () => {
	assert.equal(OPERATIONS.profileDetails.minEntries, undefined);
	assert.equal(
		buildRunPlan('videoDownload', {
			urls: 'https://www.tiktok.com/@a/video/1',
			quality: 'best',
			format: 'mp4',
			sleepBetweenDownloads: 2000,
		}).input.urls.length,
		1,
	);
});

void test('de-duplication is applied before the minimum-entry check', () => {
	// Four lines, but only three distinct URLs — the Actor would see three.
	assert.throws(
		() => buildRunPlan('postDetails', { urls: 'a\nb\nc\na' }),
		/needs at least 4 entries in URLs, but got 3/,
	);
});

void test('the proxy group is omitted on Automatic and wrapped when chosen', () => {
	const auto = buildRunPlan('postDetails', { urls: FOUR_URLS, proxyGroup: '' });
	assert.equal('proxy' in auto.input, false);

	const residential = buildRunPlan('postDetails', { urls: FOUR_URLS, proxyGroup: 'RESIDENTIAL' });
	assert.deepEqual(residential.input.proxy, {
		useApifyProxy: true,
		apifyProxyGroups: ['RESIDENTIAL'],
	});
});

void test('top ads operations pin their own scraperType on one shared Actor', () => {
	const modes = {
		topAdsRanked: 'topRanked',
		topAdsSpotlight: 'topSpotlight',
		topAdsAnalyze: 'topAnalyze',
	};
	const actors = new Set();
	for (const [op, mode] of Object.entries(modes)) {
		assert.equal(OPERATIONS[op].fixedInput.scraperType, mode, op);
		actors.add(OPERATIONS[op].actor);
	}
	assert.equal(actors.size, 1);
});

void test('maxRelatedItems is clamped into the Actors 1..20 range, never 0', () => {
	const base = {
		materialIds: '7631262985109602311',
		countryCodes: ['US'],
		includeRelatedAds: true,
	};
	assert.equal(buildRunPlan('topAdsAnalyze', { ...base }).input.maxRelatedItems, 5);
	assert.equal(
		buildRunPlan('topAdsAnalyze', { ...base, maxRelatedItems: 0 }).input.maxRelatedItems,
		5,
	);
	assert.equal(
		buildRunPlan('topAdsAnalyze', { ...base, maxRelatedItems: 99 }).input.maxRelatedItems,
		20,
	);
	assert.equal(
		buildRunPlan('topAdsAnalyze', { ...base, maxRelatedItems: 12 }).input.maxRelatedItems,
		12,
	);
});

void test('empty optional selects and text are omitted', () => {
	const plan = buildRunPlan('topAdsRanked', {
		keyword: 'skincare',
		countryCodes: ['US'],
		period: '30',
		topAdsSort: 'for_you',
		returnAll: true,
		adFormat: '',
		likesPercentile: '',
		industryIds: '  ',
		adLanguage: '',
		startUrl: '',
	});
	for (const key of ['ad_format', 'likes_percentile', 'industry_ids', 'ad_language', 'startUrl']) {
		assert.equal(key in plan.input, false, `${key} should be omitted`);
	}
	assert.equal(plan.input.scraperType, 'topRanked');
	assert.equal(plan.input.maxItems, 0);
});

void test('countries must not be empty', () => {
	assert.throws(
		() => buildRunPlan('topAdsAnalyze', { materialIds: '123', countryCodes: [] }),
		/Countries is required/,
	);
});

void test('only the download operation is marked as producing files', () => {
	const withFiles = Object.entries(OPERATIONS)
		.filter(([, spec]) => spec.producesFiles)
		.map(([name]) => name);
	assert.deepEqual(withFiles, ['videoDownload']);
});

void test('buildRunPlan rejects an unknown operation', () => {
	assert.throws(() => buildRunPlan('nope', {}), /Unknown operation/);
});
