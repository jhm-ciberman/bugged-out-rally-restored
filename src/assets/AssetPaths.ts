let manifest: ReadonlySet<string> | null = null;

/**
 * Downloads the list of shipped asset files. Call once before {@link resolveTorqueFile}.
 */
export async function loadAssetManifest(): Promise<void> {
    const res = await fetch(assetUrl('manifest.json'));
    manifest = new Set<string>((await res.json()) as string[]);
}

/**
 * Returns the URL of a file under `public/assets`, given its path relative to that folder.
 */
export function assetUrl(relativePath: string): string {
    return `${import.meta.env.BASE_URL}assets/${relativePath.toLowerCase()}`;
}

/**
 * Finds the shipped file for a Torque data path, such as `~/data/skies/day_0001`
 * or `safarirace/data/terrains/grassland/grass`, and returns its URL.
 *
 * When the path has no extension, the extensions in `extensions` are tried in order,
 * like the engine does. Returns `null` when no file matches.
 */
export function resolveTorqueFile(torquePath: string, extensions: readonly string[] = ['.png', '.jpg']): string | null {
    if (!manifest) throw new Error('Asset manifest not loaded');
    let path = torquePath.replace(/\\/g, '/').toLowerCase();
    path = path
        .replace(/^~\//, '')
        .replace(/^[a-z]+\/data\//, 'data/')
        .replace(/^(bor|safarirace)\//, '');
    const candidates = /\.[a-z0-9]{2,4}$/.test(path) ? [path] : extensions.map((e) => path + e);
    for (const c of candidates) {
        if (manifest.has(c)) return assetUrl(c);
    }
    return null;
}

/**
 * Returns the asset path (relative to `public/assets`) of the first shipped file named `fileName`
 * (case-insensitive), or `null`.
 */
export function findAssetByName(fileName: string): string | null {
    if (!manifest) throw new Error('Asset manifest not loaded');
    const name = fileName.toLowerCase();
    for (const path of manifest) {
        if (path === name || path.endsWith(`/${name}`)) return path;
    }
    return null;
}

/**
 * Whether a file exists under `public/assets` (path relative to that folder).
 */
export function hasAsset(relativePath: string): boolean {
    if (!manifest) throw new Error('Asset manifest not loaded');
    return manifest.has(relativePath.toLowerCase());
}
