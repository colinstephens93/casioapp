/**
 * M0 scaffold renderer.
 *
 * Its only job is to prove three things reached the renderer intact: the preload bridge
 * (contextIsolation on, nodeIntegration off), the transparent window, and the ES-module
 * pipeline. The case, LCD and screens replace this in M2.
 */

export interface WidgetApi {
	ping: () => string;
}

declare global {
	interface Window {
		widget?: WidgetApi;
	}
}

const root = document.getElementById('root');

if (root) {
	const bridge = typeof window.widget?.ping === 'function' ? window.widget.ping() : 'no bridge';

	root.innerHTML = `
		<div class="gate">
			<div class="title">M0 GATE</div>
			<div class="line">frameless + transparent + draggable</div>
			<div class="line">preload bridge: ${bridge}</div>
		</div>
	`;
}
