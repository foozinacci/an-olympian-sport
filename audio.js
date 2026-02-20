/* ═══════════════════════════════════════════
   DEGEN HORSESHOES 💣 — AUDIO ENGINE
   Procedural sound via Web Audio API
   ═══════════════════════════════════════════ */

const AudioEngine = (() => {
  let ctx = null;
  let masterGain = null;

  function init() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.5;
    masterGain.connect(ctx.destination);
  }

  function ensureCtx() {
    if (!ctx) init();
    if (ctx.state === 'suspended') ctx.resume();
  }

  /* ── Noise buffer ── */
  function noiseBuffer(duration = 1) {
    const len = ctx.sampleRate * duration;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  /* ── Core: play a tone ── */
  function playTone(freq, type, duration, volume = 0.3, detune = 0) {
    ensureCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    osc.detune.value = detune;
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  }

  /* ── Explosion ── */
  function explosion(intensity = 1) {
    ensureCtx();
    const dur = 0.6 * intensity;
    // noise burst
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer(dur);
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.7 * intensity, ctx.currentTime);
    nGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2000, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + dur);
    noise.connect(filter);
    filter.connect(nGain);
    nGain.connect(masterGain);
    noise.start();
    noise.stop(ctx.currentTime + dur);
    // low boom
    playTone(60 * intensity, 'sine', dur * 1.5, 0.5 * intensity);
    playTone(40, 'sine', dur * 2, 0.3 * intensity);
  }

  /* ── Whoosh (throw) ── */
  function whoosh() {
    ensureCtx();
    const dur = 0.4;
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer(dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(800, ctx.currentTime);
    bp.frequency.linearRampToValueAtTime(2000, ctx.currentTime + dur * 0.3);
    bp.frequency.linearRampToValueAtTime(400, ctx.currentTime + dur);
    bp.Q.value = 2;
    noise.connect(bp);
    bp.connect(gain);
    gain.connect(masterGain);
    noise.start();
    noise.stop(ctx.currentTime + dur);
  }

  /* ── Impact thud ── */
  function impact(strength = 0.5) {
    ensureCtx();
    playTone(80, 'sine', 0.15, 0.4 * strength);
    playTone(120, 'triangle', 0.1, 0.2 * strength);
    // dust noise
    const n = ctx.createBufferSource();
    n.buffer = noiseBuffer(0.1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.1 * strength, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500;
    n.connect(lp);
    lp.connect(g);
    g.connect(masterGain);
    n.start();
    n.stop(ctx.currentTime + 0.15);
  }

  /* ── Ringer chime ── */
  function ringerChime() {
    ensureCtx();
    const notes = [523, 659, 784, 1047]; // C5 E5 G5 C6
    notes.forEach((f, i) => {
      setTimeout(() => {
        playTone(f, 'sine', 0.6, 0.25);
        playTone(f * 2, 'sine', 0.3, 0.1);
      }, i * 80);
    });
    // metallic ring
    setTimeout(() => {
      playTone(2200, 'square', 1.0, 0.08);
      playTone(3300, 'sine', 0.8, 0.05);
    }, 100);
  }

  /* ── Leaner clang ── */
  function leanerClang() {
    ensureCtx();
    playTone(440, 'triangle', 0.4, 0.3);
    playTone(880, 'sine', 0.3, 0.15);
    playTone(1760, 'sine', 0.2, 0.05);
    impact(0.3);
  }

  /* ── Countdown beep ── */
  function countBeep(final = false) {
    ensureCtx();
    if (final) {
      playTone(880, 'square', 0.2, 0.25);
      playTone(1760, 'square', 0.15, 0.15);
    } else {
      playTone(660, 'square', 0.1, 0.2);
    }
  }

  /* ── Fuse hiss (returns a stoppable node) ── */
  function startFuseHiss() {
    ensureCtx();
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer(30);
    noise.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = 0.04;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3000;
    noise.connect(hp);
    hp.connect(gain);
    gain.connect(masterGain);
    noise.start();
    return {
      setIntensity(v) { gain.gain.setTargetAtTime(0.04 + v * 0.12, ctx.currentTime, 0.1); },
      stop() { try { noise.stop(); } catch(e) {} }
    };
  }

  /* ── Charge hum ── */
  function startChargeHum() {
    ensureCtx();
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 60;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 200;
    osc.connect(lp);
    lp.connect(gain);
    gain.connect(masterGain);
    osc.start();
    return {
      setPower(p) {
        gain.gain.setTargetAtTime(p * 0.15, ctx.currentTime, 0.05);
        osc.frequency.setTargetAtTime(60 + p * 200, ctx.currentTime, 0.05);
        lp.frequency.setTargetAtTime(200 + p * 1500, ctx.currentTime, 0.05);
      },
      stop() { try { osc.stop(); } catch(e) {} }
    };
  }

  /* ── Timer tick (critical) ── */
  function timerTick() {
    ensureCtx();
    playTone(200, 'sine', 0.05, 0.15);
  }

  /* ── Apple sound ── */
  function goldenApple() {
    ensureCtx();
    const notes = [392, 494, 587, 784, 988]; // G4 B4 D5 G5 B5
    notes.forEach((f, i) => {
      setTimeout(() => {
        playTone(f, 'sine', 1.2, 0.2);
        playTone(f * 1.5, 'sine', 0.8, 0.08);
      }, i * 150);
    });
  }

  /* ── Sad whiff ── */
  function whiffSound() {
    ensureCtx();
    playTone(300, 'sine', 0.3, 0.15);
    setTimeout(() => playTone(200, 'sine', 0.4, 0.12), 100);
    setTimeout(() => playTone(120, 'sine', 0.5, 0.1), 200);
  }

  /* ── UI click ── */
  function uiClick() {
    ensureCtx();
    playTone(1200, 'sine', 0.05, 0.1);
  }

  /* ── Distant explosion (void fall) ── */
  function distantExplosion() {
    ensureCtx();
    setTimeout(() => {
      const dur = 0.8;
      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuffer(dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.12, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 300;
      noise.connect(lp);
      lp.connect(g);
      g.connect(masterGain);
      noise.start();
      noise.stop(ctx.currentTime + dur);
      playTone(35, 'sine', 1.0, 0.15);
    }, 400);
  }

  /* ── Dramatic reveal ── */
  function dramaticReveal() {
    ensureCtx();
    playTone(220, 'sine', 1.5, 0.2);
    setTimeout(() => playTone(330, 'sine', 1.2, 0.18), 200);
    setTimeout(() => playTone(440, 'sine', 1.0, 0.15), 400);
  }

  return {
    init,
    explosion,
    whoosh,
    impact,
    ringerChime,
    leanerClang,
    countBeep,
    startFuseHiss,
    startChargeHum,
    timerTick,
    goldenApple,
    whiffSound,
    uiClick,
    distantExplosion,
    dramaticReveal
  };
})();
