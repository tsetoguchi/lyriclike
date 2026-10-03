import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const VIDEO_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const MEDIA_DIR = join(VIDEO_DIR, '..', 'media');
const ENTRY_POINT = 'src/index.ts';

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: true });
  if (result.status !== 0) throw new Error(`${command} failed`);
}

function renderWithAudio(slug, outputPath) {
  run('npx', ['remotion', 'render', ENTRY_POINT, slug, `"${outputPath}"`], VIDEO_DIR);
}

// TikTok boosts videos that use its own sounds, so that copy ships silent and the
// sound is added in the app; the video stream is copied, not re-encoded.
function stripAudio(inputPath, outputPath) {
  run('ffmpeg', ['-y', '-v', 'error', '-i', `"${inputPath}"`, '-c:v', 'copy', '-an', `"${outputPath}"`], VIDEO_DIR);
}

function main(slug) {
  const instagramDir = join(MEDIA_DIR, 'instagram');
  const tiktokDir = join(MEDIA_DIR, 'tiktok');
  mkdirSync(instagramDir, { recursive: true });
  mkdirSync(tiktokDir, { recursive: true });
  const instagramPath = join(instagramDir, `${slug}.mp4`);
  renderWithAudio(slug, instagramPath);
  stripAudio(instagramPath, join(tiktokDir, `${slug}.mp4`));
  console.log(`rendered ${slug}: media/instagram (audio) and media/tiktok (silent)`);
}

main(process.argv[2]);
