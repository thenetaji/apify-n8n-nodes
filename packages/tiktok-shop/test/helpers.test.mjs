/**
 * Pure unit tests for the framework-free helpers and the operation registry
 * behind the TikTok Shop node. No network access, no n8n runtime — run with
 * `node --test` (Node.js 22.6+/23+ with native TypeScript support to load the
 * imported .ts files). Plain JavaScript (not .ts) so it falls outside both the
 * package's tsconfig include (never ships in `dist`) and the ESLint `**\/*.ts`
 * community-node ruleset.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isTerminalRunStatus, toApifyActorSlug } from '../nodes/TikTokShop/helpers.ts';
import {
	buildRunPlan,
	OPERATIONS,
	parseListInput,
	resolveMaxItems,
} from '../nodes/TikTokShop/operations.ts';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

void test('parseListInput splits on newlines and commas', () => {
	const result = parseListInput('https://shop.tiktok.com/us/pdp/111, 222\n333');
	assert.deepEqual(result, ['https://shop.tiktok.com/us/pdp/111', '222', '333']);
});

void test('parseListInput trims, drops blanks and de-duplicates', () => {
	assert.deepEqual(parseListInput('  111  \n\n 222 ,,111\n'), ['111', '222']);
});

void test('parseListInput returns an empty array for empty input', () => {
	assert.deepEqual(parseListInput(''), []);
	assert.deepEqual(parseListInput('   \n , \n'), []);
});

void test('resolveMaxItems maps returnAll to the Actors unlimited sentinel', () => {
	assert.equal(resolveMaxItems(true, 50), 0);
});

void test('resolveMaxItems passes a positive limit through as an integer', () => {
	assert.equal(resolveMaxItems(false, 25), 25);
	assert.equal(resolveMaxItems(false, 25.9), 25);
});

void test('resolveMaxItems treats a non-positive limit as unlimited, not as zero results', () => {
	assert.equal(resolveMaxItems(false, 0), 0);
	assert.equal(resolveMaxItems(false, -5), 0);
	assert.equal(resolveMaxItems(false, Number.NaN), 0);
});

void test('isTerminalRunStatus recognises every terminal Apify status', () => {
	for (const status of ['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT']) {
		assert.equal(isTerminalRunStatus(status), true, status);
	}
	for (const status of ['READY', 'RUNNING', 'ABORTING']) {
		assert.equal(isTerminalRunStatus(status), false, status);
	}
});

void test('toApifyActorSlug converts the owner/name form to the REST tilde form', () => {
	assert.equal(
		toApifyActorSlug('thenetaji/tiktok-shop-product-scraper'),
		'thenetaji~tiktok-shop-product-scraper',
	);
});

// ---------------------------------------------------------------------------
// operation registry
// ---------------------------------------------------------------------------

void test('every operation points at a thenetaji TikTok Shop Actor', () => {
	for (const [name, spec] of Object.entries(OPERATIONS)) {
		assert.match(spec.actor, /^thenetaji\/tiktok-shop-/, name);
		assert.ok(spec.fields.length > 0, `${name} declares no fields`);
	}
});

void test('buildRunPlan emits only the fields the Actor schema defines', () => {
	const plan = buildRunPlan('productDetails', {
		productIds: 'https://shop.tiktok.com/us/pdp/123',
		region: 'GB',
		// Deliberately supplied but not declared by this operation:
		limit: 10,
		enrichProductDetails: true,
	});

	assert.equal(plan.actor, 'thenetaji/tiktok-shop-product-scraper');
	assert.deepEqual(plan.input, {
		product_ids: ['https://shop.tiktok.com/us/pdp/123'],
		region: 'GB',
	});
});

void test('buildRunPlan renames node parameters to the Actors snake_case keys', () => {
	const category = buildRunPlan('categoryProducts', {
		categoryId: '601450',
		region: 'US',
		returnAll: false,
		limit: 5,
	});
	assert.equal(category.input.category_id, '601450');

	const seller = buildRunPlan('sellerProducts', {
		sellerId: '7495516049083828882',
		region: 'US',
		returnAll: true,
	});
	assert.equal(seller.input.seller_id, '7495516049083828882');
	assert.equal(seller.input.maxItems, 0);
});

void test('buildRunPlan folds the carousel and insight selects into scraperType', () => {
	const carousel = buildRunPlan('productRecommendations', {
		scraperType: 'moreFromShop',
		productIds: '123',
		region: 'US',
		returnAll: false,
		limit: 20,
	});
	assert.equal(carousel.actor, 'thenetaji/tiktok-shop-recommendations-scraper');
	assert.equal(carousel.input.scraperType, 'moreFromShop');

	const insights = buildRunPlan('searchInsights', {
		scraperType: 'relatedTerms',
		keyword: 'wireless earbuds',
		region: 'US',
		returnAll: true,
	});
	assert.equal(insights.actor, 'thenetaji/tiktok-shop-search-insights-scraper');
	assert.equal(insights.input.scraperType, 'relatedTerms');
});

void test('buildRunPlan rejects an empty product list', () => {
	assert.throws(
		() => buildRunPlan('productDetails', { productIds: '  \n ', region: 'US' }),
		/at least one TikTok Shop product/,
	);
});

void test('buildRunPlan rejects a missing required keyword', () => {
	assert.throws(
		() => buildRunPlan('searchProducts', { keyword: '', region: 'US', returnAll: true }),
		/Search Keyword is required/,
	);
});

void test('buildRunPlan keeps the keyword optional for listing health', () => {
	const withoutKeyword = buildRunPlan('productListingHealth', {
		productIds: '123',
		region: 'US',
		reviewSampleSize: 50,
	});
	assert.equal('keyword' in withoutKeyword.input, false);

	const withKeyword = buildRunPlan('productListingHealth', {
		productIds: '123',
		region: 'US',
		keyword: ' wireless earbuds ',
		reviewSampleSize: 50,
	});
	assert.equal(withKeyword.input.keyword, 'wireless earbuds');
});

void test('buildRunPlan forwards only the scoring flags the user actually set', () => {
	const untouched = buildRunPlan('productListingHealth', {
		productIds: '123',
		region: 'US',
		scoringOptions: {},
	});
	assert.equal('includeCreators' in untouched.input, false);
	assert.equal('includeShopSignal' in untouched.input, false);

	const partial = buildRunPlan('productListingHealth', {
		productIds: '123',
		region: 'US',
		scoringOptions: { includeCreators: false },
	});
	assert.equal(partial.input.includeCreators, false);
	assert.equal('includeCompetitive' in partial.input, false);
});

void test('buildRunPlan rejects an unknown operation', () => {
	assert.throws(() => buildRunPlan('nope', {}), /Unknown operation/);
});
