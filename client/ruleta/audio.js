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
    this.loadSamples();
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

  // ---------- audios propios (opcionales) ----------

  /**
   * Carga los audios listados en /ruleta-media/zombies/manifest.json:
   * { "zombies": ["a.mp3", ...], "roundStart": "ronda.mp3" }.
   * Sin manifiesto (o si falla algo) se usan los zombis sintetizados.
   */
  loadSamples(base = '/ruleta-media/zombies') {
    if (this.samplesLoading) return this.samplesLoading;
    this.samples = { zombies: [], roundStart: null };
    const decode = async (name) => {
      if (typeof name !== 'string' || !/^[\w.-]+\.(mp3|ogg|wav|m4a)$/i.test(name)) return null;
      try {
        const res = await fetch(`${base}/${name}`);
        if (!res.ok) return null;
        return await this.ctx.decodeAudioData(await res.arrayBuffer());
      } catch {
        return null;
      }
    };
    this.samplesLoading = (async () => {
      let manifest;
      try {
        const res = await fetch(`${base}/manifest.json`, { cache: 'no-cache' });
        if (!res.ok) return;
        manifest = await res.json();
      } catch {
        return;
      }
      const list = Array.isArray(manifest?.zombies) ? manifest.zombies.slice(0, 40) : [];
      this.samples.zombies = (await Promise.all(list.map(decode))).filter(Boolean);
      this.samples.roundStart = manifest?.roundStart ? await decode(manifest.roundStart) : null;
    })();
    return this.samplesLoading;
  }

  playSample(buffer, { delay = 0, gain = 0.9, pan = 0, rate = 1, send = 0.3 } = {}) {
    if (!this.ctx || !buffer) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    src.connect(g).connect(p).connect(this.sfxBus);
    const s = ctx.createGain();
    s.gain.value = send;
    g.connect(s).connect(this.reverbSend);
    src.start(this.now + delay);
  }

  /** True si hay audios propios de zombis cargados. */
  get hasZombieSamples() {
    return Boolean(this.samples?.zombies.length);
  }

  /** Zombi de fondo: un audio propio al azar si hay; si no, uno sintetizado. */
  ambientZombie(delay = 0) {
    const list = this.samples?.zombies;
    if (list?.length) {
      let i;
      do i = Math.floor(Math.random() * list.length);
      while (list.length > 1 && i === this.lastSample);
      this.lastSample = i;
      // Pequeñas variaciones de tono y lado para que no suene siempre igual.
      this.playSample(list[i], { delay, gain: 0.85, pan: (Math.random() * 2 - 1) * 0.6, rate: 0.95 + Math.random() * 0.1 });
      return;
    }
    const kinds = ['groan', 'groan', 'growl', 'scream', 'snarl'];
    this.zombie(kinds[Math.floor(Math.random() * kinds.length)], delay);
  }

  /** Sonido de inicio de ronda al empezar el sorteo (solo si hay audio propio). */
  roundStart() {
    if (this.samples?.roundStart) this.playSample(this.samples.roundStart, { gain: 1, send: 0.2 });
  }

  /**
   * Zombi sintetizado al estilo de los mapas de zombis: garganta rota con
   * "vocal fry" (traqueteo de 25-60 Hz), subarmónico, mucho aliento por los
   * formantes y saturación. El tono deriva al azar para que nunca suene igual.
   * kind: 'groan' (gemido), 'growl' (gruñido a golpes), 'scream' (chillido)
   * o 'snarl' (bufido corto).
   */
  zombie(kind = 'groan', delay = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = this.now + delay;
    const rnd = (a, b) => a + Math.random() * (b - a);
    const A = [760, 1180, 2550]; // vocal "a"
    const O = [430, 820, 2400]; // vocal "o/u"
    const E = [900, 1750, 2900]; // vocal "e" abierta
    const spec = {
      groan: { pitch: [rnd(105, 140), rnd(95, 120), rnd(62, 78)], dur: rnd(1.5, 2.3), gain: 0.9, from: A, to: O, fry: rnd(28, 40), fryDepth: 0.75, breath: 0.55, drive: 4, attack: 0.18 },
      growl: { pitch: [rnd(80, 95), rnd(70, 85), rnd(55, 65)], dur: rnd(1.0, 1.6), gain: 0.95, from: O, to: A, fry: rnd(22, 32), fryDepth: 0.95, breath: 0.65, drive: 5, attack: 0.04 },
      scream: { pitch: [rnd(330, 400), rnd(480, 600), rnd(280, 340)], dur: rnd(0.85, 1.25), gain: 0.7, from: A, to: E, fry: rnd(45, 65), fryDepth: 0.45, breath: 0.85, drive: 6, attack: 0.03 },
      snarl: { pitch: [rnd(170, 210), rnd(150, 170), rnd(110, 130)], dur: rnd(0.32, 0.5), gain: 0.85, from: E, to: A, fry: rnd(35, 50), fryDepth: 0.7, breath: 0.95, drive: 5, attack: 0.015 },
    }[kind];
    const { dur } = spec;
    const end = t + dur + 0.45;

    // Salida: a un lado del búnker, algo de distancia y sala.
    const out = ctx.createGain();
    const pan = ctx.createStereoPanner();
    pan.pan.value = rnd(-0.8, 0.8);
    const air = ctx.createBiquadFilter();
    air.type = 'lowpass';
    air.frequency.value = rnd(5200, 7500);
    out.connect(air).connect(pan).connect(this.sfxBus);
    const send = ctx.createGain();
    send.gain.value = 0.6;
    out.connect(send).connect(this.reverbSend);

    // Banco de formantes que se mueve de una vocal a otra.
    const bank = ctx.createGain();
    for (let i = 0; i < 3; i++) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(spec.from[i] * rnd(0.92, 1.08), t);
      bp.frequency.linearRampToValueAtTime(spec.to[i] * rnd(0.92, 1.08), t + dur);
      bp.Q.value = [4, 5, 7][i];
      const fg = ctx.createGain();
      fg.gain.value = [1.6, 1.0, 0.45][i];
      bank.connect(bp).connect(fg).connect(out);
    }
    // Cuerpo grave del pecho, sin filtrar por la vocal.
    const chest = ctx.createBiquadFilter();
    chest.type = 'lowpass';
    chest.frequency.value = 380;
    const chestGain = ctx.createGain();
    chestGain.gain.value = kind === 'scream' ? 0.15 : 0.5;
    bank.connect(chest).connect(chestGain).connect(out);

    // Garganta rota: saturación fuerte antes de los formantes.
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(512);
    for (let i = 0; i < 512; i++) curve[i] = Math.tanh(((i / 511) * 2 - 1) * spec.drive);
    shaper.curve = curve;
    shaper.oversample = '2x';
    shaper.connect(bank);

    // Vocal fry: la voz se entrecorta a 25-60 Hz con ritmo irregular.
    const fry = ctx.createGain();
    fry.gain.value = 1 - spec.fryDepth / 2;
    const fryLfo = ctx.createOscillator();
    fryLfo.type = 'sawtooth';
    const fryCurve = new Float32Array(24).map(() => spec.fry * rnd(0.7, 1.3));
    fryLfo.frequency.setValueCurveAtTime(fryCurve, t, dur + 0.3);
    const fryAmt = ctx.createGain();
    fryAmt.gain.value = spec.fryDepth / 2;
    fryLfo.connect(fryAmt).connect(fry.gain);
    fry.connect(shaper);

    // Cuerdas vocales: tono que deriva al azar entre tres puntos clave.
    const N = 40;
    const f0 = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const p = i / (N - 1);
      const [a, b, c] = spec.pitch;
      const base = p < 0.3 ? a + (b - a) * (p / 0.3) : b + (c - b) * ((p - 0.3) / 0.7);
      f0[i] = base * rnd(0.94, 1.06);
    }
    const voice = ctx.createOscillator();
    voice.type = 'sawtooth';
    voice.frequency.setValueCurveAtTime(f0, t, dur + 0.3);
    const sub = ctx.createOscillator();
    sub.type = 'square';
    sub.frequency.setValueCurveAtTime(f0.map((v) => v / 2), t, dur + 0.3);
    const subGain = ctx.createGain();
    subGain.gain.value = kind === 'scream' ? 0.15 : 0.4;
    voice.connect(fry);
    sub.connect(subGain).connect(fry);

    // Aliento: ruido por la garganta y directo a los formantes.
    const breath = ctx.createBufferSource();
    breath.buffer = this.noiseBuf;
    breath.loop = true;
    const bf = ctx.createBiquadFilter();
    bf.type = kind === 'scream' || kind === 'snarl' ? 'highpass' : 'bandpass';
    bf.frequency.value = kind === 'scream' || kind === 'snarl' ? 900 : 1300;
    bf.Q.value = 0.8;
    const bg = ctx.createGain();
    bg.gain.value = spec.breath;
    breath.connect(bf).connect(bg);
    bg.connect(bank);
    const grit = ctx.createGain();
    grit.gain.value = 0.25;
    bg.connect(grit).connect(shaper);

    // Envolvente: los gruñidos van a golpes; el resto, un solo aliento.
    const g = out.gain;
    g.setValueAtTime(0.0001, t);
    if (kind === 'growl') {
      let k = t;
      while (k < t + dur) {
        const len = rnd(0.14, 0.32);
        g.linearRampToValueAtTime(spec.gain, k + 0.04);
        g.linearRampToValueAtTime(spec.gain * 0.25, k + len);
        k += len + rnd(0.02, 0.1);
      }
    } else {
      g.linearRampToValueAtTime(spec.gain, t + spec.attack);
      g.setTargetAtTime(spec.gain * 0.75, t + spec.attack + 0.1, dur / 3);
    }
    g.setTargetAtTime(0.0001, t + dur, 0.12);
    for (const node of [voice, sub, fryLfo]) {
      node.start(t);
      node.stop(end);
    }
    breath.start(t, Math.random() * 2);
    breath.stop(end);
  }

  /**
   * Trueno: crujido que rasga el cielo (chasquidos rápidos), estallido y un
   * retumbe de ruido marrón que va y viene durante varios segundos.
   */
  thunder(delay = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = this.now + delay;
    const rnd = (a, b) => a + Math.random() * (b - a);
    // Bus propio con más ganancia y mucha sala: el trueno tiene que mandar.
    if (!this.thunderBus) {
      this.thunderBus = ctx.createGain();
      this.thunderBus.gain.value = 2.4;
      this.thunderBus.connect(this.master);
      const send = ctx.createGain();
      send.gain.value = 0.5;
      this.thunderBus.connect(send).connect(this.reverbSend);
      // Ruido marrón (grave y redondo): la base del retumbe.
      const len = ctx.sampleRate * 4;
      this.brownBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.brownBuf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
        d[i] = last * 3.5;
      }
    }
    const dest = this.thunderBus;

    // 1. Crujido: chasquidos secos cada vez más graves durante medio segundo.
    const cracks = 14 + Math.floor(Math.random() * 10);
    for (let i = 0; i < cracks; i++) {
      const at = t + (i / cracks) ** 1.6 * rnd(0.45, 0.7);
      this.noise(at, rnd(0.015, 0.05), { type: 'bandpass', freq: rnd(1800, 4200) * (1 - i / cracks / 2), q: rnd(1, 3), gain: rnd(0.5, 1.1), a: 0.001, dest });
    }
    // 2. Estallido.
    this.noise(t + 0.05, 0.9, { type: 'lowpass', freq: 1400, sweepTo: 200, q: 0.5, gain: 1.6, a: 0.008, dest });
    this.tone(t + 0.06, 65, 1.8, { glideTo: 30, gain: 0.9, a: 0.01, dest });

    // 3. Retumbe: ruido marrón con oleadas al azar, de 5 a 7 segundos.
    const dur = rnd(5, 7);
    const src = ctx.createBufferSource();
    src.buffer = this.brownBuf;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(420, t);
    lp.frequency.exponentialRampToValueAtTime(110, t + dur);
    const g = ctx.createGain();
    const N = 48;
    const swell = new Float32Array(N);
    let v = 1;
    for (let i = 0; i < N; i++) {
      const p = i / (N - 1);
      v = v * 0.6 + rnd(0.3, 1.4) * 0.4;
      swell[i] = Math.max(0.0001, v * (1 - p) ** 1.4 * Math.min(1, p * 12) * 1.8);
    }
    swell[N - 1] = 0.0001;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.setValueCurveAtTime(swell, t + 0.1, dur);
    src.connect(lp).connect(g).connect(dest);
    src.start(t, Math.random() * 3);
    src.stop(t + dur + 0.3);

    // El zumbido de fondo se aparta para que se oiga entero.
    if (this.droneOut && !this.paused) {
      this.droneOut.gain.setTargetAtTime(0.05, t, 0.05);
      this.droneOut.gain.setTargetAtTime(0.16, t + dur * 0.6, 0.8);
    }
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
