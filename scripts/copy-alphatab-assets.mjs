import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
const srcDistDir = join(projectRoot, 'node_modules', '@coderline', 'alphatab', 'dist');
const publicAlphaTabDir = join(projectRoot, 'public', 'alphatab');

if (!existsSync(srcDistDir)) {
  console.log('[copy-alphatab-assets] @coderline/alphatab dist directory not found yet, skipping.');
  process.exit(0);
}

mkdirSync(publicAlphaTabDir, { recursive: true });

// Copy SoundFont for 100% offline/local synth playback
const soundfontSrc = join(srcDistDir, 'soundfont', 'sonivox.sf2');
if (existsSync(soundfontSrc)) {
  copyFileSync(soundfontSrc, join(publicAlphaTabDir, 'sonivox.sf2'));
  console.log('[copy-alphatab-assets] Copied sonivox.sf2 -> public/alphatab/sonivox.sf2');
}

// Copy Bravura/music fonts if present (useful if alphaTab needs font assets)
const fontSrcDir = join(srcDistDir, 'font');
if (existsSync(fontSrcDir)) {
  const fontDestDir = join(publicAlphaTabDir, 'font');
  mkdirSync(fontDestDir, { recursive: true });
  for (const file of readdirSync(fontSrcDir)) {
    copyFileSync(join(fontSrcDir, file), join(fontDestDir, file));
  }
  console.log('[copy-alphatab-assets] Copied font assets -> public/alphatab/font');
}
