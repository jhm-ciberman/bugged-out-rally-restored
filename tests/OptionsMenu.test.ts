import { afterEach, describe, expect, it, vi } from 'vitest';
import { OptionsMenu } from '../src/ui/menus/OptionsMenu';

vi.mock('../src/assets/AssetPaths', () => ({ assetUrl: (path: string) => path }));

describe('OptionsMenu', () => {
    let created: { style: Record<string, string> }[];

    function openOn(search: string): void {
        created = [];
        const page = Object.assign(new EventTarget(), { innerWidth: 844, innerHeight: 390, location: { search } });
        vi.stubGlobal('window', Object.assign(page, { parent: page }));
        vi.stubGlobal(
            'Image',
            class {
                src = '';
                decode = () => Promise.resolve();
            },
        );
        vi.stubGlobal(
            'document',
            Object.assign(new EventTarget(), {
                fullscreenElement: null,
                documentElement: {},
                createElement: () => {
                    const style = { setProperty: () => undefined };
                    const element = Object.assign(new EventTarget(), {
                        style,
                        append: () => undefined,
                        getContext: () => null,
                    });
                    created.push(element as never);
                    return element;
                },
            }),
        );
        new OptionsMenu(
            () => undefined,
            () => undefined,
            () => undefined,
        );
    }

    const hasButton = (art: string) => created.some((e) => e.style.background?.includes(`client/ui/${art}_n.png`));

    afterEach(() => vi.unstubAllGlobals());

    it('offers the controls menu with a keyboard', () => {
        openOn('');
        expect(hasButton('control')).toBe(true);
    });

    it('leaves out the controls menu in touch mode, which has no keys to bind', () => {
        openOn('?touch');
        expect(hasButton('control')).toBe(false);
    });

    it('keeps the back button in touch mode', () => {
        openOn('?touch');
        expect(hasButton('back')).toBe(true);
    });
});
