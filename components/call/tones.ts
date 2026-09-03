"use client";

import { useEffect } from "react";

/**
 * The two sounds a call makes.
 *
 * Synthesised rather than loaded. Two oscillators through a gain envelope is a few
 * dozen lines and no asset — nothing to cache, no format negotiation, no 404 that
 * turns into silence — and it stops exactly, which an `<audio loop>` that has
 * already started buffering does not.
 *
 * Both ends need one, and they must not be the same sound. The callee hears a ring
 * that says *answer me*; the caller hears a ringback that says *it is ringing over
 * there*. A tab that played the loud double-ring to the person who pressed the
 * button would have them reaching for their own phone.
 *
 * Browsers refuse to start an `AudioContext` without a gesture. The caller always
 * has one — they tapped call — so ringback is reliably audible. The callee may not,
 * which is why the incoming panel's animation is load-bearing rather than
 * decoration.
 */

export interface TonePattern {
  /** Sounded together for each pulse. Two close frequencies is what reads as a ring. */
  tones: number[];
  pulseMs: number;
  /** Offsets inside one cycle where a pulse begins. Two entries is a double ring. */
  atMs: number[];
  cycleMs: number;
  /** Peak gain. Well under 1 — this is a UI sound and it arrives unannounced. */
  gain: number;
}

/** What the callee hears: an insistent double ring. */
export const RINGTONE: TonePattern = {
  tones: [420, 320],
  pulseMs: 400,
  atMs: [0, 600],
  cycleMs: 3200,
  gain: 0.09,
};

/**
 * What the caller hears: the North American ringback pair, quieter and slower.
 *
 * Deliberately dull. It is confirmation that something is happening at the far end,
 * and it plays into the ear of somebody who is already looking at the screen.
 */
export const RINGBACK: TonePattern = {
  tones: [440, 480],
  pulseMs: 1000,
  atMs: [0],
  cycleMs: 4000,
  gain: 0.05,
};

/**
 * Play a pattern for as long as it is passed, then stop.
 *
 * Pass `null` to be silent — that is the whole control surface, so a caller can key
 * the sound directly off call status without an imperative start/stop pair that can
 * be left half-called on an early return.
 */
export function useCallTone(pattern: TonePattern | null): void {
  useEffect(() => {
    if (!pattern || typeof window.AudioContext !== "function") return;

    const ctx = new window.AudioContext();
    let stopped = false;

    const pulse = (at: number) => {
      // A gain envelope per pulse, not a global mute: an oscillator started and
      // stopped on a bare gain of 1 clicks audibly at both ends.
      const seconds = pattern.pulseMs / 1000;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(pattern.gain, at + 0.02);
      gain.gain.setValueAtTime(pattern.gain, at + seconds - 0.03);
      gain.gain.linearRampToValueAtTime(0, at + seconds);
      gain.connect(ctx.destination);

      for (const hz of pattern.tones) {
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.value = hz;
        osc.connect(gain);
        osc.start(at);
        osc.stop(at + seconds);
      }
    };

    const cycle = () => {
      if (stopped) return;
      for (const offset of pattern.atMs) pulse(ctx.currentTime + offset / 1000);
    };

    void ctx.resume().catch(() => {});
    cycle();
    const timer = setInterval(cycle, pattern.cycleMs);

    return () => {
      stopped = true;
      clearInterval(timer);
      void ctx.close().catch(() => {});
    };
  }, [pattern]);
}
