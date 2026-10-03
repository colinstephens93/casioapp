import { contextBridge } from 'electron';

/**
 * M0 scaffold: the preload bridge.
 *
 * Intentionally exposes almost nothing. The real surface (config read/write, notification
 * dispatch, window control) arrives with the features that need it, so that no IPC channel
 * exists before a requirement asks for it.
 *
 * Compiled as CommonJS (`.cts` -> `.cjs`), matching Electron's preload environment.
 */
const api = {
	/** Placeholder so the renderer can confirm the bridge is live. */
	ping: (): string => 'pong',
};

contextBridge.exposeInMainWorld('widget', api);
