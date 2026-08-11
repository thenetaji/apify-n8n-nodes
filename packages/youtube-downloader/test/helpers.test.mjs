/**
 * Pure unit tests for the framework-free helpers used by the YouTube
 * Downloader node (nodes/YouTubeDownloader/helpers.ts). No network access,
 * no n8n runtime — run with `node --test test/helpers.test.mjs` (Node.js
 * 22.6+/23+ with native TypeScript support to load the imported .ts file).
 * Plain JavaScript (not .ts) so it falls outside both the package's
 * tsconfig include (never ships in `dist`) and the ESLint `**\/*.ts`
 * community-node ruleset (which restricts `node:test`/`node:assert`
 * imports for Actor code, but has no bearing on a dev-only test script).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	normalizeRegion,
	normalizeSubtitleLanguage,
	parseUrlsInput,
	toApifyActorSlug,
} from '../nodes/YouTubeDownloader/helpers.ts';

void test('parseUrlsInput splits on newlines and commas', () => {
	const result = parseUrlsInput('https://youtu.be/abc123, https://youtu.be/def456\nghi789');
	assert.deepEqual(result, [
		{ url: 'https://youtu.be/abc123' },
		{ url: 'https://youtu.be/def456' },
		{ url: 'ghi789' },
	]);
});

void test('parseUrlsInput trims whitespace and drops empty entries', () => {
	const result = parseUrlsInput('  \n https://youtu.be/abc123 \n\n, ,  \n');
	assert.deepEqual(result, [{ url: 'https://youtu.be/abc123' }]);
});

void test('parseUrlsInput de-duplicates identical raw entries', () => {
	const result = parseUrlsInput('abc123\nabc123\nABC123');
	// only the byte-identical duplicate is removed; case differences pass
	// through untouched (the Actor performs its own smarter de-duplication)
	assert.deepEqual(result, [{ url: 'abc123' }, { url: 'ABC123' }]);
});

void test('parseUrlsInput returns an empty array for blank input', () => {
	assert.deepEqual(parseUrlsInput(''), []);
	assert.deepEqual(parseUrlsInput('   \n  ,  '), []);
});

void test('normalizeRegion uppercases a valid 2-letter code', () => {
	assert.equal(normalizeRegion('us', 'Access Country'), 'US');
	assert.equal(normalizeRegion(' de ', 'Access Country'), 'DE');
});

void test('normalizeRegion rejects codes of the wrong length', () => {
	assert.throws(() => normalizeRegion('usa', 'Access Country'), /not valid/);
	assert.throws(() => normalizeRegion('u', 'Access Country'), /not valid/);
});

void test('normalizeRegion rejects non-alphabetic input and includes the field label', () => {
	assert.throws(() => normalizeRegion('12', 'Download Country'), /not valid/);
	try {
		normalizeRegion('', 'Download Country');
		assert.fail('expected normalizeRegion to throw');
	} catch (error) {
		assert.match(error.message, /Download Country/);
	}
});

void test('normalizeSubtitleLanguage returns undefined for an empty value', () => {
	assert.equal(normalizeSubtitleLanguage(''), undefined);
	assert.equal(normalizeSubtitleLanguage('   '), undefined);
});

void test('normalizeSubtitleLanguage accepts simple and regional codes', () => {
	assert.equal(normalizeSubtitleLanguage('en'), 'en');
	assert.equal(normalizeSubtitleLanguage('pt-BR'), 'pt-BR');
	assert.equal(normalizeSubtitleLanguage('fil'), 'fil');
});

void test('normalizeSubtitleLanguage rejects malformed codes', () => {
	assert.throws(() => normalizeSubtitleLanguage('english'), /not valid/);
	assert.throws(() => normalizeSubtitleLanguage('1n'), /not valid/);
});

void test('toApifyActorSlug converts the owner/name form to owner~name', () => {
	assert.equal(
		toApifyActorSlug('thenetaji/youtube-video-downloader'),
		'thenetaji~youtube-video-downloader',
	);
	assert.equal(
		toApifyActorSlug('thenetaji/youtube-music-downloader'),
		'thenetaji~youtube-music-downloader',
	);
});
