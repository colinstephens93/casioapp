/**
 * Windows notifications, in the alarm category.
 *
 * The payload is decided in `notify.ts`, which is pure and unit-tested with no desktop. This file is
 * the part that talks to Electron: constructing the `Notification`, wiring its click back to the
 * window, and reporting whether the toast was actually shown.
 *
 * Requirements ALM-10, ALM-11.
 */
import { Notification } from 'electron';

import type { NotificationPayload, NotificationRequest } from './notify.ts' with {
	'resolution-mode': 'import',
};

/**
 * The pure half, loaded dynamically.
 *
 * `notify.ts` is **ESM** — that is what makes it unit-testable — while this file is CommonJS, because
 * Electron's main process is. A dynamic `import()` is the one construct that works in both directions,
 * so the pure modules are reached this way rather than by a static `import`. The load starts at module
 * scope and is awaited before the first toast; both functions are pure and synchronous, so the only
 * cost is a promise on the startup path.
 */
const pure = import('./notify.js');

export interface NotifierOptions {
	/** Bring the widget forward when a toast is clicked. */
	readonly onClick?: () => void;
	/** Called when the platform refuses to show a toast, so the face animation can carry the alarm. */
	readonly onUnsupported?: (reason: string) => void;
}

/**
 * Shows alarm toasts.
 *
 * ## Why "unsupported" is reported rather than swallowed
 *
 * Windows suppresses or drops toasts for reasons this process cannot see: Focus Assist being on,
 * notifications disabled for the app, a missing AppUserModelID, or the shell simply not running it.
 * Requirement ALM-11 pairs the notification with an on-face animation precisely so the alarm is still
 * visible when the toast is not — so a failure here must be *reported*, not swallowed, or nobody will
 * know which of the two mechanisms is doing the work.
 */
export class Notifier {
	private readonly options: NotifierOptions;

	constructor(options: NotifierOptions = {}) {
		this.options = options;
	}

	/** True when the platform can show toasts at all. */
	get supported(): boolean {
		return Notification.isSupported();
	}

	/**
	 * Raises a toast for an alert.
	 *
	 * Returns true when the toast was handed to the shell. That is not the same as "the user saw it":
	 * Focus Assist can still suppress it, which is the whole point of the `alarm` scenario and is not
	 * observable from here.
	 */
	async show(request: NotificationRequest, at: Date, homeOffsetMinutes: number): Promise<boolean> {
		if (!this.supported) {
			this.options.onUnsupported?.('the platform reports no notification support');
			return false;
		}

		const { notificationFor, toastXmlFor } = await pure;
		const payload: NotificationPayload = notificationFor(request, at, homeOffsetMinutes);
		const notification = new Notification({
			title: payload.title,
			body: payload.body,
			// ALM-10. The `alarm` scenario is a **Windows toast XML attribute**, not an Electron option —
			// `NotificationConstructorOptions` has no `scenario` — so the toast is described as XML and
			// handed over whole. See `toastXmlFor`.
			toastXml: toastXmlFor(payload),
			// Kept as the native options too, for the parts Electron does model: `silent` is honoured
			// directly, and `timeoutType: 'never'` is the non-XML expression of the same intent.
			timeoutType: payload.requireInteraction ? 'never' : 'default',
			silent: payload.silent,
		});

		notification.on('click', () => this.options.onClick?.());
		notification.on('failed', (_event, error) => {
			// Electron emits this when the shell refuses the toast, which is the case ALM-11's face
			// animation exists to cover.
			this.options.onUnsupported?.(String(error));
		});

		notification.show();
		return true;
	}
}
