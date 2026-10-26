import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const source = async (name) => readFile(new URL(`src/${name}`, root), 'utf8');

test('mobile: image tools hand ordinary taps to the lightbox', async () => {
	const text = await source('image-tools.ts');
	assert.match(text, /Platform\.isMobile && this\.plugin\.settings\.imageLightbox/);
	assert.match(text, /Platform\.isMobile && controller\.plugin\.settings\.imageLightbox/);
	assert.match(text, /openLightbox\(img\.src,context\.ref\.alt,img\.ownerDocument\)/);
});

test('mobile: lightbox uses Pointer Events and pinch zoom', async () => {
	const text = await source('lightbox.ts');
	for (const event of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
		assert.match(text, new RegExp(`addEventListener\\("${event}"`));
	}
	assert.match(text, /const pointers = new Map<number/);
	assert.match(text, /function beginPinch\(\)/);
	assert.match(text, /zoomAt\(\(pinch\.scale \* distance\) \/ pinch\.distance/);
});

test('mobile: settings hide desktop-only controls', async () => {
	const text = await source('settings.ts');
	assert.match(text, /visible: \(\) => !Platform\.isMobile/);
	assert.match(text, /visible: \(\) => this\.plugin\.settings\.linkCard && !Platform\.isMobile/);
});

test('mobile: narrow cascade becomes a bounded vertical menu', async () => {
	const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
	assert.match(css, /@media \(max-width: 600px\) \{[\s\S]*?\.fl-cascade \{/);
	assert.match(css, /flex-direction: column/);
	assert.match(css, /width: min\(320px, calc\(100vw - 16px\)\)/);
	assert.match(css, /max-height: calc\(100dvh - 16px\)/);
});
