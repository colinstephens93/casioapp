/**
 * Alarm scheduling tests.
 *
 * The valuable cases are the ones where a naive implementation is wrong rather than the ones where
 * it works: firing an alarm sixty times because "is it that minute?" is asked once a second, and
 * firing an hour late on a spring-forward date because the arithmetic assumed days are 1440
 * minutes long. Both are asserted here.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	ALARM_COUNT,
	ALARM_MODES,
	alarmDue,
	alarmPosition,
	alarmScreenAt,
	alarmsEnteringMinute,
	anyArmed,
	defaultAlarms,
	nextAlarmMode,
	repairAlarms,
	stepAlarmPosition,
	alarmById,
	withAlarm,
} from '../src/shared/alarms.ts';

/** A Home City wall clock, as `time.ts` produces it: a `Date` whose UTC fields are the local ones. */
function wall(hour: number, minute: number, second = 0, day = 15): Date {
	return new Date(Date.UTC(2026, 6, day, hour, minute, second));
}

describe('the alarm set', () => {
	it('has exactly five alarms, as the case prints', () => {
		assert.equal(ALARM_COUNT, 5);
		assert.equal(defaultAlarms().defs.length, 5);
		// The ids are the numbers the LCD shows, and nothing else knows what 5 means.
		assert.deepEqual(
			defaultAlarms().defs.map((def) => def.id),
			[1, 2, 3, 4, 5],
		);
	});

	it('starts with every alarm off, matching the watch out of the box', () => {
		assert.equal(defaultAlarms().defs.every((def) => def.mode === 'off'), true);
		assert.equal(anyArmed(defaultAlarms()), false);
	});

	it('cycles daily, one-time, off, as ADJUST does (ALM-3)', () => {
		assert.deepEqual([...ALARM_MODES], ['daily', 'once', 'off']);
		assert.equal(nextAlarmMode('daily'), 'once');
		assert.equal(nextAlarmMode('once'), 'off');
		assert.equal(nextAlarmMode('off'), 'daily');
	});

	it('reports armed state so the ALM indicator can light in any mode (ALM-8)', () => {
		const one = withAlarm(defaultAlarms(), { id: 3, hour: 7, minute: 30, mode: 'once' });
		assert.equal(anyArmed(one), true);
		assert.equal(anyArmed(defaultAlarms()), false);
	});

	it('leaves the other alarms untouched when one is replaced', () => {
		const before = defaultAlarms();
		const after = withAlarm(before, { id: 2, hour: 6, minute: 15, mode: 'daily' });
		assert.equal(alarmById(after, 2)?.hour, 6);
		assert.equal(alarmById(after, 1)?.hour, before.defs[0]?.hour);
		assert.equal(alarmById(after, 3)?.mode, 'off');
	});
});

describe('an alarm is a wall-clock time, not an instant', () => {
	it('is due inside its own minute and not outside it', () => {
		const def = { id: 1, hour: 7, minute: 30, mode: 'daily' as const };
		assert.equal(alarmDue(def, wall(7, 30, 0)), true);
		assert.equal(alarmDue(def, wall(7, 30, 59)), true);
		assert.equal(alarmDue(def, wall(7, 29, 59)), false);
		assert.equal(alarmDue(def, wall(7, 31, 0)), false);
	});

	it('is never due when off', () => {
		const def = { id: 1, hour: 7, minute: 30, mode: 'off' as const };
		assert.equal(alarmDue(def, wall(7, 30)), false);
	});
});

describe('crossing into a minute fires once, not sixty times', () => {
	it('fires on the crossing and not on the readings within the minute', () => {
		const alarms = withAlarm(defaultAlarms(), { id: 1, hour: 7, minute: 30, mode: 'daily' });

		// The second reading crosses into 07:30.
		const crossing = alarmsEnteringMinute(alarms, wall(7, 29, 59), wall(7, 30, 0));
		assert.equal(crossing.length, 1);
		assert.equal(crossing[0]?.id, 1);

		// A reading a second later is *inside* the minute, not entering it, so nothing fires.
		const within = alarmsEnteringMinute(alarms, wall(7, 30, 0), wall(7, 30, 1));
		assert.equal(within.length, 0);

		const later = alarmsEnteringMinute(alarms, wall(7, 30, 30), wall(7, 30, 31));
		assert.equal(later.length, 0);
	});

	it('fires when a late tick steps over the minute entirely', () => {
		// A suspended process wakes up a minute and a half later. The alarm must still be recognised,
		// which is the whole reason the comparison is a range and not an equality.
		const alarms = withAlarm(defaultAlarms(), { id: 2, hour: 7, minute: 31, mode: 'daily' });
		const fired = alarmsEnteringMinute(alarms, wall(7, 30, 0), wall(7, 31, 30));
		assert.equal(fired.length, 1);
		assert.equal(fired[0]?.id, 2);
	});

	it('fires an alarm over midnight when the range spans the day boundary', () => {
		const alarms = withAlarm(defaultAlarms(), { id: 4, hour: 0, minute: 5, mode: 'daily' });
		const overMidnight = alarmsEnteringMinute(
			alarms,
			new Date(Date.UTC(2026, 6, 15, 23, 58, 0)),
			new Date(Date.UTC(2026, 6, 16, 0, 6, 0)),
		);
		assert.equal(overMidnight.length, 1);
		assert.equal(overMidnight[0]?.id, 4);
	});

	it('fires nothing for a clock that went backwards', () => {
		// A clock set back by the operator, or an NTP correction, must not dump every alarm at once.
		const alarms = withAlarm(defaultAlarms(), { id: 1, hour: 7, minute: 30, mode: 'daily' });
		assert.deepEqual(alarmsEnteringMinute(alarms, wall(9, 0), wall(8, 0)), []);
		assert.deepEqual(alarmsEnteringMinute(alarms, wall(9, 0), wall(9, 0)), []);
	});

	it('does not shift by an hour across a spring-forward transition', () => {
		// The reason the day arithmetic is done on calendar fields rather than on milliseconds since
		// an epoch: on a spring-forward date a "day" is 23 hours, so an epoch-based calculation finds
		// the wrong minute. 2026-03-29 is the European transition; the Home City wall clock has
		// already had the offset applied, so 01:59 is followed by 03:00 and the wall clock's own
		// fields are what the alarm is compared against.
		const alarms = withAlarm(defaultAlarms(), { id: 5, hour: 3, minute: 0, mode: 'daily' });
		const fired = alarmsEnteringMinute(
			alarms,
			new Date(Date.UTC(2026, 2, 29, 1, 59, 0)),
			new Date(Date.UTC(2026, 2, 29, 3, 0, 0)),
		);
		assert.equal(fired.length, 1);
		assert.equal(fired[0]?.id, 5);
	});

	it('honours only the first alarm when two are set for the same minute', () => {
		// The machine raises one alert at a time, so the second is deferred rather than lost: it is
		// reported in the same firing list, and the caller takes the first.
		let alarms = withAlarm(defaultAlarms(), { id: 1, hour: 7, minute: 30, mode: 'daily' });
		alarms = withAlarm(alarms, { id: 2, hour: 7, minute: 30, mode: 'daily' });
		const fired = alarmsEnteringMinute(alarms, wall(7, 29), wall(7, 30));
		assert.equal(fired.length, 2);
	});
});

describe('alarm screens', () => {
	it('scrolls 1..5 and the hourly signal, wrapping both ways', () => {
		// The screens are positions 0..5 holding slots 1..5 and then the signal. Position and slot
		// number are deliberately not the same thing, which is exactly what a first draft got wrong:
		// it stored a slot number in a position field and advanced two screens at a time.
		assert.deepEqual([0, 1, 2, 3, 4, 5].map(alarmScreenAt), [1, 2, 3, 4, 5, 0]);
		assert.equal(alarmScreenAt(6), 1, 'past the signal comes alarm 1 again');

		assert.equal(stepAlarmPosition(0, 1), 1, 'position 0 is alarm 1, so +1 is alarm 2');
		assert.equal(stepAlarmPosition(4, 1), 5, 'past alarm 5 comes the hourly signal');
		assert.equal(stepAlarmPosition(5, 1), 0, 'and past it comes alarm 1 again');
		assert.equal(stepAlarmPosition(0, -1), 5);
		assert.equal(stepAlarmPosition(5, -1), 4);
	});

	it('round-trips a slot through its position', () => {
		for (const slot of [1, 2, 3, 4, 5, 0]) {
			assert.equal(alarmScreenAt(alarmPosition(slot)), slot);
		}
	});
});

describe('alarm repair (PRS-4)', () => {
	it('falls back to five off alarms from nothing', () => {
		for (const input of [null, undefined, 42, 'nonsense', []]) {
			const repaired = repairAlarms(input);
			assert.equal(repaired.defs.length, ALARM_COUNT, `input ${JSON.stringify(input)}`);
			assert.equal(anyArmed(repaired), false);
		}
	});

	it('keeps the alarms it can read and repairs the rest', () => {
		const repaired = repairAlarms({
			defs: [
				{ id: 2, hour: 6, minute: 15, mode: 'daily' },
				{ id: 4, hour: 99, minute: 15, mode: 'daily' },
				{ id: 5, hour: 8, minute: 0, mode: 'nonsense' },
			],
			signal: true,
		});
		assert.equal(alarmById(repaired, 2)?.hour, 6);
		// An out-of-range hour falls back rather than being clamped to 23, because a clamped hour is
		// a different alarm time and would fire unexpectedly.
		assert.equal(alarmById(repaired, 4)?.hour, 7);
		assert.equal(alarmById(repaired, 5)?.mode, 'off');
		assert.equal(repaired.signal, true);
	});

	it('places alarms by id rather than by position', () => {
		// A reordered file must still put alarm 3's time on alarm 3's screen.
		const repaired = repairAlarms({
			defs: [
				{ id: 3, hour: 5, minute: 45, mode: 'once' },
				{ id: 1, hour: 9, minute: 5, mode: 'daily' },
			],
		});
		assert.equal(alarmById(repaired, 3)?.hour, 5);
		assert.equal(alarmById(repaired, 1)?.hour, 9);
		assert.equal(alarmById(repaired, 2)?.mode, 'off');
	});

	it('drops a repeated id rather than creating a sixth alarm', () => {
		const repaired = repairAlarms({
			defs: [
				{ id: 1, hour: 5, minute: 0, mode: 'daily' },
				{ id: 1, hour: 6, minute: 0, mode: 'daily' },
			],
		});
		assert.equal(repaired.defs.length, ALARM_COUNT);
		// The first match wins, which is deterministic and therefore testable.
		assert.equal(alarmById(repaired, 1)?.hour, 5);
	});
});
