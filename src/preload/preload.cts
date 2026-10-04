/**
 * The preload bridge: the renderer's entire view of the outside world.
 *
 * Requirement NFR-6 wants context isolation on, node integration off, and a **narrow** IPC surface.
 * Narrow means five named methods, each traced to the requirement that asks for it, and no generic
 * "invoke this" escape hatch — a renderer that can call arbitrary IPC is a renderer that can do
 * anything the main process can, which defeats the isolation.
 *
 * ## What is deliberately absent
 *
 * - No `send(channel, …)` passthrough. The channels are named methods, so the set is auditable.
 * - No `require`, no `process`, no `fs`. The renderer is a page that draws a watch.
 * - No window control. Show/Hide and Quit are the tray's (WIN-3), not the page's.
 *
 * ## Why CommonJS syntax rather than ESM
 *
 * This is a `.cts` file, so it is a **CommonJS** module — that is what Electron's preload environment
 * is. `verbatimModuleSyntax` enforces the match: an `import`/`export` statement in a CommonJS file is a
 * compile error, so the module system is `require` and `module.exports`. The *type* declarations are
 * still exported for the renderer and the tests to import, because TypeScript strips them either way.
 */

const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');

/** An alert the renderer wants announced. Validated again on the main side. */
interface AlertMessage {
	readonly kind: 'alarm' | 'timer';
	readonly alarmId?: number;
	/** Epoch milliseconds, as the renderer's clock saw it. */
	readonly at: number;
	/** The Home City's offset in minutes, so the toast names the same time the face shows. */
	readonly homeOffset: number;
}

/** What the main process restores on startup. */
interface RestoredState {
	/** The watch's own serialised state, or an empty string on first run. */
	readonly watch: string;
	/** The simulated battery level, 0..1 (BAT-4). */
	readonly battery: number;
	/** Where the config file lives, so a debug view can name it. */
	readonly configPath: string;
}

/** The context-menu actions the main process forwards down (INT-7). */
type ContextAction = 'mode' | 'settings' | 'battery-reset' | 'quit';

const api = {
	/** ALM-10: hand an alert to the main process, which raises the Windows toast. */
	alert: (message: AlertMessage): void => {
		ipcRenderer.send('widget:alert', message);
	},

	/** PRS-1: persist the watch's state. Opaque to the main process. */
	saveState: (serialised: string): void => {
		ipcRenderer.send('widget:state', serialised);
	},

	/** PRS-1, MOD-6: read back what was stored, on startup. */
	restore: (): Promise<RestoredState> => ipcRenderer.invoke('widget:restore') as Promise<RestoredState>,

	/** INT-7: ask for the native context menu. A page cannot pop a native menu itself. */
	showMenu: (): void => {
		ipcRenderer.send('widget:menu');
	},

	/**
	 * The corner grip. Size only: the page cannot move or close the window from here.
	 * The main process clamps the numbers.
	 */
	setSize: (width: number, height: number): void => {
		ipcRenderer.send('widget:size', { width, height });
	},

	/** INT-7: the native context menu asks the renderer to act. Returns an unsubscribe function. */
	onContext: (listener: (action: ContextAction) => void): (() => void) => {
		// Scoped to our one channel and wrapping the listener, so the renderer never receives an
		// `IpcRendererEvent` — which carries a `sender` the page has no business holding.
		const handler = (_event: unknown, action: ContextAction): void => listener(action);
		ipcRenderer.on('widget:context', handler);
		return () => {
			ipcRenderer.off('widget:context', handler);
		};
	},
};

contextBridge.exposeInMainWorld('widget', api);

// The types are for the renderer and the tests; `export {}` makes this file a module under
// `verbatimModuleSyntax` without emitting anything the preload environment would trip over.
export type { AlertMessage, ContextAction, RestoredState };
