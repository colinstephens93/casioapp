/**
 * What an alarm notification says, and in which Windows notification *category*.
 *
 * Self-contained like `config.cts`, and for the same reason: main is CommonJS and `src/shared` is
 * compiled to ESM for the renderer, so main imports only Node built-ins. Everything decidable about
 * the payload is decided here, so it can be tested with no desktop and no notification service.
 *
 * ## The scenario is the requirement
 *
 * ALM-10 asks for the notification to be "registered in the alarm category so Windows Focus Assist /
 * Do Not Disturb is respected". That is a specific, real thing on Windows: the toast's **scenario**
 * field. `scenario: 'alarm'` tells the shell the toast is an alarm rather than a chat message, which
 * changes three behaviours:
 *
 * - it is allowed through Focus Assist's priority rules in ways an ordinary toast is not;
 * - it is shown on the lock screen when the machine is locked;
 * - it stays until dismissed rather than expiring on the usual timer.
 *
 * A toast with no scenario is a plain notification and *is* suppressed by Focus Assist. So the
 * scenario is the requirement rather than decoration, and it is asserted rather than left to a caller
 * to remember.
 *
 * ## Why a test alarm raises nothing
 *
 * ALM-6 gives `SEARCH`-hold a test alarm, and routing it through here would be easy. It should not be.
 * ALM-12 makes audible output an explicit off-by-default setting, and the *purpose* of a test alarm is
 * to check the watch, not to interrupt the desktop. A toast on every test would also train the user to
 * dismiss this app's notifications without reading them — which is how the real alarm ends up ignored.
 *
 * Requirements ALM-7, ALM-10, ALM-11, ALM-12, TMR-6.
 */

/** Windows' AppUserModelID for the widget. */
/**
 * A toast from a process with no AppUserModelID may be dropped entirely, or attributed to
 * `electron.exe` — in which case Focus Assist, the notification centre and the quiet-hours rules all
 * apply to the wrong identity. Setting it is a precondition for ALM-10, not a nicety, and it must
 * match the identifier `electron-builder` stamps into the installed shortcut, or the toast and the app
 * are two different things as far as the shell is concerned.
 *
 * The value is duplicated in `electron-builder.yml` **deliberately**: the build config cannot import
 * TypeScript, and a mismatch is silent. `docs/ENVIRONMENT.md` records the pairing so it can be
 * checked by hand.
 */
export const APP_USER_MODEL_ID = 'com.casioapp.royale';

/** The window's title, used by the tray. */
export const APP_TITLE = 'casioapp — world clock';

export interface NotificationRequest {
	readonly kind: 'alarm' | 'timer';
	/** Which of the five alarms, for the body text. Absent for the countdown. */
	readonly alarmId?: number;
}

/** An Electron-ready toast description, before the main process turns it into XML. */
export interface NotificationPayload {
	/** Windows' notification category. `alarm` is what makes Focus Assist behave. */
	readonly scenario: 'alarm';
	readonly title: string;
	readonly body: string;
	/** True when the toast stays until dismissed. An alarm is not a status update. */
	readonly requireInteraction: boolean;
	/** True when the toast is silent. The widget is silent by default (ALM-12). */
	readonly silent: boolean;
}

/**
 * Builds the Windows toast XML for a payload.
 *
 * ## Why XML, and not an Electron option
 *
 * There is no `scenario` option on Electron's `Notification` — it is an attribute of the **Windows
 * toast XML**, and Electron passes a `toastXml` string straight to the shell. Writing the XML is
 * therefore not a workaround; it is the only way to reach the attribute ALM-10 names.
 *
 * The document is small and its structure is fixed by Windows:
 *
 * ```xml
 * <toast scenario="alarm" activationType="foreground">
 *   <visual><binding template="ToastGeneric">
 *     <text>title</text><text>body</text>
 *   </binding></visual>
 *   <actions><action content="" arguments="dismiss" activationType="foreground"/></actions>
 * </toast>
 * ```
 *
 * Two details are load-bearing rather than decorative:
 *
 * - **`scenario="alarm"`** is ALM-10. It is what tells the shell this is an alarm, so Focus Assist's
 *   ordinary suppression does not apply, the toast is shown on the lock screen, and it persists rather
 *   than expiring.
 * - **the `<actions>` element** is what makes the toast stay. Windows keeps an alarm toast on screen
 *   until it is acted on, and a toast with no actions is subject to the standard timeout — so the
 *   requirement's "10 seconds, or until any button" is honoured by the *face animation* while the
 *   toast remains as the record.
 *
 * The text is XML-escaped. A city name or an alarm number cannot contain markup, but the escaping is
 * what keeps that true rather than assuming it.
 */
export function toastXmlFor(payload: NotificationPayload): string {
	return [
		`<toast scenario="${payload.scenario}" activationType="foreground">`,
		'<visual><binding template="ToastGeneric">',
		`<text>${escapeXml(payload.title)}</text>`,
		`<text>${escapeXml(payload.body)}</text>`,
		'</binding></visual>',
		'<actions><action content="" arguments="dismiss" activationType="foreground"/></actions>',
		'</toast>',
	].join('');
}

/** Escapes the five characters that are not literal text in XML. */
function escapeXml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

/**
 * `HH:MM:SS` in the Home City, from an absolute instant and that city's offset in minutes.
 *
 * Computed here from the offset rather than through `src/shared/time.ts`, because main cannot import
 * the ESM build — and the arithmetic is two lines. The offset is supplied by the renderer along with
 * the alert, so the notification names the time the *watch* is showing rather than re-deriving a zone
 * in a process that has no business knowing about zones.
 */
function homeClock(at: Date, homeOffsetMinutes: number): string {
	const wall = new Date(at.getTime() + homeOffsetMinutes * 60_000);
	const pad = (value: number): string => String(value).padStart(2, '0');
	return `${pad(wall.getUTCHours())}:${pad(wall.getUTCMinutes())}:${pad(wall.getUTCSeconds())}`;
}

/**
 * Builds the toast for an alert.
 *
 * The body names the time because the notification is a record of something that already happened and
 * the user may see it minutes later: "Alarm 3" alone does not say when it fired, and naming the time
 * makes the toast useful on return.
 */
export function notificationFor(
	request: NotificationRequest,
	at: Date,
	homeOffsetMinutes: number,
): NotificationPayload {
	const time = homeClock(at, homeOffsetMinutes);

	if (request.kind === 'timer') {
		return {
			scenario: 'alarm',
			title: 'Countdown finished',
			body: `The timer reached zero at ${time}.`,
			requireInteraction: true,
			silent: true,
		};
	}

	const number = request.alarmId ?? 1;
	return {
		scenario: 'alarm',
		title: `Alarm ${number}`,
		body: `Alarm ${number} sounded at ${time}.`,
		requireInteraction: true,
		silent: true,
	};
}
