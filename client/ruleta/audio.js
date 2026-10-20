// Música y efectos 100 % sintetizados con Web Audio: composición original,
// sin muestras ni nada con derechos de autor.

const BPM = 84;
const STEP = 60 / BPM / 4; // semicorchea

const mtof = (m) => 440 * 2 ** ((m - 69) / 12);

// Nana de caja de música en re menor (melodía original). [paso, nota MIDI]
const MELODY = [
  // compás 1
  [0, 74], [2, 77], [4, 81], [7, 79], [9, 77], [11, 76],
  // compás 2
  [16, 74], [18, 76], [20, 77], [22, 69], [28, 73],
  // compás 3
  [32, 70], [34, 74], [36, 77], [39, 76], [41, 74], [43, 73],
  // compás 4
  [48, 74], [52, 69], [56, 62], [60, 65],
  // compás 5
  [64, 81], [66, 79], [68, 77], [70, 76], [72, 77], [75, 74],
  // compás 6
  [80, 70], [82, 72], [84, 74], [86, 77], [88, 76], [92, 69],
  // compás 7
  [96, 70], [98, 74], [100, 79], [103, 77], [105, 76], [107, 74],
  // compás 8
  [112, 73], [114, 76], [116, 81], [120, 74], [124, 62],
];
const LOOP_STEPS = 128;
// Acorde (graves) por compás: Dm Dm Bb A | Dm Gm Bb A
const CHORDS = [
  [50, 53, 57], [50, 53, 57], [46, 50, 53], [45, 49, 52],
  [50, 53, 57], [43, 46, 50], [46, 50, 53], [45, 49, 52],
];

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.intensity = 0;
    this.volume = 0.8;
    this.muted = false;
    this.musicOn = false;
    this.step = 0;
  }

  /** Hay que llamarlo tras un gesto del usuario (clic o tecla). */
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.25;
    this.master.connect(comp).connect(ctx.destination);

    // Reverb de sala grande (respuesta al impulso generada).
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(4.2, 2.6);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.9;
    this.reverbSend.connect(this.reverb).connect(this.master);

    // Eco para la caja de música.
    this.delay = ctx.createDelay(1);
    this.delay.delayTime.value = STEP * 3;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    const dlp = ctx.createBiquadFilter();
    dlp.type = 'lowpass';
    dlp.frequency.value = 2400;
    this.delay.connect(dlp).connect(fb).connect(this.delay);
    dlp.connect(this.reverbSend);
    dlp.connect(this.master);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.85;
    this.musicBus.connect(this.master);
    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(this.master);

    this.noiseBuf = this.makeNoise(3);
    this.startDrone();
  }

  impulse(seconds, decay) {
    const { ctx } = this;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** decay;
    }
    return buf;
  }

  makeNoise(seconds) {
    const { ctx } = this;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master && !this.muted) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.05);
  }

  get now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  // ---------- utilidades de síntesis ----------

  env(gainNode, t, { a = 0.005, peak = 1, d = 0.3, s = 0, hold = 0, r = 0.2 }) {
    const g = gainNode.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0.0001, t);
    g.linearRampToValueAtTime(peak, t + a);
    if (s > 0) {
      g.setTargetAtTime(peak * s, t + a, d / 3);
      g.setValueAtTime(peak * s, t + a + d + hold);
      g.exponentialRampToValueAtTime(0.0001, t + a + d + hold + r);
      return t + a + d + hold + r;
    }
    g.exponentialRampToValueAtTime(0.0001, t + a + d);
    return t + a + d;
  }

  noise(t, dur, { type = 'bandpass', freq = 1000, q = 1, gain = 0.5, a = 0.005, sweepTo, dest } = {}) {
    if (!this.ctx) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    f.Q.value = q;
    const g = this.ctx.createGain();
    src.connect(f).connect(g).connect(dest || this.sfxBus);
    const end = this.env(g, t, { a, peak: gain, d: dur });
    src.start(t, Math.random() * 2);
    src.stop(end + 0.05);
    return { src, f, g };
  }

  tone(t, freq, dur, { type = 'sine', gain = 0.3, a = 0.005, glideTo, dest, send = 0, detune = 0 } = {}) {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.detune.value = detune;
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    const g = this.ctx.createGain();
    o.connect(g).connect(dest || this.sfxBus);
    if (send) {
      const sg = this.ctx.createGain();
      sg.gain.value = send;
      g.connect(sg).connect(this.reverbSend);
    }
    const end = this.env(g, t, { a, peak: gain, d: dur });
    o.start(t);
    o.stop(end + 0.05);
    return o;
  }

  /** Campanita FM (caja de música). */
  bell(t, midi, { gain = 0.18, dur = 1.6, dest, send = 0.6, delay = true } = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const f = mtof(midi);
    const car = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const modGain = ctx.createGain();
    car.frequency.value = f;
    mod.frequency.value = f * 3.5;
    modGain.gain.setValueAtTime(f * 2.2, t);
    modGain.gain.exponentialRampToValueAtTime(f * 0.05, t + dur * 0.6);
    mod.connect(modGain).connect(car.frequency);
    const g = ctx.createGain();
    car.connect(g);
    g.connect(dest || this.musicBus);
    const sg = ctx.createGain();
    sg.gain.value = send;
    g.connect(sg).connect(this.reverbSend);
    if (delay) {
      const dg = ctx.createGain();
      dg.gain.value = 0.35;
      g.connect(dg).connect(this.delay);
    }
    const end = this.env(g, t, { a: 0.002, peak: gain, d: dur });
    car.start(t);
    mod.start(t);
    car.stop(end + 0.05);
    mod.stop(end + 0.05);
  }

  /** Pad tipo coro: sierras desafinadas por filtros de formante "aah". */
  choir(t, notes, dur, { gain = 0.08, a = 0.6, dest } = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.connect(dest || this.musicBus);
    const sg = ctx.createGain();
    sg.gain.value = 0.8;
    out.connect(sg).connect(this.reverbSend);
    const formants = [
      [730, 8, 1],
      [1090, 10, 0.5],
      [2440, 12, 0.25],
    ];
    const mix = ctx.createGain();
    for (const [fq, q, lv] of formants) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = fq;
      bp.Q.value = q;
      const lg = ctx.createGain();
      lg.gain.value = lv * 3;
      mix.connect(bp).connect(lg).connect(out);
    }
    const oscs = [];
    for (const n of notes) {
      for (const det of [-9, 0, 8]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = mtof(n);
        o.detune.value = det;
        const vib = ctx.createOscillator();
        vib.frequency.value = 4.5 + Math.random();
        const vg = ctx.createGain();
        vg.gain.value = 6;
        vib.connect(vg).connect(o.detune);
        o.connect(mix);
        oscs.push(o, vib);
      }
    }
    out.gain.setValueAtTime(0.0001, t);
    out.gain.linearRampToValueAtTime(gain, t + a);
    out.gain.setValueAtTime(gain, t + Math.max(a, dur - 1.2));
    out.gain.linearRampToValueAtTime(0.0001, t + dur);
    for (const o of oscs) {
      o.start(t);
      o.stop(t + dur + 0.1);
    }
  }

  kick(t, gain = 0.9) {
    this.tone(t, 120, 0.35, { glideTo: 38, gain, dest: this.musicBus });
    this.noise(t, 0.04, { type: 'lowpass', freq: 900, gain: gain * 0.25, dest: this.musicBus });
  }

  // ---------- ambiente continuo ----------

  startDrone() {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0.0001;
    out.gain.linearRampToValueAtTime(0.16, ctx.currentTime + 4);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 220;
    lp.Q.value = 4;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lg = ctx.createGain();
    lg.gain.value = 90;
    lfo.connect(lg).connect(lp.frequency);
    lfo.start();
    for (const [n, det] of [
      [38, -6],
      [38, 7],
      [45, 0],
      [26, 0],
    ]) {
      const o = ctx.createOscillator();
      o.type = n === 26 ? 'sine' : 'sawtooth';
      o.frequency.value = mtof(n);
      o.detune.value = det;
      o.connect(lp);
      o.start();
    }
    // Viento
    const wind = ctx.createBufferSource();
    wind.buffer = this.noiseBuf;
    wind.loop = true;
    const wf = ctx.createBiquadFilter();
    wf.type = 'bandpass';
    wf.frequency.value = 420;
    wf.Q.value = 0.7;
    const wlfo = ctx.createOscillator();
    wlfo.frequency.value = 0.11;
    const wlg = ctx.createGain();
    wlg.gain.value = 260;
    wlfo.connect(wlg).connect(wf.frequency);
    wlfo.start();
    const wg = ctx.createGain();
    wg.gain.value = 0.05;
    wind.connect(wf).connect(wg).connect(this.master);
    wind.start();
    lp.connect(out).connect(this.musicBus);
    this.droneOut = out;
  }

  startMusic() {
    if (!this.ctx || this.musicOn) return;
    this.musicOn = true;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 25);
  }

  schedule() {
    const ahead = this.ctx.currentTime + 0.15;
    while (this.nextTime < ahead) {
      this.playStep(this.step % LOOP_STEPS, this.nextTime);
      this.step++;
      this.nextTime += STEP;
    }
  }

  playStep(s, t) {
    if (this.paused) return;
    const lvl = this.intensity;
    const bar = Math.floor(s / 16);
    const inBar = s % 16;
    for (const [step, note] of MELODY) {
      if (step === s) this.bell(t, note, { gain: lvl >= 2 ? 0.1 : 0.16 });
    }
    if (inBar === 0) {
      const chord = CHORDS[bar % CHORDS.length];
      // Pad oscuro de fondo
      this.choir(t, chord.map((n) => n + 12), STEP * 16 + 0.6, { gain: lvl === 0 ? 0.035 : 0.06, a: 0.9 });
      this.tone(t, mtof(chord[0] - 12), STEP * 16, { type: 'triangle', gain: 0.12, dest: this.musicBus, a: 0.4 });
    }
    if (lvl >= 1) {
      if (inBar === 0 || inBar === 10) this.kick(t, 0.85);
      if (inBar === 8) this.tone(t, 90, 0.5, { glideTo: 60, gain: 0.35, dest: this.musicBus, send: 0.3 });
    }
    if (lvl >= 2) {
      if (inBar % 2 === 0) this.noise(t, 0.05, { type: 'highpass', freq: 7000, gain: inBar % 4 === 2 ? 0.12 : 0.06, dest: this.musicBus });
      if (inBar === 4 || inBar === 12) {
        this.noise(t, 0.18, { type: 'bandpass', freq: 1800, q: 0.8, gain: 0.3, dest: this.musicBus });
        this.tone(t, 190, 0.12, { glideTo: 120, gain: 0.25, dest: this.musicBus });
      }
      if (inBar % 2 === 0) {
        const root = CHORDS[bar % CHORDS.length][0] - 12;
        this.tone(t, mtof(root), STEP * 1.6, { type: 'sawtooth', gain: 0.07, dest: this.musicBus });
      }
    }
  }

  setIntensity(level) {
    this.intensity = level;
  }

  /** Baja la música (para el silencio antes de la revelación). */
  duck(on, time = 0.25) {
    if (!this.ctx) return;
    this.paused = on;
    const t = this.ctx.currentTime;
    this.musicBus.gain.cancelScheduledValues(t);
    this.musicBus.gain.setTargetAtTime(on ? 0.0001 : 0.85, t, time / 3);
    this.droneOut.gain.setTargetAtTime(on ? 0.02 : 0.16, t, time / 3);
  }

  // ---------- efectos ----------

  /**
   * Zombi lejano, sintetizado: voz rasposa (sierra con temblor y formantes
   * de vocal) más ruido de garganta, distorsionada y con mucha reverb.
   * kind: 'groan' (gemido largo), 'scream' (chillido) o 'growl' (gruñidos).
   */
  zombie(kind = 'groan', delay = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = this.now + delay;
    const spec = {
      groan: { f0: 85 + Math.random() * 40, f1: 60, dur: 1.4 + Math.random() * 0.9, gain: 1.0, vowel: [520, 900, 2300] },
      scream: { f0: 300 + Math.random() * 140, f1: 170, dur: 0.75 + Math.random() * 0.4, gain: 0.6, vowel: [800, 1250, 2600] },
      growl: { f0: 70 + Math.random() * 30, f1: 55, dur: 0.9 + Math.random() * 0.5, gain: 0.8, vowel: [450, 800, 2400] },
    }[kind];
    const { dur } = spec;

    // A un lado del búnker: paneo aleatorio y un filtro suave de distancia.
    const pan = ctx.createStereoPanner();
    pan.pan.value = (Math.random() * 2 - 1) * 0.85;
    const far = ctx.createBiquadFilter();
    far.type = 'lowpass';
    far.frequency.value = 3800 + Math.random() * 2600;
    const out = ctx.createGain();
    out.connect(far).connect(pan).connect(this.sfxBus);
    const send = ctx.createGain();
    send.gain.value = 0.75;
    out.connect(send).connect(this.reverbSend);

    // Saturación para la garganta rota.
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * 2 - 1;
      curve[i] = Math.tanh(x * 3.2);
    }
    shaper.curve = curve;
    const voice = ctx.createGain();
    voice.gain.value = 0.9;
    shaper.connect(voice);
    for (const [i, f] of spec.vowel.entries()) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(f, t);
      bp.frequency.linearRampToValueAtTime(f * (0.75 + Math.random() * 0.2), t + dur);
      bp.Q.value = 3.5 + i * 1.5;
      const fg = ctx.createGain();
      fg.gain.value = [1.4, 0.9, 0.4][i];
      voice.connect(bp).connect(fg).connect(out);
    }

    // Cuerdas vocales: dos sierras desafinadas con temblor irregular.
    const pitch = ctx.createGain();
    pitch.gain.value = spec.f0 * 0.06;
    const jitter = ctx.createOscillator();
    jitter.type = 'square';
    jitter.frequency.value = 7 + Math.random() * 9;
    jitter.connect(pitch);
    const oscs = [0, 14].map((det) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.detune.value = det;
      o.frequency.setValueAtTime(spec.f0 * (kind === 'scream' ? 0.8 : 1), t);
      if (kind === 'scream') o.frequency.exponentialRampToValueAtTime(spec.f0 * 1.15, t + dur * 0.25);
      o.frequency.exponentialRampToValueAtTime(spec.f1, t + dur);
      pitch.connect(o.frequency);
      o.connect(shaper);
      return o;
    });

    // Aire rasposo por los mismos formantes.
    const rasp = ctx.createBufferSource();
    rasp.buffer = this.noiseBuf;
    rasp.loop = true;
    const rf = ctx.createBiquadFilter();
    rf.type = 'bandpass';
    rf.frequency.value = kind === 'scream' ? 2200 : 1100;
    rf.Q.value = 1.2;
    const rg = ctx.createGain();
    rg.gain.value = kind === 'scream' ? 0.5 : 0.35;
    rasp.connect(rf).connect(rg).connect(shaper);

    // Envolvente con tartamudeo (los gruñidos van a golpes).
    const g = out.gain;
    g.setValueAtTime(0.0001, t);
    if (kind === 'growl') {
      let k = t;
      while (k < t + dur) {
        const len = 0.12 + Math.random() * 0.2;
        g.linearRampToValueAtTime(spec.gain, k + 0.03);
        g.linearRampToValueAtTime(spec.gain * 0.15, k + len);
        k += len + Math.random() * 0.08;
      }
    } else {
      g.linearRampToValueAtTime(spec.gain, t + (kind === 'scream' ? 0.05 : 0.35));
      g.setTargetAtTime(spec.gain * 0.7, t + 0.4, dur / 3);
    }
    g.exponentialRampToValueAtTime(0.0001, t + dur + 0.35);
    const end = t + dur + 0.4;
    for (const node of [...oscs, jitter, rasp]) {
      node.start(t, node === rasp ? Math.random() * 2 : undefined);
      node.stop(end);
    }
  }

  thunder(delay = 0) {
    if (!this.ctx) return;
    const t = this.now + delay;
    this.noise(t, 0.25, { type: 'highpass', freq: 1500, gain: 0.5, a: 0.002 });
    this.noise(t + 0.05, 3.8, { type: 'lowpass', freq: 380, sweepTo: 70, q: 0.5, gain: 1.1, a: 0.08 });
    this.noise(t + 0.4, 2.5, { type: 'lowpass', freq: 160, gain: 0.8, a: 0.3 });
  }

  crankClick(delay = 0) {
    const t = this.now + delay;
    this.noise(t, 0.04, { type: 'bandpass', freq: 3200, q: 3, gain: 0.5 });
    this.tone(t, 900, 0.04, { type: 'square', gain: 0.05 });
  }

  crankTurn(duration) {
    const n = Math.floor(duration / 0.11);
    for (let i = 0; i < n; i++) this.crankClick(i * 0.11 + Math.random() * 0.01);
    this.noise(this.now, duration, { type: 'bandpass', freq: 300, q: 2, gain: 0.25, a: 0.2 });
  }

  clunk(delay = 0) {
    const t = this.now + delay;
    this.tone(t, 160, 0.25, { glideTo: 60, gain: 0.6 });
    this.noise(t, 0.08, { type: 'bandpass', freq: 1200, q: 2, gain: 0.4 });
  }

  roll(delay = 0, dur = 0.5) {
    const t = this.now + delay;
    for (let i = 0; i < dur / 0.045; i++) {
      this.noise(t + i * 0.045, 0.03, { type: 'bandpass', freq: 2000 + Math.random() * 1500, q: 4, gain: 0.12 });
    }
  }

  pop(index, delay = 0) {
    const t = this.now + delay;
    const scale = [62, 65, 69, 72, 74, 77, 81, 84, 86, 89];
    this.tone(t, 300, 0.12, { glideTo: 900, gain: 0.25 });
    this.bell(t + 0.04, scale[index % scale.length], { gain: 0.22, dur: 1.2, dest: this.sfxBus, delay: false });
  }

  whoosh(delay = 0, dur = 0.7, gain = 0.45) {
    const t = this.now + delay;
    this.noise(t, dur, { type: 'bandpass', freq: 300, sweepTo: 3200, q: 1.5, gain, a: dur * 0.6 });
  }

  boxSwallow(delay = 0) {
    const t = this.now + delay;
    this.tone(t, 700, 0.35, { glideTo: 160, gain: 0.2, type: 'triangle', send: 0.5 });
    this.noise(t, 0.2, { type: 'bandpass', freq: 2500, sweepTo: 600, q: 2, gain: 0.2 });
  }

  creak(delay = 0, dur = 0.9) {
    const t = this.now + delay;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(70, t);
    for (let i = 0; i < 8; i++) o.frequency.linearRampToValueAtTime(60 + Math.random() * 60, t + (dur * (i + 1)) / 8);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 6;
    const g = this.ctx.createGain();
    o.connect(bp).connect(g).connect(this.sfxBus);
    this.env(g, t, { a: 0.1, peak: 0.35, d: dur });
    o.start(t);
    o.stop(t + dur + 0.1);
  }

  slam(delay = 0) {
    const t = this.now + delay;
    this.tone(t, 110, 0.6, { glideTo: 35, gain: 1.0, send: 0.5 });
    this.noise(t, 0.35, { type: 'lowpass', freq: 1400, sweepTo: 200, gain: 0.7 });
  }

  rumble(dur) {
    const t = this.now;
    this.noise(t, dur, { type: 'lowpass', freq: 110, gain: 0.9, a: dur * 0.7 });
    this.tone(t, 42, dur, { gain: 0.35, a: dur * 0.6, glideTo: 55 });
  }

  riser(dur) {
    const t = this.now;
    this.noise(t, dur, { type: 'bandpass', freq: 400, sweepTo: 6000, q: 2, gain: 0.35, a: dur * 0.9 });
    this.tone(t, 110, dur, { type: 'sawtooth', glideTo: 880, gain: 0.08, a: dur * 0.9, send: 0.4 });
  }

  burstOpen(delay = 0) {
    const t = this.now + delay;
    this.noise(t, 1.4, { type: 'highpass', freq: 600, sweepTo: 5000, gain: 0.55, a: 0.01 });
    this.tone(t, 55, 1.2, { glideTo: 30, gain: 0.9 });
    this.choir(t, [62, 69, 74, 78], 3.5, { gain: 0.07, a: 0.05 });
  }

  /** Tic del ciclo de nombres: un punteo de caja de música. */
  tick(pitchIndex, loud = 1) {
    const scale = [74, 76, 77, 79, 81, 82, 85, 86];
    const t = this.now;
    this.bell(t, scale[pitchIndex % scale.length], { gain: 0.11 * loud, dur: 0.6, dest: this.sfxBus, send: 0.3, delay: false });
    this.noise(t, 0.02, { type: 'highpass', freq: 5000, gain: 0.08 * loud });
  }

  heartbeat(delay = 0) {
    const t = this.now + delay;
    this.tone(t, 70, 0.18, { glideTo: 40, gain: 0.7 });
    this.tone(t + 0.22, 65, 0.22, { glideTo: 38, gain: 0.5 });
  }

  /** La gran revelación. */
  reveal() {
    const t = this.now;
    this.tone(t, 70, 2.5, { glideTo: 24, gain: 1.2 });
    this.noise(t, 2.2, { type: 'lowpass', freq: 3000, sweepTo: 120, gain: 0.9, a: 0.002 });
    this.noise(t, 0.5, { type: 'highpass', freq: 3000, gain: 0.35, a: 0.002 });
    // Coro en re mayor (tercera de picardía tras tanto re menor)
    this.choir(t, [50, 54, 57, 62, 66, 69], 7, { gain: 0.11, a: 0.08, dest: this.sfxBus });
    const arp = [74, 78, 81, 86, 90, 93, 98];
    arp.forEach((n, i) => this.bell(t + 0.15 + i * 0.09, n, { gain: 0.16, dur: 2.5, dest: this.sfxBus, send: 0.9 }));
    // Brillo
    for (let i = 0; i < 24; i++) {
      this.tone(t + 0.3 + Math.random() * 2.2, 2000 + Math.random() * 4000, 0.15, { gain: 0.03, send: 0.6 });
    }
  }

  uiClick() {
    const t = this.now;
    this.tone(t, 520, 0.08, { glideTo: 1040, gain: 0.12 });
  }
}
