// Copies the original game data and the extracted models from the restoration
// folder into public/assets, so the game can load them over HTTP.
//
// Usage: node scripts/import-assets.mjs [path/to/bor-restoration]
//
// Every destination path is lower-cased. Torque ran on Windows and its scripts
// reference files with inconsistent casing, while web servers are case-sensitive.

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const source = path.resolve(process.argv[2] ?? path.join(root, '..', 'bor-restoration'));
const dest = path.join(root, 'public', 'assets');

const DATA_EXTENSIONS = new Set(['.jpg', '.png', '.ogg', '.mis', '.ter', '.dml', '.ifl']);
const MODEL_EXTENSIONS = new Set(['.glb']);

let copied = 0;
let bytes = 0;

function copyTree(from, to, extensions) {
    if (!fs.existsSync(from)) {
        throw new Error(`Missing source folder: ${from}`);
    }
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        const src = path.join(from, entry.name);
        const dst = path.join(to, entry.name.toLowerCase());
        if (entry.isDirectory()) {
            if (entry.name === 'CVS') continue;
            copyTree(src, dst, extensions);
        } else if (extensions.has(path.extname(entry.name).toLowerCase())) {
            fs.mkdirSync(path.dirname(dst), { recursive: true });
            fs.copyFileSync(src, dst);
            copied++;
            bytes += fs.statSync(src).size;
        }
    }
}

fs.rmSync(dest, { recursive: true, force: true });

copyTree(path.join(source, 'game-files', 'bor', 'data'), path.join(dest, 'data'), DATA_EXTENSIONS);
copyTree(path.join(source, 'game-files', 'bor', 'client', 'ui'), path.join(dest, 'client', 'ui'), DATA_EXTENSIONS);
copyTree(path.join(source, 'game-files', 'common'), path.join(dest, 'common'), DATA_EXTENSIONS);
for (const kind of ['cars', 'props', 'interiors', 'collision']) {
    copyTree(path.join(source, 'extracted-models', kind), path.join(dest, 'models', kind), MODEL_EXTENSIONS);
}

// Torque paths usually leave out the extension, so the game needs the file list to resolve them.
const files = [];
(function list(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) list(full);
        else files.push(path.relative(dest, full).replace(/\\/g, '/'));
    }
})(dest);
files.sort();
fs.writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify(files, null, 0));

console.log(`Copied ${copied} files (${(bytes / 1024 / 1024).toFixed(1)} MB) into ${dest}`);
