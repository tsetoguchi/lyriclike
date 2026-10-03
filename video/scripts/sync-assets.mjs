import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const VIDEO_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_DIR = join(VIDEO_DIR, '..');
const PUBLIC_DIR = join(VIDEO_DIR, 'public');
const SCHEME_COLOR_COUNT = 10;
const COLOR_TOKENS = ['paper', 'paper-card', 'paper-panel', 'ink', 'ink-faded', 'accent'];
const FONT_FAMILY = "'iA Writer Quattro'";

function readToken(css, name) {
  const match = css.match(new RegExp(`^\\s*--${name}:\\s*([^;]+);`, 'm'));
  if (match === null) throw new Error(`styles.css has no --${name} token`);
  return match[1].trim();
}

export function readTheme(css) {
  const colors = {};
  for (const name of COLOR_TOKENS) colors[name] = readToken(css, name);
  const scheme = Array.from({ length: SCHEME_COLOR_COUNT }, (_, index) =>
    readToken(css, `scheme-${index}`)
  );
  return { colors, scheme, fontFamily: FONT_FAMILY };
}

function writeTheme() {
  const css = readFileSync(join(REPO_DIR, 'styles.css'), 'utf8');
  mkdirSync(PUBLIC_DIR, { recursive: true });
  writeFileSync(join(PUBLIC_DIR, 'theme.json'), JSON.stringify(readTheme(css), null, 2));
}

function copyFonts() {
  const fontsDir = join(PUBLIC_DIR, 'fonts');
  mkdirSync(fontsDir, { recursive: true });
  const fonts = readdirSync(join(REPO_DIR, 'fonts')).filter((name) => name.endsWith('.woff2'));
  for (const name of fonts) copyFileSync(join(REPO_DIR, 'fonts', name), join(fontsDir, name));
}

function prepareAudio(slug, audioPath) {
  const audioDir = join(PUBLIC_DIR, 'audio');
  mkdirSync(audioDir, { recursive: true });
  const result = spawnSync(
    'ffmpeg',
    ['-y', '-v', 'error', '-i', audioPath, '-c:a', 'pcm_s16le', join(audioDir, `${slug}.wav`)],
    { stdio: 'inherit' }
  );
  if (result.status !== 0) throw new Error('ffmpeg could not convert the audio');
}

function runCli(slug, audioPath) {
  writeTheme();
  copyFonts();
  prepareAudio(slug, audioPath);
  console.log(`assets ready in ${PUBLIC_DIR}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv[2], process.argv[3]);
}
