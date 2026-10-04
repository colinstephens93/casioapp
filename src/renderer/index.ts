/**
 * The widget page.
 *
 * The window around this page is the desktop shell. What it shows is the world-time board: the
 * same arrangement as the Timan terminal, drawn as HTML so it can be dragged and resized without
 * a console. The watch face is still what the preview page draws; this file no longer uses it.
 */
import { renderBoard } from './board.ts';
import {
	cycleDst,
	focusRow,
	moveFavorite,
	moveSelection,
	parseDesk,
	serialiseDesk,
	toggleClock,
	toggleFavorite,
	type DeskResult,
	type DeskState,
} from '../shared/desk.ts';
import { localZone } from '../shared/time.ts';
import type { RestoredState } from '../preload/preload.cts';

interface WidgetBridge {
	saveState(serialised: string): void;
	restore(): Promise<RestoredState>;
	showMenu(): void;
	setSize(width: number, height: number): void;
}

declare global {
	interface Window {
		widget?: WidgetBridge;
	}
}

interface BatteryReading {
	level: number;
	charging: boolean;
}

const SAVED_KEY = 'worldtime.desk';

function readSaved(): string {
	try {
		return localStorage.getItem(SAVED_KEY) ?? '';
	} catch {
		return '';
	}
}

function writeSaved(serialised: string): void {
	try {
		localStorage.setItem(SAVED_KEY, serialised);
	} catch {
		// A blocked store just means the next open starts from the defaults.
	}
}

function clampSize(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, Math.round(value)));
}

function powerLine(battery: BatteryReading | null): string {
	if (!battery) {
		return '';
	}
	const percent = `${Math.round(battery.level * 100)}%`;
	return battery.charging ? `${percent} BATTERY · CHARGING` : `${percent} · BATTERY`;
}

async function main(): Promise<void> {
	const desk = document.getElementById('desk');
	const board = document.getElementById('board');
	const grip = document.getElementById('resize');
	if (!desk || !board || !grip) {
		return;
	}

	const bridge = window.widget;
	// The desktop shortcut opens this page in Edge, which has no preload bridge. The board is
	// kept in localStorage there. Electron still saves through the bridge, into the config file.
	const restored: RestoredState = bridge
		? await bridge.restore().catch(() => ({ watch: '', battery: 1, configPath: '' }))
		: { watch: readSaved(), battery: 1, configPath: '' };

	let state: DeskState = parseDesk(restored.watch);
	let notice = '';
	let noticeTimer = 0;
	let battery: BatteryReading | null = null;
	let scrollTop = 0;

	// `follow` scrolls the selection into view. A one-second repaint must not, or the list jumps
	// back while the user is reading a city further down.
	const paint = (follow: boolean): void => {
		const held = board.querySelector('.list')?.scrollTop ?? scrollTop;
		board.innerHTML = renderBoard(state, new Date(), localZone(), powerLine(battery), notice);
		const list = board.querySelector('.list');
		if (!list) {
			return;
		}
		if (follow) {
			list.querySelector('.row.selected')?.scrollIntoView({ block: 'nearest' });
		} else {
			list.scrollTop = held;
		}
		scrollTop = list.scrollTop;
	};

	const persist = (): void => {
		const serialised = serialiseDesk(state);
		if (bridge) {
			bridge.saveState(serialised);
			return;
		}
		writeSaved(serialised);
	};

	const commit = (result: DeskResult): void => {
		state = result.state;
		notice = result.notice;
		window.clearTimeout(noticeTimer);
		if (notice) {
			noticeTimer = window.setTimeout(() => {
				notice = '';
				paint(false);
			}, 2500);
		}
		persist();
		paint(true);
	};

	const apply = (result: DeskState): void => {
		commit({ state: result, notice: '' });
	};

	desk.addEventListener('click', (event) => {
		const target = event.target;
		if (!(target instanceof Element)) {
			return;
		}
		const action = target.closest('[data-action]');
		if (action instanceof HTMLElement) {
			const name = action.dataset['action'];
			if (name === 'clock') {
				apply(toggleClock(state));
			} else if (name === 'favorite') {
				commit(toggleFavorite(state, localZone()));
			} else if (name === 'dst') {
				commit(cycleDst(state, localZone(), new Date()));
			}
			return;
		}
		const row = target.closest('[data-where]');
		if (!(row instanceof HTMLElement)) {
			return;
		}
		const where = row.dataset['where'];
		if (where !== 'local' && where !== 'favorite' && where !== 'catalog') {
			return;
		}
		apply(focusRow(state, where, row.dataset['zone'] ?? ''));
	});

	window.addEventListener('keydown', (event) => {
		if (event.altKey || event.ctrlKey || event.metaKey) {
			return;
		}
		const local = localZone();
		const at = new Date();
		switch (event.key) {
			case 'ArrowUp':
				event.preventDefault();
				apply(moveSelection(state, local, -1));
				return;
			case 'ArrowDown':
				event.preventDefault();
				apply(moveSelection(state, local, 1));
				return;
			case 'ArrowLeft':
				event.preventDefault();
				apply(moveFavorite(state, local, -1));
				return;
			case 'ArrowRight':
				event.preventDefault();
				apply(moveFavorite(state, local, 1));
				return;
			case 'f':
			case 'F':
				commit(toggleFavorite(state, local));
				return;
			case 'd':
			case 'D':
				commit(cycleDst(state, local, at));
				return;
			case 't':
			case 'T':
				apply(toggleClock(state));
				return;
			default:
				return;
		}
	});

	desk.addEventListener('contextmenu', (event) => {
		if (!bridge) {
			return;
		}
		event.preventDefault();
		bridge.showMenu();
	});

	grip.addEventListener('pointerdown', (event) => {
		event.preventDefault();
		grip.setPointerCapture(event.pointerId);
		const origin = { x: event.screenX, y: event.screenY, w: window.outerWidth, h: window.outerHeight };
		const move = (ev: PointerEvent): void => {
			const width = clampSize(origin.w + ev.screenX - origin.x, 760, 1100);
			const height = clampSize(origin.h + ev.screenY - origin.y, 540, 780);
			if (bridge) {
				bridge.setSize(width, height);
			} else {
				window.resizeTo(width, height);
			}
		};
		const up = (ev: PointerEvent): void => {
			grip.removeEventListener('pointermove', move);
			grip.removeEventListener('pointerup', up);
			grip.releasePointerCapture(ev.pointerId);
		};
		grip.addEventListener('pointermove', move);
		grip.addEventListener('pointerup', up);
	});

	const pollBattery = (): void => {
		const reader = navigator as Navigator & { getBattery?: () => Promise<BatteryReading> };
		if (!reader.getBattery) {
			return;
		}
		void reader.getBattery().then((next) => {
			battery = { level: next.level, charging: next.charging };
			paint(false);
		}).catch(() => {
			battery = null;
		});
	};

	paint(true);
	// An old watch-face blob is not this board. Replace it once, so the next launch reads the board
	// and not a payload this page will only ignore.
	if (serialiseDesk(state) !== restored.watch) {
		persist();
	}
	pollBattery();
	window.setInterval(pollBattery, 30_000);

	const tick = (): void => {
		paint(false);
		window.setTimeout(tick, 1000 - (Date.now() % 1000) + 20);
	};
	window.setTimeout(tick, 1000 - (Date.now() % 1000) + 20);
}

void main();
