/**
 * Seven-segment glyph tests.
 *
 * The point of these is not to prove the shapes look right — that needs eyes. It is to prove the
 * *encoding* is sound: that every string the LCD must show is renderable, that the documented
 * collisions are the only ones, and that no character silently maps to nothing.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	GLYPH_COLLISIONS,
	GLYPH_SEGMENTS,
	REQUIRED_CHARACTERS,
	glyphFor,
	hasGlyph,
	renderText,
} from '../src/shared/glyphs.ts';
import { CITIES, lcdCodeForZone } from '../src/shared/catalog.ts';
import { formatClock, formatDay, formatMonthDay, wallClock } from '../src/shared/time.ts';

/**
 * A canonical signature for a set of lit parts, so two glyphs can be compared for identity.
 *
 * The decimal point is mapped to a distinct symbol rather than sorted alongside the segments,
 * because sorting `'a'`, `'.'` and friends together produces strings whose ordering is not
 * stable enough to compare reliably across signature pairs.
 */
function signature(parts: readonly string[]): string {
	return parts
		.map((part) => (part === 'dp' ? '.' : part.toUpperCase()))
		.sort()
		.join('');
}

describe('glyph coverage', () => {
	it('defines a glyph for every required character', () => {
		for (const character of REQUIRED_CHARACTERS) {
			assert.ok(hasGlyph(character), `no glyph for "${character}"`);
		}
	});

	it('defines all ten digits', () => {
		for (const digit of '0123456789') {
			assert.ok(hasGlyph(digit), `no glyph for digit ${digit}`);
		}
	});

	it('returns undefined rather than throwing for an unsupported character', () => {
		assert.equal(glyphFor('\u00e9'), undefined);
		assert.equal(hasGlyph('\u00e9'), false);
	});
});

describe('the digit set is unambiguous', () => {
	it('gives every digit a distinct pattern', () => {
		const seen = new Map<string, string>();
		for (const digit of '0123456789') {
			const sig = signature(GLYPH_SEGMENTS[digit] ?? []);
			const clash = seen.get(sig);
			assert.equal(clash, undefined, `digit ${digit} looks identical to ${clash}`);
			seen.set(sig, digit);
		}
	});

	it('lights all seven segments only for 8', () => {
		for (const digit of '0123456789') {
			const count = (GLYPH_SEGMENTS[digit] ?? []).length;
			assert.equal(count === 7, digit === '8', `digit ${digit} has ${count} segments`);
		}
	});
});

describe('declared collisions (DIS-6)', () => {
	it('records exactly the collisions that exist', () => {
		// Group every glyph by its pattern, then derive which pairs actually collide.
		const bySignature = new Map<string, string[]>();
		for (const [character, parts] of Object.entries(GLYPH_SEGMENTS)) {
			const sig = signature(parts);
			const group = bySignature.get(sig) ?? [];
			group.push(character);
			bySignature.set(sig, group);
		}

		// Canonicalise both sides to sorted pairs, then sort the list by the joined form. Sorting
		// only one side by a different key makes the comparison order-dependent and unreliable.
		const canonical = (pairs: readonly (readonly string[])[]): string[] =>
			pairs.map((pair) => [...pair].sort().join('')).sort();

		const actual = canonical(
			[...bySignature.values()].filter((group) => group.length > 1),
		);
		const declared = canonical(GLYPH_COLLISIONS);

		assert.deepEqual(
			actual,
			declared,
			'GLYPH_COLLISIONS must list every duplicate pattern, and nothing else',
		);
	});

	it('keeps the day names distinguishable from each other', () => {
		// MON/MEX/MOW share M and W; the mirror-image treatment must keep them readable.
		const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
		const rendered = new Set(days.map((day) => renderText(day).map((c) => signature(c.segments)).join('|')));
		assert.equal(rendered.size, days.length, 'two day names render identically');
	});

	it('keeps M and W distinct, since both are real city codes and day names', () => {
		assert.notEqual(signature(GLYPH_SEGMENTS['M'] ?? []), signature(GLYPH_SEGMENTS['W'] ?? []));
	});
});

describe('rendering real display strings', () => {
	it('renders every city code the LCD can show', () => {
		for (const city of CITIES) {
			const code = lcdCodeForZone(city.zone);
			assert.equal(code.length, 3);
			for (const result of renderText(code)) {
				assert.ok(result.known, `"${code}" (for ${city.zone}) needs a glyph for "${result.character}"`);
				assert.ok(result.segments.length > 0, `"${result.character}" in "${code}" has no segments`);
			}
		}
	});

	it('renders every day name the watch prints', () => {
		for (const day of ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']) {
			for (const result of renderText(day)) {
				assert.ok(result.known, `day name ${day} needs a glyph for "${result.character}"`);
			}
		}
	});

	it('renders a formatted clock face in both formats', () => {
		const wall = wallClock('Asia/Tokyo', new Date(Date.UTC(2026, 6, 15, 0, 5, 0)));
		for (const clock of ['12h', '24h'] as const) {
			const text = formatClock(wall, clock, true);
			for (const result of renderText(text)) {
				// AM/PM and the colon are legitimate parts of the display.
				assert.ok(result.known, `clock "${text}" needs a glyph for "${result.character}"`);
			}
		}
	});

	it('renders the month-day field', () => {
		const wall = wallClock('Etc/UTC', new Date(Date.UTC(2026, 8, 25, 12, 0, 0)));
		assert.equal(formatMonthDay(wall), '9-25');
		for (const result of renderText(formatMonthDay(wall))) {
			assert.ok(result.known, `month-day needs a glyph for "${result.character}"`);
		}
	});

	it('renders the day field', () => {
		const wall = wallClock('Etc/UTC', new Date(Date.UTC(2026, 8, 25, 12, 0, 0)));
		assert.equal(formatDay(wall), 'FRI 25');
		for (const result of renderText(formatDay(wall))) {
			assert.ok(result.known, `day field needs a glyph for "${result.character}"`);
		}
	});

	it('reports unsupported characters instead of failing', () => {
		const rendered = renderText('T\u00e9');
		assert.equal(rendered[0]?.known, true);
		assert.equal(rendered[1]?.known, false);
		assert.deepEqual(rendered[1]?.segments, []);
	});

	it('keeps the character attached, so a caller can lay out cells positionally', () => {
		const rendered = renderText('NYC');
		assert.deepEqual(
			rendered.map((r) => r.character),
			['N', 'Y', 'C'],
		);
	});
});

describe('segment hygiene', () => {
	it('uses only the seven segments and the decimal point', () => {
		const allowed = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp']);
		for (const [character, parts] of Object.entries(GLYPH_SEGMENTS)) {
			for (const part of parts) {
				assert.ok(allowed.has(part), `"${character}" uses unknown part "${part}"`);
			}
			assert.equal(new Set(parts).size, parts.length, `"${character}" repeats a segment`);
		}
	});

	it('treats the decimal point as a separate part, not a segment', () => {
		assert.deepEqual(GLYPH_SEGMENTS['.'], ['dp']);
	});

	it('uses a blank glyph for space', () => {
		assert.deepEqual(GLYPH_SEGMENTS[' '], []);
	});
});
