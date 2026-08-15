import { type Pose, type PoseOffset, REST, accumulate, scaleOffset } from '../pose.js';
import type { LetterInfo, MotionPiece } from './types.js';

export interface TimelineOptions {
  enter: MotionPiece;
  active: MotionPiece;
  exit: MotionPiece;
  /** Milliseconds spent in the active phase. */
  hold: number;
  /** Crossfade window straddling each phase boundary. */
  blendMs: number;
}

interface Segment {
  piece: MotionPiece;
  start: number;
  end: number;
  loop: boolean;
}

export class Timeline {
  readonly duration: number;
  private readonly segments: Segment[];
  private readonly blend: number;

  constructor(opts: TimelineOptions) {
    const enterEnd = opts.enter.duration;
    const activeEnd = enterEnd + opts.hold;
    this.duration = activeEnd + opts.exit.duration;
    this.blend = opts.blendMs;
    this.segments = [
      { piece: opts.enter, start: 0, end: enterEnd, loop: false },
      { piece: opts.active, start: enterEnd, end: activeEnd, loop: true },
      { piece: opts.exit, start: activeEnd, end: this.duration, loop: false },
    ].filter((seg) => seg.end > seg.start);
  }

  isFinished(elapsed: number): boolean {
    return elapsed >= this.duration;
  }

  poseAt(elapsed: number, letter: LetterInfo): Pose {
    const parts: { seg: Segment; weight: number }[] = [];
    let total = 0;

    for (const seg of this.segments) {
      const weight = this.weight(seg, elapsed);
      if (weight <= 0) continue;
      parts.push({ seg, weight });
      total += weight;
    }

    // Pairwise-complementary ramps sum to 1, but a `hold` shorter than `blendMs` overlaps all
    // three phases at once and the total runs past 1 — which reads as the word lurching.
    const norm = total > 1 ? 1 / total : 1;
    const offsets: PoseOffset[] = parts.map(({ seg, weight }) =>
      scaleOffset(seg.piece.offset(this.localT(seg, elapsed), letter), weight * norm),
    );

    return accumulate(REST, offsets);
  }

  /** Ramps 0→1 over the blend window at the segment's leading edge and back down at its trailing. */
  private weight(seg: Segment, elapsed: number): number {
    const half = this.blend / 2;
    const head = seg.start - half;
    const tail = seg.end + half;

    // Whichever phase starts at 0 and whichever ends at `duration` hold full weight past that edge
    // rather than fading to nothing; a zero-length enter makes `active` the former. Windowing them
    // would drop the word to rest on the last frame, which callers clamp to exactly `duration`.
    const atStart = seg.start === 0;
    const atEnd = seg.end === this.duration;
    if ((!atStart && elapsed < head) || (!atEnd && elapsed >= tail)) return 0;

    const inW = atStart ? 1 : this.ramp(elapsed - head);
    const outW = atEnd ? 1 : this.ramp(tail - elapsed);
    return Math.min(inW, outW);
  }

  private ramp(into: number): number {
    return this.blend > 0 ? Math.min(1, into / this.blend) : 1;
  }

  private localT(seg: Segment, elapsed: number): number {
    const into = elapsed - seg.start;

    if (seg.loop) {
      const d = seg.piece.duration;
      if (d <= 0) return 0;
      return (((into % d) + d) % d) / d;
    }

    return Math.max(0, Math.min(1, into / (seg.end - seg.start)));
  }
}
