import { app, BrowserWindow } from 'electron';
import * as path from 'node:path';

/**
 * M0 scaffold: an empty frameless, transparent window.
 *
 * Deliberately minimal. Window citizenship (tray, taskbar suppression, always-on-top and
 * position persistence) is M1; the case and LCD are M2. This file exists to prove the build
 * and launch pipeline works.
 *
 * Compiled as CommonJS (`.cts` -> `.cjs`) because Electron's main process is CommonJS. The
 * package is `"type": "module"` for the benefit of the shared logic and the tests, so the
 * extension is what keeps this file loadable.
 */

// A transparent window with no GPU compositing can render black on Windows.
app.commandLine.appendSwitch('enable-transparent-visuals');

let mainWindow: BrowserWindow | null = null;

function createWindow(): BrowserWindow {
	const window = new BrowserWindow({
		width: 520,
		height: 300,
		frame: false,
		transparent: true,
		resizable: true,
		hasShadow: false,
		show: false,
		backgroundColor: '#00000000',
		webPreferences: {
			preload: path.join(__dirname, '..', 'preload', 'preload.cjs'),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	});

	window.once('ready-to-show', () => {
		window.show();
		// Single one-shot diagnostic, so a smoke test can tell a real run from a silent failure.
		// WIN-10 forbids idle work, so nothing here repeats or polls.
		console.log(`M0 ready: window shown (electron ${process.versions['electron'] ?? 'unknown'})`);
	});

	window.on('closed', () => {
		mainWindow = null;
	});

	void window.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

	return window;
}

void app.whenReady().then(() => {
	mainWindow = createWindow();

	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			mainWindow = createWindow();
		}
	});
});

app.on('window-all-closed', () => {
	app.quit();
});
