/**
 * The widget's renderer entry point.
 *
 * This is the whole watch. It builds a `WatchController` and draws it — the **same object the browser
 * preview runs**, which is plan decision 1 and the reason nearly everything in this project is
 * verifiable in a sandbox with no desktop.
 *
 * What this file adds over the preview is only what a real widget needs:
 *
 * - persistence through the preload bridge, so the settings are a file a human can edit (PRS-4) rather
 *   than `localStorage` inside a browser profile;
 * - notifications, by telling the main process when an alert fires (ALM-10);
 * - the letterboxed layout (WIN-7, WIN-8) and the drag region (WIN-2);
 * - the native context menu (INT-7).
 *
 * ## Why the face is redrawn wholesale
 *
 * The same reasoning as the preview: the face is a few hundred SVG elements, and redrawing it costs
 * nothing measurable at the tick rates the controller chooses. Diffing would add a second code path
 * that could disagree with the first. WIN-10 is satisfied by the *cadence* rather than by the redraw:
 * an idle clock ticks once a second and does no other work.
 *
 * ## Why the pushers are wired by class rather than by element
 *
 * The face is regenerated on every tick, so any listener attached to a pusher element is discarded a
 * second later. Events are therefore delegated from a container that survives — and the hit test is on
 * the SVG's own class names, which is what the geometry was authored for.
 */
import { WatchController } from '../shared/controller.ts';
import { renderFace } from './face.ts';
import type { ContextAction, RestoredState } from '../preload/preload.cts';

/** The preload bridge, as `preload.cts` exposes it. Absent when the page is opened in a browser. */
interface WidgetBridge {
	alert(message: {
		kind: 'alarm' | 'timer';
		alarmId?: number;
		at: number;
		homeOffset: number;
	}): void;
	saveState(serialised: string): void;
	restore(): Promise<RestoredState>;
	/** INT-7: the page cannot pop a native menu, so it asks the main process for one. */
	showMenu(): void;
	onContext(listener: (action: ContextAction) => void): () => void;
}

declare global {
	interface Window {
		widget?: WidgetBridge;
	}
}

const PUSHERS = ['adjust', 'light', 'mode', 'search'] as const;
type Pusher = (typeof PUSHERS)[number];

/** True when the name is one of the four pushers, so an untyped hit test result is narrowed safely. */
function isPusher(name: string | null): name is Pusher {
	return name !== null && (PUSHERS as readonly string[]).includes(name);
}

/**
 * A store that writes through the preload bridge, so the settings land in the config file.
 *
 * The controller's `WatchStore` is `load`/`save` returning and taking a string, and the main process
 * treats that string as opaque. That is deliberate: the watch's schema is the renderer's business, and
 * the main process has no reason to parse it — which is also why a corrupt watch blob cannot stop the
 * widget from starting.
 */
function bridgeStore(bridge: WidgetBridge | undefined, initial: string) {
	let value = initial;
	return {
		load: (): string | null => value,
		save: (next: string): void => {
			value = next;
			bridge?.saveState(next);
		},
	};
}

async function main(): Promise<void> {
	// The case is the wrapper that letterboxes; the SVG goes inside it. Neither exists until this runs,
	// which is why the entry point resolves and checks rather than assuming.
	const host = document.getElementById('case');
	if (!host) {
		return;
	}

	const bridge = window.widget;
	const restored: RestoredState = bridge
		? await bridge.restore().catch(() => ({ watch: '', battery: 1, configPath: '' }))
		: { watch: '', battery: 1, configPath: '' };

	const watch = new WatchController({
		now: () => Date.now(),
		// `performance.now()` is monotonic, which is what the stopwatch needs: a wall-clock correction
		// must not change how long something took (NFR-5, plan decision 5).
		mono: () => performance.now(),
		setTimer: (fn, ms) => {
			const handle = setTimeout(fn, ms);
			return () => clearTimeout(handle);
		},
		store: bridgeStore(bridge, restored.watch),
		notify: (alert) => {
			// ALM-10. The renderer knows *that* an alarm fired and what the Home City reads; the main
			// process phrases the toast. Sending the offset rather than re-deriving a zone means the
			// notification and the face cannot disagree about the time.
			const face = watch.faceState();
			bridge?.alert({
				kind: alert.kind === 'timer' ? 'timer' : 'alarm',
				...(alert.alarmId === undefined ? {} : { alarmId: alert.alarmId }),
				at: Date.now(),
				homeOffset: face.homeOffset,
			});
		},
	});

	// BAT-4: the level was stored with the rest of the configuration.
	watch.setBattery(restored.battery);

	const draw = (): void => {
		// The whole face, replaced. See the module comment for why this is not diffed.
		host.innerHTML = renderFace(watch.faceState());
	};

	watch.subscribe(() => {
		draw();
		// PRS-1: persist on every change the controller reports. A tick does not change anything worth
		// saving, and the controller does not emit for one.
		watch.save();
	});

	/* ---------------------------------------------------------------------------------------- */
	/* Pushers (WIN-2, INT-4, INT-8)                                                             */
	/* ---------------------------------------------------------------------------------------- */

	/**
	 * The pusher under the pointer.
	 *
	 * `closest` walks up from the event target, and the SVG pushers carry `pusher-<name>` classes. The
	 * hit area is the bar, which is what the user sees — not the whole case edge.
	 */
	function pusherAt(target: EventTarget | null): Pusher | null {
		if (!(target instanceof Element)) {
			return null;
		}
		for (const pusher of PUSHERS) {
			if (target.closest(`.pusher-${pusher}`)) {
				return pusher;
			}
		}
		return null;
	}

	// Pointer capture, so a press that slides off the pusher still releases it. Without this the
	// controller would hold a pusher down forever and the gesture reader would eventually fire a hold.
	let active: Pusher | null = null;

	host.addEventListener('pointerdown', (event) => {
		const pusher = pusherAt(event.target);
		if (!pusher) {
			return;
		}
		event.preventDefault();
		active = pusher;
		watch.down(pusher);
	});

	const release = (event: PointerEvent): void => {
		if (active === null) {
			return;
		}
		void event;
		watch.up(active);
		active = null;
	};
	host.addEventListener('pointerup', release);
	host.addEventListener('pointercancel', release);
	// A press that leaves the window entirely — dragged onto another display mid-gesture — must not
	// leave the controller believing the pusher is still down.
	window.addEventListener('blur', () => {
		watch.cancelGestures();
		active = null;
	});

	/* ---------------------------------------------------------------------------------------- */
	/* The context menu (INT-7)                                                                  */
	/* ---------------------------------------------------------------------------------------- */

	// The native menu is shown by the main process; the page only asks for it, because a right-click on
	// the case is the trigger and `contextmenu` is the only event that sees it. A page cannot pop a
	// native menu itself, which is why this is a bridge call rather than a DOM one.
	window.addEventListener('contextmenu', (event) => {
		event.preventDefault();
		bridge?.showMenu();
	});

	bridge?.onContext((action: ContextAction) => {
		// The tray and the context menu both route their watch-affecting actions here, so there is one
		// implementation of each rather than one per menu.
		watch.contextAction(action);
	});

	watch.start();
}

void main();
