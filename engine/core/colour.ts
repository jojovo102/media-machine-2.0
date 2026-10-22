// A take's picture in normal colour (2026-10-21).
//
// The iPhone records HDR: HLG, 10-bit, bt2020. Every reel and video goes out in normal colour (SDR, bt709). So an HDR
// take is converted once, before anything else, and every step after it reads the converted picture. The sound is
// never taken from the copy: the machines read it from the raw take.
//
// The converter is Apple's own (AVFoundation, through /usr/bin/avconvert, preset 1920x1080, H.264). Measured on
// 2026-10-21 against Josef's published reels (Instagram downloads of three of his CapCut edits of HDR takes, no
// filters in the projects), 18 frames from the same raw seconds: Apple's conversion lands within 2 levels of 255 of
// his published frames, which is Instagram's own compression noise. Reading the HLG values without converting them
// (what the first Lepanto render did) was 30 levels off, green and blue pushed up by 34 to 38: washed out and cold.
// VideoToolbox through ffmpeg (scale_vt) does not run on this Mac's ffmpeg, which also has no zscale or libplacebo.
// CapCut converts the same way as Apple, so a CapCut project keeps pointing at the raw take.
//
// Nothing else in the machines touches colour: no grade, no look, no filter, unless Josef asks for one.
import path from 'node:path';
import { renameSync, rmSync, statSync } from 'node:fs';
import { ensure, has, run } from './media';

const HDR_TRANSFERS = new Set(['arib-std-b67', 'smpte2084']);

interface Facts { transfer: string; frames: number; duration: number }

function facts(file: string): Facts {
  const j = JSON.parse(run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=color_transfer,nb_frames:format=duration', '-of', 'json', file], { quiet: true }));
  const s = (j.streams ?? [])[0] ?? {};
  return { transfer: String(s.color_transfer ?? ''), frames: Number(s.nb_frames ?? 0), duration: Number(j.format?.duration ?? 0) };
}

/** True when the file's picture is HDR (HLG or PQ). */
export const isHdr = (file: string) => HDR_TRANSFERS.has(facts(file).transfer);

/**
 * The file to read the picture from: the file itself when it is already normal colour, else its converted copy in
 * `dir` (made once, kept, checked frame for frame). Throws rather than hand back an unconverted HDR picture.
 */
export function picture(file: string, dir: string): string {
  const src = facts(file);
  if (!HDR_TRANSFERS.has(src.transfer)) return file;
  ensure(dir);
  const out = path.join(dir, `${path.parse(file).name}.sdr.mov`);
  if (has(out) && statSync(out).mtimeMs >= statSync(file).mtimeMs) return out;
  const tmp = path.join(dir, `${path.parse(file).name}.sdr-part.mov`);
  rmSync(tmp, { force: true });
  const t0 = Date.now();
  run(['avconvert', '--source', file, '--preset', 'Preset1920x1080', '--output', tmp, '--replace'], { quiet: true });
  const got = facts(tmp);
  // the copy is the take frame for frame: the same frames, the same length, normal colour
  const problems = [
    HDR_TRANSFERS.has(got.transfer) && `still HDR (${got.transfer})`,
    src.frames && got.frames && Math.abs(src.frames - got.frames) > 1 && `${got.frames} frames, the take has ${src.frames}`,
    Math.abs(src.duration - got.duration) > 0.05 && `${got.duration.toFixed(3)} s, the take is ${src.duration.toFixed(3)} s`,
  ].filter(Boolean);
  if (problems.length) {
    rmSync(tmp, { force: true });
    throw new Error(`colour: the normal-colour copy of ${path.basename(file)} is wrong: ${problems.join('; ')}`);
  }
  renameSync(tmp, out);
  console.log(`colour: ${path.basename(file)} was HDR (${src.transfer}), converted to normal colour in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  return out;
}
