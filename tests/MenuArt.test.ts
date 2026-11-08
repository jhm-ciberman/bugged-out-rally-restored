import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const root = path.resolve(import.meta.dirname, '..');
const menus = path.join(root, 'src/ui/menus');
const menuCode = [
    ...fs.readdirSync(menus).map((file) => path.join(menus, file)),
    path.join(root, 'src/ui/FinishScreen.ts'),
    path.join(root, 'src/ui/GuiControls.ts'),
]
    .map((file) => fs.readFileSync(file, 'utf8'))
    .join('\n');

describe('preloadMenuArt', () => {
    let requested: string[];
    let decode: () => Promise<void>;

    async function preloadMenuArt(): Promise<void> {
        const module = await import('../src/ui/menus/MenuArt');
        module.preloadMenuArt();
    }

    beforeEach(() => {
        vi.resetModules();
        requested = [];
        decode = () => Promise.resolve();
        vi.stubGlobal(
            'Image',
            class {
                set src(url: string) {
                    requested.push(url);
                }
                decode() {
                    return decode();
                }
            },
        );
    });
    afterEach(() => vi.unstubAllGlobals());

    it('covers every picture named by the menu code', async () => {
        await preloadMenuArt();
        const pictures = [...menuCode.matchAll(/'(?:client\/ui\/)?([\w/]+\.(?:jpg|png))'/g)].map((match) => match[1]);
        expect(pictures).toContain('mainmenu.jpg');
        for (const picture of pictures) expect(requested).toContain(`/assets/client/ui/${picture}`);
    });

    it('covers every state of every button named by the menu code', async () => {
        await preloadMenuArt();
        const buttons = [...menuCode.matchAll(/(?:\.button|bitmapButton)\('([\w/]+)'/g)].map((match) => match[1]);
        expect(buttons).toContain('start');
        for (const button of buttons) {
            for (const state of ['n', 'h', 'd', 'i']) {
                expect(requested).toContain(`/assets/client/ui/${button}_${state}.png`);
            }
        }
    });

    it('only requests files that ship with the game', async () => {
        await preloadMenuArt();
        const missing = requested.filter((url) => !fs.existsSync(path.join(root, 'public', url)));
        expect(missing).toEqual([]);
    });

    it('requests each file once, also when the game returns to the splash', async () => {
        await preloadMenuArt();
        const firstRun = requested.length;
        await preloadMenuArt();
        expect(requested).toHaveLength(firstRun);
        expect(new Set(requested).size).toBe(firstRun);
    });

    it('ignores pictures that fail to load', async () => {
        decode = () => Promise.reject(new Error('missing'));
        await expect(preloadMenuArt()).resolves.toBeUndefined();
    });
});
