/**
 * The shape file of each item and static-shape datablock placed in the missions,
 * copied from the `datablock` declarations in `bor/server/scripts`.
 */
export const SHAPE_DATABLOCKS: Readonly<Record<string, string>> = {
    boostpad: '~/data/arrowpad.dts',
    frogblock: '~/data/shapes/critters/frogskin.dts',
    boulderShooter: '~/data/shapes/items/ballshoot.dts',
    snowballshooter: '~/data/shapes/items/ballshoot.dts',
    boulderdata: '~/data/shapes/items/boulder.dts',
    snowballdata: '~/data/shapes/items/snowball.dts',
    bbdustdevil: '~/data/shapes/items/bbtornado.dts',
    bbwaterfunnel: '~/data/shapes/items/watertornado.dts',
    flag: '~/data/shapes/flagpole/flagpole.dts',
    cactus: '~/data/shapes/trees/cactus.dts',
    healthkit: '~/data/shapes/items/apple.dts',
    rocketlauncher: '~/data/shapes/rocket/rocketlauncher.dts',
    bomblauncher: '~/data/shapes/rocket/rocketlauncher.dts',
    rocketammo: '~/data/shapes/rocket/zinger.dts',
    bombammo: '~/data/shapes/items/bomb.dts',
    spitammo: '~/data/shapes/rocket/zingerammo.dts',
};

/**
 * Returns the shape file for a datablock name (case-insensitive), or `undefined` when it has none.
 */
export function shapeForDatablock(name: string): string | undefined {
    const key = name.toLowerCase();
    for (const [k, v] of Object.entries(SHAPE_DATABLOCKS)) {
        if (k.toLowerCase() === key) return v;
    }
    return undefined;
}
