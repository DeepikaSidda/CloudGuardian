// Notification sounds using Web Audio API — no audio files needed

let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
  return audioCtx;
}

/** Play a pleasant success chime (two ascending tones) */
export function playSuccessSound() {
  try {
    const ctx = getCtx();
    const now = ctx.currentTime;

    // First tone
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.value = 523.25; // C5
    gain1.gain.setValueAtTime(0.15, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc1.connect(gain1).connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.3);

    // Second tone (higher)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.value = 659.25; // E5
    gain2.gain.setValueAtTime(0.15, now + 0.15);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    osc2.connect(gain2).connect(ctx.destination);
    osc2.start(now + 0.15);
    osc2.stop(now + 0.5);
  } catch { /* audio not supported */ }
}

/** Play a short error buzz (low descending tone) */
export function playErrorSound() {
  try {
    const ctx = getCtx();
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(300, now);
    osc.frequency.linearRampToValueAtTime(200, now + 0.25);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.3);
  } catch { /* audio not supported */ }
}
