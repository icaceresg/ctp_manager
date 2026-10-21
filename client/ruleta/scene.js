// Escena 3D de la ruleta: máquina de chicles + caja misteriosa en unas ruinas
// de noche, y la secuencia completa del sorteo (~45 s).
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildWorld } from './world.js';
import {
  GUM_COLORS,
  gumTexture,
  labelTexture,
  questionTexture,
  ringTexture,
  signTexture,
  smokeTexture,
  softDotTexture,
  woodTexture,
} from './textures.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = {
  linear: (t) => t,
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  out: (t) => 1 - (1 - t) ** 3,
  in: (t) => t * t * t,
  outBack: (t) => {
    const c1 = 2.2;
    const c3 = c1 + 1;
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
  },
  outElastic: (t) => (t === 0 || t === 1 ? t : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
};

/** Línea de tiempo sencilla: tweens y eventos puntuales en segundos. */
class Timeline {
  constructor() {
    this.items = [];
    this.t = 0;
  }
  tween(start, dur, update, { e = ease.inOut, init } = {}) {
    this.items.push({ kind: 'tween', start, dur, update, e, init });
    return this;
  }
  at(start, fn) {
    this.items.push({ kind: 'at', start, fn });
    return this;
  }
  update(dt) {
    this.t += dt;
    for (const it of this.items) {
      if (it.done || this.t < it.start) continue;
      if (it.kind === 'at') {
        it.done = true;
        it.fn();
        continue;
      }
      if (!it.started) {
        it.started = true;
        it.init?.();
      }
      const p = clamp01((this.t - it.start) / it.dur);
      it.update(it.e(p), p);
      if (p >= 1) it.done = true;
    }
  }
}

const colorFor = (key) => {
  let h = 7;
  for (const ch of String(key)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return GUM_COLORS[h % GUM_COLORS.length];
};

// Posiciones clave del escenario
const GM_POS = V(-3.3, 0, 0);
const MB_POS = V(2.9, 0, 0.15);
const MB_ROT = -0.32;

const IDLE_CAM = { pos: V(0.2, 3.3, 10.8), target: V(-0.1, 2.0, 0) };

// Recorrido de cámara en reposo: enseña el búnker hasta que alguien gira.
// Los planos "glide" salen de donde acabó el anterior (movimiento continuo);
// el resto entra con un corte y un fundido a negro muy corto.
const shot = (from, to, tf, tt, dur, glide = false) => ({ from: from && V(...from), to: to.isVector3 ? to : V(...to), tf: tf && V(...tf), tt: tt.isVector3 ? tt : V(...tt), dur, glide });
const orbitShot = (center, r, y, a0, a1, dur) => ({ orbit: true, center: V(...center), r, y, a0, a1, dur });
const TOUR = [
  // Por debajo de las lámparas colgantes (la del centro cuelga en z = 11.5).
  shot([-3.4, 4.3, 15.4], [2.4, 3.9, 13.6], [0, 3.4, -4], [0, 3.1, -3], 7), // plano general
  shot(null, [1.3, 5.0, 1.6], null, [0.7, 5.6, -7.2], 6.5, true), // lona de PlayCTP
  shot([-3.8, 3.1, -2.2], [-6.4, 3.0, -2.6], [-4.9, 2.9, -7.2], [-5.9, 2.9, -7.2], 6), // CTP MAJOR
  shot([-8.6, 3.0, 5.2], [-8.4, 3.2, 2.0], [-12.6, 3.0, 3.0], [-12.6, 3.1, 2.0], 6), // CTP CUP
  shot(null, [-8.6, 3.7, -1.0], null, [-12.5, 3.7, -1.2], 5.5, true), // pantalla LED
  shot([7.6, 4.0, 4.4], [7.6, 3.8, -0.4], [12.6, 3.9, 2.6], [12.6, 3.9, 0.9], 6.5), // divisiones de Ranked
  shot(null, [6.4, 4.5, 8.8], null, [12.6, 4.8, 7.2], 6, true), // logo de MW4
  shot([7.0, 3.3, -3.2], [9.6, 3.2, -3.4], [8.6, 2.9, -7.2], [10.6, 3.0, -7.2], 6), // grafiti y CTP CHAMP
  orbitShot([-3.3, 2.4, 0], 4.3, 3.1, 0.35, -0.75, 7), // máquina de chicles
  orbitShot([2.9, 1.1, 0.15], 3.8, 2.0, 1.0, 0.05, 6.5), // caja del destino
  shot([-4.2, 2.3, 6.4], [-6.4, 2.7, 6.9], [-10.4, 1.6, 9.0], [-10.0, 1.9, 10.6], 6), // contenedores y bidones
  shot(null, IDLE_CAM.pos, null, IDLE_CAM.target, 7, true), // vuelta al plano principal
];
TOUR.forEach((sh, i) => {
  if (!sh.glide) return;
  const prev = TOUR[i - 1];
  sh.from = prev.to;
  sh.tf = prev.tt;
});
const TOUR_LENGTH = TOUR.reduce((sum, sh) => sum + sh.dur, 0);
const FADE = 0.45;

// Objetos temporales reutilizados en cada imagen (sin basura para el GC).
const TMP = { color: new THREE.Color(), m4: new THREE.Matrix4(), q: new THREE.Quaternion(), eul: new THREE.Euler(), one: V(1, 1, 1), scale: V(1, 1, 1) };

/**
 * Calidad: "alta" o "baja". Se fuerza con ?calidad=baja|alta; si no, se
 * decide por la GPU y el equipo, y baja sola si no llega a ~40 imágenes/s.
 */
function pickQuality(renderer) {
  const forced = new URLSearchParams(location.search).get('calidad');
  if (forced === 'baja' || forced === 'alta') return { level: forced, forced: true };
  let gpu = '';
  try {
    const gl = renderer.getContext();
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    gpu = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
  } catch {
    /* sin información de la GPU */
  }
  const weakGpu = /swiftshader|llvmpipe|softpipe|software|basic render|intel.*\b(hd|uhd) graphics|mali|adreno|powervr/i.test(gpu);
  const weakPc = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4;
  return { level: weakGpu || weakPc ? 'baja' : 'alta', forced: false, gpu };
}

export class Stage {
  constructor(canvas, audio) {
    this.canvas = canvas;
    this.audio = audio;
    this.onCue = () => {};
    this.mode = 'idle';
    this.clock = new THREE.Clock();
    this.elapsed = 0;
    this.flashes = [];
    this.textureCache = new Map();
    this.shake = 0;
    this.agitate = 0;

    // Sin antialias de contexto: todo pasa por el compositor, que no lo usa.
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0d0a0c, 0.018);
    this.scene = scene;
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.22;

    this.camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 300);
    this.cam = { pos: IDLE_CAM.pos.clone(), target: IDLE_CAM.target.clone() };
    this.camera.position.copy(this.cam.pos);

    this.tex = {
      dot: softDotTexture(),
      smoke: smokeTexture(),
      ring: ringTexture(),
      question: questionTexture(),
    };

    this.buildSky();
    this.buildLights();
    this.buildMachine();
    this.buildBox();
    this.buildParticles();
    this.world = buildWorld(this);
    this.buildPost();

    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.nextLightning = 6 + Math.random() * 8;
    this.nextZombie = 4 + Math.random() * 5;
    this.tourT = 0;
    this.frameAcc = 0;
    this.perf = { n: 0, sum: 0, warm: false };
    this.quality = pickQuality(renderer);
    if (this.quality.level === 'baja') this.applyLowQuality();
    renderer.setAnimationLoop(() => this.tick());
  }

  // ======================================================================
  // Construcción
  // ======================================================================

  buildSky() {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { uTime: { value: 0 }, uFlash: { value: 0 }, uMoon: { value: V(8, 120, -40).normalize() } },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vDir;
        uniform float uTime;
        uniform float uFlash;
        uniform vec3 uMoon;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
        }
        float fbm(vec2 p) {
          float v = 0.0, a = 0.5;
          for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
          return v;
        }
        void main() {
          float h = vDir.y;
          vec3 horizon = vec3(0.09, 0.02, 0.035);
          vec3 top = vec3(0.012, 0.01, 0.025);
          vec3 col = mix(horizon, top, smoothstep(-0.05, 0.55, h));
          vec2 uv = vDir.xz / (h + 0.35) * 1.6 + vec2(uTime * 0.012, uTime * 0.004);
          float c = fbm(uv);
          float clouds = smoothstep(0.42, 0.85, c) * smoothstep(-0.05, 0.25, h);
          float md = max(dot(vDir, uMoon), 0.0);
          vec3 moonGlow = vec3(0.9, 0.55, 0.45) * (pow(md, 600.0) * 3.0 + pow(md, 40.0) * 0.25);
          col += moonGlow * (1.0 - clouds * 0.8);
          col = mix(col, vec3(0.05, 0.03, 0.05) + vec3(0.25, 0.12, 0.14) * pow(md, 12.0), clouds * 0.85);
          col += uFlash * (vec3(0.55, 0.6, 0.95) * (0.25 + clouds * 1.4));
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(150, 32, 16), mat);
    this.scene.add(this.sky);
    // Después de lo opaco: solo se pinta el cielo que se ve por el boquete.
    this.sky.renderOrder = 1;
    // Luna, visible por el boquete del techo
    const moon = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.tex.dot, color: new THREE.Color(1.6, 1.0, 0.85), fog: false, depthWrite: false }),
    );
    moon.position.set(8, 120, -40);
    moon.scale.setScalar(16);
    this.scene.add(moon);
  }

  buildLights() {
    const s = this.scene;
    this.hemi = new THREE.HemisphereLight(0x3a4466, 0x1a0e0a, 0.42);
    s.add(this.hemi);

    const moon = new THREE.DirectionalLight(0x8fa6ff, 0.55);
    moon.position.set(-8, 12, -10);
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    Object.assign(moon.shadow.camera, { left: -12, right: 12, top: 10, bottom: -6, near: 1, far: 40 });
    moon.shadow.bias = -0.0005;
    s.add(moon);
    this.moonLight = moon;

    const machineKey = new THREE.SpotLight(0xff6f8a, 80, 18, 0.5, 0.6, 1.4);
    machineKey.position.set(-1.6, 7.5, 4.5);
    machineKey.target.position.copy(GM_POS).add(V(0, 2.4, 0));
    machineKey.castShadow = true;
    machineKey.shadow.mapSize.set(1024, 1024);
    s.add(machineKey, machineKey.target);
    this.machineKey = machineKey;

    const boxKey = new THREE.SpotLight(0x9fe8ff, 110, 18, 0.5, 0.7, 1.4);
    boxKey.position.set(4.2, 7.5, 4.8);
    boxKey.target.position.copy(MB_POS).add(V(0, 0.6, 0));
    boxKey.castShadow = true;
    boxKey.shadow.mapSize.set(1024, 1024);
    s.add(boxKey, boxKey.target);
    this.boxKey = boxKey;

    const rim = new THREE.PointLight(0x8a3cff, 18, 14, 1.4);
    rim.position.set(0, 4.5, -3.5);
    s.add(rim);
    this.rim = rim;

    // Destello de los rayos
    this.flashLight = new THREE.DirectionalLight(0xc8d4ff, 0);
    this.flashLight.position.set(3, 14, -6);
    s.add(this.flashLight);
  }

  buildMachine() {
    const g = new THREE.Group();
    g.position.copy(GM_POS);
    g.rotation.y = 0.28;
    this.scene.add(g);
    this.machine = g;

    const red = new THREE.MeshPhysicalMaterial({ color: 0x9b0f1a, roughness: 0.3, metalness: 0.25, clearcoat: 1, clearcoatRoughness: 0.08 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xd4a843, roughness: 0.28, metalness: 1 });
    const chrome = new THREE.MeshStandardMaterial({ color: 0xe8e8ec, roughness: 0.12, metalness: 1 });
    const iron = new THREE.MeshStandardMaterial({ color: 0x24201d, roughness: 0.5, metalness: 0.8 });
    const add = (geo, mat, x, y, z, rx = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.x = rx;
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
      return m;
    };
    add(new THREE.CylinderGeometry(1.0, 1.15, 0.35, 48), iron, 0, 0.175, 0);
    add(new THREE.TorusGeometry(1.05, 0.045, 12, 64), gold, 0, 0.35, 0, Math.PI / 2);
    add(new THREE.CylinderGeometry(0.32, 0.45, 1.0, 32), red, 0, 0.85, 0);
    add(new THREE.CylinderGeometry(0.9, 0.78, 1.15, 48), red, 0, 1.9, 0);
    add(new THREE.TorusGeometry(0.9, 0.05, 12, 64), gold, 0, 2.475, 0, Math.PI / 2);
    add(new THREE.TorusGeometry(0.78, 0.05, 12, 64), gold, 0, 1.325, 0, Math.PI / 2);
    add(new THREE.CylinderGeometry(0.76, 0.9, 0.18, 48), gold, 0, 2.56, 0);
    // Panel de la moneda y la manivela
    add(new THREE.BoxGeometry(0.62, 0.5, 0.1), chrome, 0, 2.05, 0.82);
    add(new THREE.BoxGeometry(0.16, 0.04, 0.02), iron, 0, 2.22, 0.88);
    const crank = new THREE.Group();
    crank.position.set(0, 2.0, 0.92);
    g.add(crank);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.12, 24), chrome);
    hub.rotation.x = Math.PI / 2;
    crank.add(hub);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.46, 0.05), chrome);
    arm.position.set(0, 0.2, 0.06);
    crank.add(arm);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.22, 16), red);
    handle.rotation.x = Math.PI / 2;
    handle.position.set(0, 0.4, 0.16);
    crank.add(handle);
    this.crank = crank;
    // Salida de los chicles y bandeja
    add(new THREE.BoxGeometry(0.42, 0.34, 0.12), chrome, 0, 1.52, 0.8);
    const hole = new THREE.Mesh(new THREE.CircleGeometry(0.13, 24), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    hole.position.set(0, 1.52, 0.865);
    g.add(hole);
    const tray = add(new THREE.SphereGeometry(0.26, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), chrome, 0, 1.42, 1.0);
    tray.material = chrome.clone();
    tray.material.side = THREE.DoubleSide;
    tray.scale.set(1, 0.55, 0.8);

    // Bola de cristal
    const globeY = 3.6;
    const glass = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.03,
      metalness: 0,
      transparent: true,
      opacity: 0.14,
      clearcoat: 1,
      envMapIntensity: 2.2,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const globe = new THREE.Mesh(new THREE.SphereGeometry(1.1, 64, 40), glass);
    globe.position.y = globeY;
    globe.renderOrder = 5;
    g.add(globe);
    // Reflejo especular falso para que se lea como cristal
    const shine = new THREE.Mesh(
      new THREE.SphereGeometry(1.105, 48, 24, 0.4, 0.5, 0.55, 0.45),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.09, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    shine.position.y = globeY;
    g.add(shine);
    add(new THREE.CylinderGeometry(0.55, 0.78, 0.28, 48), red, 0, 4.72, 0);
    add(new THREE.TorusGeometry(0.62, 0.04, 12, 48), gold, 0, 4.62, 0, Math.PI / 2);
    add(new THREE.SphereGeometry(0.55, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), gold, 0, 4.86, 0);
    add(new THREE.SphereGeometry(0.14, 20, 12), chrome, 0, 5.47, 0);

    // Cartel luminoso
    const signTex = signTexture();
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(1.9, 0.475),
      new THREE.MeshStandardMaterial({ map: signTex, emissiveMap: signTex, emissive: 0xffffff, emissiveIntensity: 0.6, roughness: 0.5 }),
    );
    sign.position.set(0, 5.95, 0);
    g.add(sign);
    this.sign = sign;
    add(new THREE.BoxGeometry(0.06, 0.5, 0.06), iron, -0.5, 5.6, 0);
    add(new THREE.BoxGeometry(0.06, 0.5, 0.06), iron, 0.5, 5.6, 0);

    // Chicles dentro de la bola
    const N = 64;
    const balls = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.16, 20, 14),
      new THREE.MeshPhysicalMaterial({ roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.15, emissive: 0x111111 }),
      N,
    );
    balls.castShadow = true;
    const base = [];
    const tmp = new THREE.Vector3();
    let tries = 0;
    while (base.length < N && tries < 20000) {
      tries++;
      tmp.set((Math.random() - 0.5) * 1.8, -0.9 + Math.random() * 1.25, (Math.random() - 0.5) * 1.8);
      if (tmp.length() > 0.9) continue;
      if (base.some((b) => b.distanceTo(tmp) < 0.3)) continue;
      base.push(tmp.clone());
    }
    const col = new THREE.Color();
    base.forEach((_, i) => balls.setColorAt(i, col.set(GUM_COLORS[i % GUM_COLORS.length])));
    balls.count = base.length;
    balls.position.y = globeY;
    g.add(balls);
    this.globeBalls = { mesh: balls, base, phase: base.map(() => Math.random() * 10) };

    // Bombillas alrededor de la base de la bola y del cartel
    const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshBasicMaterial(), 26);
    const m4 = TMP.m4;
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      bulbs.setMatrixAt(i, m4.makeTranslation(Math.cos(a) * 0.86, 2.66, Math.sin(a) * 0.86));
    }
    for (let i = 0; i < 8; i++) bulbs.setMatrixAt(18 + i, m4.makeTranslation(-0.82 + i * 0.234, 6.24, 0.02));
    for (let i = 0; i < 26; i++) bulbs.setColorAt(i, col.set(0xffffff));
    g.add(bulbs);
    this.bulbs = bulbs;

    const glow = new THREE.PointLight(0xff3b6b, 6, 5, 1.5);
    glow.position.set(0, 3.6, 0);
    g.add(glow);
    this.machineGlow = glow;
  }

  buildBox() {
    const g = new THREE.Group();
    g.position.copy(MB_POS);
    g.rotation.y = MB_ROT;
    this.scene.add(g);
    this.box = g;
    this.boxBase = g.position.clone();

    const W = 2.4;
    const H = 0.85;
    const D = 1.15;
    const T = 0.1;
    const wood = new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.85, color: 0xb08a70 });
    const iron = new THREE.MeshStandardMaterial({ color: 0x2b2622, roughness: 0.45, metalness: 0.85 });
    const add = (parent, geo, mat, x, y, z) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };
    // Losa de piedra
    add(g, new THREE.BoxGeometry(W + 0.5, 0.12, D + 0.5), new THREE.MeshStandardMaterial({ color: 0x2c2724, roughness: 1 }), 0, 0.06, 0);
    const y0 = 0.12;
    add(g, new THREE.BoxGeometry(W, T, D), wood, 0, y0 + T / 2, 0);
    add(g, new THREE.BoxGeometry(W, H, T), wood, 0, y0 + H / 2, D / 2 - T / 2);
    add(g, new THREE.BoxGeometry(W, H, T), wood, 0, y0 + H / 2, -D / 2 + T / 2);
    add(g, new THREE.BoxGeometry(T, H, D - 2 * T), wood, W / 2 - T / 2, y0 + H / 2, 0);
    add(g, new THREE.BoxGeometry(T, H, D - 2 * T), wood, -W / 2 + T / 2, y0 + H / 2, 0);
    // Herrajes
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        add(g, new THREE.BoxGeometry(0.16, H + 0.02, 0.16), iron, sx * (W / 2 - 0.06), y0 + H / 2, sz * (D / 2 - 0.06));
      }
      add(g, new THREE.BoxGeometry(0.1, H + 0.02, D + 0.02), iron, sx * 0.55, y0 + H / 2, 0);
    }
    // Interior luminoso
    const inner = new THREE.Mesh(
      new THREE.PlaneGeometry(W - 0.25, D - 0.25),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.4, 2.2) }),
    );
    inner.rotation.x = -Math.PI / 2;
    inner.position.y = y0 + T + 0.01;
    g.add(inner);
    this.boxInner = inner;
    const innerLight = new THREE.PointLight(0x7fe8ff, 0, 7, 1.3);
    innerLight.position.set(0, y0 + 0.9, 0);
    g.add(innerLight);
    this.boxLight = innerLight;

    // Tapa con bisagra en el borde trasero
    const lid = new THREE.Group();
    lid.position.set(0, y0 + H, -D / 2);
    g.add(lid);
    add(lid, new THREE.BoxGeometry(W + 0.06, 0.2, D + 0.06), wood, 0, 0.1, D / 2);
    for (const sx of [-1, 1]) add(lid, new THREE.BoxGeometry(0.1, 0.22, D + 0.08), iron, sx * 0.55, 0.1, D / 2);
    add(lid, new THREE.BoxGeometry(W + 0.08, 0.22, 0.1), iron, 0, 0.1, D + 0.02);
    this.lid = lid;

    // Interrogaciones luminosas (dos delante, una detrás, una por lado y una en la tapa)
    const qMat = new THREE.MeshBasicMaterial({
      map: this.tex.question,
      color: new THREE.Color(1.2, 1.45, 1.55),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.qMat = qMat;
    const q = (parent, x, y, z, ry, s = 0.6, rx = 0) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(s, s), qMat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, 0);
      parent.add(m);
    };
    q(g, -0.85, y0 + H / 2, D / 2 + 0.005, 0);
    q(g, 0.85, y0 + H / 2, D / 2 + 0.005, 0);
    q(g, 0, y0 + H / 2, -D / 2 - 0.005, Math.PI);
    q(g, W / 2 + 0.005, y0 + H / 2, 0, Math.PI / 2);
    q(g, -W / 2 - 0.005, y0 + H / 2, 0, -Math.PI / 2);
    q(lid, 0, 0.205, D / 2, 0, 0.55, -Math.PI / 2);

    // Haz de luz que sale al cielo
    const beamMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      fog: false,
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: 0.25 },
        uColor: { value: new THREE.Color(0.35, 0.9, 1.0) },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vN;
        varying vec3 vView;
        void main() {
          vUv = uv;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vView = normalize(-mv.xyz);
          vN = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vN;
        varying vec3 vView;
        uniform float uTime;
        uniform float uIntensity;
        uniform vec3 uColor;
        void main() {
          float facing = abs(dot(vN, vView));
          float edge = pow(1.0 - facing, 1.4);
          float fade = pow(1.0 - vUv.y, 2.2) * smoothstep(0.0, 0.02, vUv.y);
          float stripes = 0.75 + 0.25 * sin(vUv.x * 50.0 + uTime * 1.5 + vUv.y * 20.0);
          float a = (0.25 + edge * 0.75) * fade * stripes * uIntensity;
          gl_FragColor = vec4(uColor * a, a);
        }`,
    });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.05, 30, 48, 1, true), beamMat);
    beam.position.set(0, 15.1, 0);
    g.add(beam);
    this.beam = beam;

    // Halo en el suelo bajo la caja
    const halo = new THREE.Mesh(
      new THREE.PlaneGeometry(5.5, 4),
      new THREE.MeshBasicMaterial({ map: this.tex.dot, color: new THREE.Color(0.2, 0.7, 1.0), transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.02;
    g.add(halo);
    this.boxHalo = halo;
  }

  buildParticles() {
    // Brasas que suben
    const N = 420;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    const data = [];
    for (let i = 0; i < N; i++) {
      const d = { x: (Math.random() - 0.5) * 22, y: Math.random() * 9, z: (Math.random() - 0.5) * 14 - 1, s: 0.3 + Math.random() * 0.7, p: Math.random() * 10 };
      data.push(d);
      const c = new THREE.Color().setHSL(0.04 + Math.random() * 0.06, 1, 0.5 + Math.random() * 0.2).multiplyScalar(2.2);
      col.set([c.r, c.g, c.b], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const pts = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ size: 0.07, map: this.tex.dot, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.scene.add(pts);
    this.embers = { pts, data, pos };

    // Niebla a ras de suelo
    this.mist = [];
    for (let i = 0; i < 16; i++) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(7, 3.2),
        new THREE.MeshBasicMaterial({ map: this.tex.smoke, color: 0x4a3f58, transparent: true, opacity: 0.14, depthWrite: false }),
      );
      m.position.set((Math.random() - 0.5) * 20, 0.6 + Math.random() * 0.6, (Math.random() - 0.5) * 10 - 1);
      this.scene.add(m);
      this.mist.push({ m, v: 0.15 + Math.random() * 0.25 });
    }

    // Chispas de la revelación y del ciclo
    const SN = 900;
    const sgeo = new THREE.BufferGeometry();
    this.sparks = { pos: new Float32Array(SN * 3), col: new Float32Array(SN * 3), items: [], N: SN, next: 0 };
    sgeo.setAttribute('position', new THREE.BufferAttribute(this.sparks.pos, 3));
    sgeo.setAttribute('color', new THREE.BufferAttribute(this.sparks.col, 3));
    for (let i = 0; i < SN; i++) this.sparks.items.push({ life: 0 });
    const spts = new THREE.Points(
      sgeo,
      new THREE.PointsMaterial({ size: 0.09, map: this.tex.dot, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    spts.frustumCulled = false;
    this.scene.add(spts);
    this.sparks.pts = spts;

    // Confeti
    const CN = 320;
    const conf = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.07, 0.13), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), CN);
    conf.frustumCulled = false;
    const c = TMP.color;
    this.confetti = { mesh: conf, items: [] };
    for (let i = 0; i < CN; i++) {
      conf.setColorAt(i, c.set(i % 3 === 0 ? '#ffe9a8' : i % 3 === 1 ? '#d4a843' : GUM_COLORS[i % GUM_COLORS.length]).multiplyScalar(1.4));
      this.confetti.items.push({ life: 0, p: V(0, -10, 0), v: V(), r: V(), w: V() });
      conf.setMatrixAt(i, new THREE.Matrix4().makeTranslation(0, -10, 0));
    }
    this.scene.add(conf);

    // Onda expansiva
    this.shock = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: this.tex.ring, color: new THREE.Color(2.4, 1.8, 0.8), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.shock.rotation.x = -Math.PI / 2;
    this.shock.position.copy(MB_POS).setY(0.05);
    this.scene.add(this.shock);
  }

  buildPost() {
    const composer = new EffectComposer(this.renderer);
    composer.addPass(new RenderPass(this.scene, this.camera));
    // Bloom moderado: con más, neones y carteles se quemaban.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1024, 576), 0.38, 0.4, 0.92);
    composer.addPass(this.bloom);
    composer.addPass(new OutputPass());
    this.finalPass = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        uTime: { value: 0 },
        uFlash: { value: 0 },
        uAberration: { value: 0.0015 },
        uFlashColor: { value: new THREE.Color(1, 1, 1) },
        uLightning: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform float uTime;
        uniform float uFlash;
        uniform float uAberration;
        uniform vec3 uFlashColor;
        uniform float uLightning;
        varying vec2 vUv;
        float rand(vec2 co) { return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453); }
        void main() {
          vec2 d = vUv - 0.5;
          vec2 off = d * uAberration * 2.0;
          vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
          float vig = smoothstep(0.95, 0.25, length(d * vec2(1.15, 1.0)));
          col *= mix(0.35, 1.0, vig);
          // Relámpago: destello azulado sobre toda la imagen.
          col += uLightning * vec3(0.6, 0.68, 0.95) * mix(0.6, 1.0, vig);
          col += (rand(vUv * 1000.0 + uTime) - 0.5) * 0.045;
          col = mix(col, uFlashColor, clamp(uFlash, 0.0, 1.0));
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    composer.addPass(this.finalPass);
    this.composer = composer;
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w / 2, h / 2);
    const aspect = w / h;
    this.camera.aspect = aspect;
    // En pantallas estrechas se abre el ángulo para que quepa la escena.
    this.camera.fov = aspect < 1.6 ? Math.min(75, 38 * (1.6 / aspect) ** 0.85) : 38;
    this.camera.updateProjectionMatrix();
  }

  // ======================================================================
  // Recursos de los chicles
  // ======================================================================

  textures(p) {
    let t = this.textureCache.get(p.key);
    if (!t) {
      const color = colorFor(p.key);
      t = { color, gum: gumTexture(p.name, color), label: labelTexture(p.name, color) };
      this.textureCache.set(p.key, t);
    }
    return t;
  }

  makeGum(p, radius = 0.28) {
    const t = this.textures(p);
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 48, 32),
      new THREE.MeshPhysicalMaterial({
        map: t.gum,
        emissiveMap: t.gum,
        emissive: 0xffffff,
        emissiveIntensity: 0.08,
        roughness: 0.4,
        clearcoat: 0.6,
        clearcoatRoughness: 0.25,
      }),
    );
    mesh.castShadow = true;
    group.add(mesh);
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.tex.dot, color: new THREE.Color(t.color).multiplyScalar(1.3), transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    glow.scale.setScalar(radius * 3.6);
    group.add(glow);
    // Color por debajo del umbral del bloom (0.92) para que el nombre no se emborrone.
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: t.label.texture, color: new THREE.Color(0.86, 0.86, 0.86), transparent: true, depthWrite: false }));
    label.userData.aspect = t.label.aspect;
    const lh = 0.4;
    label.scale.set(lh * t.label.aspect, lh, 1);
    label.position.y = radius + 0.3;
    label.material.opacity = 0;
    label.renderOrder = 10;
    group.add(label);
    group.userData = { mesh, glow, label, radius, person: p };
    this.scene.add(group);
    return group;
  }

  setGumPerson(gum, p, labelHeight) {
    const t = this.textures(p);
    const { mesh, glow, label } = gum.userData;
    mesh.material.map = t.gum;
    mesh.material.emissiveMap = t.gum;
    mesh.material.needsUpdate = false;
    glow.material.color.set(t.color).multiplyScalar(1.3);
    label.material.map = t.label.texture;
    label.scale.set(labelHeight * t.label.aspect, labelHeight, 1);
    gum.userData.person = p;
  }

  disposeGum(gum) {
    this.scene.remove(gum);
    gum.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose();
    });
  }

  // ======================================================================
  // Efectos
  // ======================================================================

  lightning(strength = 1, withThunder = true) {
    const now = this.elapsed;
    const pattern = [
      [0, 1],
      [0.07, 0.15],
      [0.12, 0.8],
      [0.22, 0.1],
      [0.3, 0.55],
    ];
    for (const [dt, v] of pattern) this.flashes.push({ t: now + dt, v: v * strength });
    // El trueno llega casi a la vez para que se asocie al destello.
    if (withThunder) this.audio.thunder(0.08 + Math.random() * 0.2);
  }

  burstSparks(origin, count, { speed = 4, up = 3, colors = ['#ffe9a8', '#d4a843', '#ffffff'], life = 2.2, gravity = 6 } = {}) {
    const s = this.sparks;
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const it = s.items[s.next];
      s.next = (s.next + 1) % s.N;
      const dir = V(Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5).normalize();
      it.p = origin.clone();
      it.v = dir.multiplyScalar(speed * (0.3 + Math.random() * 0.9)).add(V(0, up * Math.random(), 0));
      it.life = it.max = life * (0.5 + Math.random() * 0.6);
      it.g = gravity;
      c.set(colors[i % colors.length]).multiplyScalar(2.5);
      it.c = [c.r, c.g, c.b];
    }
  }

  launchConfetti(origin) {
    for (const it of this.confetti.items) {
      it.life = 6 + Math.random() * 3;
      it.p.copy(origin).add(V((Math.random() - 0.5) * 0.8, 0, (Math.random() - 0.5) * 0.8));
      it.v.set((Math.random() - 0.5) * 7, 6 + Math.random() * 7, (Math.random() - 0.5) * 5);
      it.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      it.w.set((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12);
    }
  }

  // ======================================================================
  // Bucle
  // ======================================================================

  /** Calidad baja: menos resolución, sin sombras y sin luces de ambiente. */
  applyLowQuality() {
    this.frameCap = 1 / 30;
    this.screenFps = 12;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
    this.renderer.shadowMap.enabled = false;
    for (const l of this.world.optionalLights) l.visible = false;
    // Compensa las luces que se apagan para que no quede a oscuras.
    this.hemi.intensity = 0.62;
    this.scene.environmentIntensity = 0.34;
    this.scene.traverse((o) => {
      if (o.material) for (const m of [].concat(o.material)) m.needsUpdate = true;
    });
    this.resize();
  }

  /** Mide el rendimiento en reposo y rebaja la calidad si no llega. */
  watchPerformance(step) {
    const p = this.perf;
    if (this.quality.forced || this.fixedStep || this.mode !== 'idle' || document.hidden) {
      p.n = p.sum = 0;
      return;
    }
    p.n++;
    p.sum += step;
    if (p.sum < 4) return;
    const fps = p.n / p.sum;
    p.n = p.sum = 0;
    // La primera ventana incluye la compilación de shaders: no cuenta.
    if (!p.warm) {
      p.warm = true;
      return;
    }
    if (this.quality.level === 'alta' && fps < 40) {
      this.quality.level = 'baja';
      this.applyLowQuality();
    } else if (this.quality.level === 'baja' && fps < 24 && !this.quality.minimum) {
      this.quality.minimum = true;
      this.renderer.setPixelRatio(0.75);
      this.resize();
    }
  }

  tick() {
    this.frameAcc += Math.min(this.clock.getDelta(), 0.5);
    // En calidad baja se limita a 30 imágenes/s: más estable y menos calor.
    if (this.frameCap && this.frameAcc < this.frameCap * 0.92) return;
    const step = this.frameAcc;
    this.frameAcc = 0;
    this.watchPerformance(step);
    this.frame(this.fixedStep || Math.min(step, 1 / 20));
  }

  /** Recorrido de reposo por el búnker (ver TOUR). */
  updateTour(dt) {
    this.tourT += dt;
    let t = this.tourT % TOUR_LENGTH;
    let i = 0;
    while (t >= TOUR[i].dur) t -= TOUR[i++].dur;
    const sh = TOUR[i];
    const p = t / sh.dur;
    const e = sh.glide ? ease.inOut(p) : p;
    if (sh.orbit) {
      const a = lerp(sh.a0, sh.a1, e);
      this.cam.pos.set(sh.center.x + Math.sin(a) * sh.r, sh.y, sh.center.z + Math.cos(a) * sh.r);
      this.cam.target.copy(sh.center);
    } else {
      this.cam.pos.lerpVectors(sh.from, sh.to, e);
      this.cam.target.lerpVectors(sh.tf, sh.tt, e);
    }
    // Un poco de cámara al hombro.
    const k = this.elapsed;
    this.cam.pos.x += Math.sin(k * 0.7) * 0.05;
    this.cam.pos.y += Math.sin(k * 0.9 + 1) * 0.04;
    const next = TOUR[(i + 1) % TOUR.length];
    let fade = 0;
    if (!sh.glide) fade = Math.max(fade, 1 - t / FADE);
    if (!next.glide) fade = Math.max(fade, 1 - (sh.dur - t) / FADE);
    this.finalPass.uniforms.uFlashColor.value.setRGB(0, 0, 0);
    this.finalPass.uniforms.uFlash.value = clamp01(fade);
  }

  frame(dt) {
    this.elapsed += dt;
    const t = this.elapsed;

    if (this.timeline) this.timeline.update(dt);

    // Cámara: en reposo, órbita lenta; en el sorteo la mueve la línea de tiempo.
    if (this.mode === 'idle') this.updateTour(dt);
    const shake = this.shake;
    this.camera.position.copy(this.cam.pos).add(
      V(Math.sin(t * 37) * shake * 0.05, Math.sin(t * 43 + 1) * shake * 0.05, Math.sin(t * 29 + 2) * shake * 0.03),
    );
    this.camera.lookAt(this.cam.target);

    // Rayos
    // Tormenta: relámpago y trueno juntos, antes y después del sorteo.
    if ((this.mode === 'idle' || this.drawDone) && t > this.nextLightning) {
      if (!this.audio.ctx) this.nextLightning = t + 1;
      else {
        this.lightning(1, true);
        this.nextLightning = t + 12 + Math.random() * 14;
      }
    }
    // Zombis de fondo: antes y después del sorteo, nunca durante.
    if ((this.mode === 'idle' || this.drawDone) && t > this.nextZombie) {
      // Sin sonido activado todavía (falta el primer clic): reintenta en
      // un segundo para que el primero suene nada más entrar.
      if (!this.audio.ctx) this.nextZombie = t + 1;
    }
    if ((this.mode === 'idle' || this.drawDone) && t > this.nextZombie) {
      this.audio.ambientZombie();
      // A veces contesta otro desde el otro lado.
      if (Math.random() < 0.3) this.audio.ambientZombie(0.8 + Math.random() * 1.4);
      // Los audios reales duran más: algo más de espacio entre ellos.
      this.nextZombie = t + (this.audio.hasZombieSamples ? 8 + Math.random() * 10 : 5 + Math.random() * 9);
    }
    let flash = 0;
    this.flashes = this.flashes.filter((f) => {
      const age = t - f.t;
      if (age < 0) return true;
      flash = Math.max(flash, f.v * Math.exp(-age * 18));
      return age < 0.5;
    });
    this.flashLight.intensity = flash * 12;
    this.finalPass.uniforms.uLightning.value = flash * 0.42;
    this.sky.material.uniforms.uFlash.value = flash;
    this.sky.material.uniforms.uTime.value = t;

    // El mapa: luces, fuego, neones, pantalla, lona…
    this.world.update(t, dt, { blackout: this.blackout, agitate: this.agitate });
    this.machineKey.intensity = this.blackout ? 0 : 80;
    this.boxKey.intensity = this.blackout ? 0 : 110 + (this.boxKeyBoost || 0);

    // Bombillas de la máquina: persecución
    const chase = this.agitate > 0 ? 18 : 4;
    const c = new THREE.Color();
    for (let i = 0; i < 26; i++) {
      const on = Math.sin(t * chase - i * 0.9) > 0 ? 1 : 0.18;
      c.setHSL(((i * 0.13 + t * 0.05) % 1 + 1) % 1, 0.9, 0.6).multiplyScalar(on * (this.blackout ? 0.05 : 2));
      this.bulbs.setColorAt(i, c);
    }
    this.bulbs.instanceColor.needsUpdate = true;
    this.sign.material.emissiveIntensity = this.blackout ? 0.05 : 0.58 + Math.sin(t * 3) * 0.08 + (Math.sin(t * 31) > 0.97 ? -1 : 0);
    this.machineGlow.intensity = this.blackout ? 0 : 2 + this.agitate * 6;

    // Chicles de la bola: se agitan con la manivela
    const gb = this.globeBalls;
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < gb.base.length; i++) {
      const b = gb.base[i];
      const ph = gb.phase[i];
      const a = 0.012 + this.agitate * 0.12;
      m4.makeTranslation(b.x + Math.sin(t * 7 + ph) * a, b.y + Math.abs(Math.sin(t * 9 + ph * 2)) * a * 1.5, b.z + Math.cos(t * 6 + ph) * a);
      gb.mesh.setMatrixAt(i, m4);
    }
    gb.mesh.instanceMatrix.needsUpdate = true;

    // Caja: interrogaciones, haz y luz interior
    const qBase = this.qBoost ?? 1;
    const qFlicker = Math.sin(t * 17) > 0.96 ? 0.35 : 1;
    this.qMat.opacity = Math.min(1, (0.75 + Math.sin(t * 2.2) * 0.15) * qFlicker * qBase);
    this.beam.material.uniforms.uTime.value = t;
    if (this.mode === 'idle') {
      this.beam.material.uniforms.uIntensity.value = lerp(this.beam.material.uniforms.uIntensity.value, 0.3, dt);
    }
    this.boxHalo.material.opacity = 0.25 + this.beam.material.uniforms.uIntensity.value * 0.25;

    // Brasas
    const e = this.embers;
    for (let i = 0; i < e.data.length; i++) {
      const d = e.data[i];
      d.y += dt * d.s * 0.6;
      d.x += Math.sin(t * 0.7 + d.p) * dt * 0.25;
      if (d.y > 9) d.y = 0;
      e.pos[i * 3] = d.x;
      e.pos[i * 3 + 1] = d.y;
      e.pos[i * 3 + 2] = d.z;
    }
    e.pts.geometry.attributes.position.needsUpdate = true;

    for (const m of this.mist) {
      m.m.position.x += m.v * dt;
      if (m.m.position.x > 12) m.m.position.x = -12;
      m.m.lookAt(this.camera.position.x, m.m.position.y, this.camera.position.z);
    }

    // Chispas
    const s = this.sparks;
    for (let i = 0; i < s.N; i++) {
      const it = s.items[i];
      if (it.life > 0) {
        it.life -= dt;
        it.v.y -= it.g * dt;
        it.v.multiplyScalar(1 - dt * 0.8);
        it.p.addScaledVector(it.v, dt);
        const k = Math.max(0, it.life / it.max);
        s.pos.set([it.p.x, it.p.y, it.p.z], i * 3);
        s.col.set([it.c[0] * k, it.c[1] * k, it.c[2] * k], i * 3);
      } else if (s.pos[i * 3 + 1] !== -50) {
        s.pos[i * 3 + 1] = -50;
      }
    }
    s.pts.geometry.attributes.position.needsUpdate = true;
    s.pts.geometry.attributes.color.needsUpdate = true;

    // Confeti
    const cf = this.confetti;
    const { q, eul, one } = TMP;
    for (let i = 0; i < cf.items.length; i++) {
      const it = cf.items[i];
      if (it.life <= 0) {
        if (it.alive) {
          it.alive = false;
          cf.mesh.setMatrixAt(i, m4.makeScale(0, 0, 0));
        }
        continue;
      }
      it.alive = true;
      it.life -= dt;
      it.v.y -= 7 * dt;
      it.v.multiplyScalar(1 - dt * 1.6);
      if (it.v.y < -1.4) it.v.y = -1.4;
      it.p.addScaledVector(it.v, dt);
      it.p.x += Math.sin(t * 3 + i) * dt * 0.4;
      it.r.addScaledVector(it.w, dt);
      if (it.p.y < 0.02) {
        it.p.y = 0.02;
        it.w.set(0, 0, 0);
      }
      q.setFromEuler(eul.set(it.r.x, it.r.y, it.r.z));
      m4.compose(it.p, q, it.life > 0.6 ? one : TMP.scale.setScalar(Math.max(0, it.life / 0.6)));
      cf.mesh.setMatrixAt(i, m4);
    }
    cf.mesh.instanceMatrix.needsUpdate = true;

    this.finalPass.uniforms.uTime.value = t;
    this.composer.render(dt);
  }

  // ======================================================================
  // El sorteo
  // ======================================================================

  /**
   * Reproduce la secuencia completa. `result` viene del servidor:
   * { winner: {id, name}, participants: [{id, name}] }.
   */
  playDraw(result) {
    if (this.mode !== 'idle') return Promise.resolve();
    this.mode = 'draw';
    this.drawDone = false;
    // Corte al plano principal: el recorrido puede estar en cualquier rincón.
    this.cam.pos.copy(IDLE_CAM.pos);
    this.cam.target.copy(IDLE_CAM.target);
    this.finalPass.uniforms.uFlash.value = 0;
    const audio = this.audio;
    const { winner } = result;
    const all = result.participants;
    const count = result.participant_count ?? all.length;
    const screen = this.world.screen;
    const show = (text, sub, accent) => Object.assign(screen, { text, sub, accent });
    const tl = new Timeline();
    this.timeline = tl;
    const cam = this.cam;
    const cue = (name, data) => this.onCue(name, data);

    // Chicles que salen de la máquina: hasta 8, el ganador siempre entre ellos.
    const others = all.filter((p) => p.key !== winner.key).sort(() => Math.random() - 0.5);
    const shown = [winner, ...others.slice(0, Math.min(7, others.length))].sort(() => Math.random() - 0.5);
    const k = shown.length;

    // Secuencia de nombres del ciclo final (tics cada vez más lentos).
    const CYCLE_START = 21.2;
    const LOCK = 39.4;
    const intervals = [];
    let d = 0.055;
    let sum = 0;
    while (sum < LOCK - CYCLE_START) {
      intervals.push(d);
      sum += d;
      d *= 1.043;
    }
    const scale = (LOCK - CYCLE_START) / sum;
    const tickTimes = [];
    let acc = CYCLE_START;
    for (const iv of intervals) {
      tickTimes.push(acc);
      acc += iv * scale;
    }
    tickTimes.push(LOCK);
    const pool = all.length > 1 ? all : [winner];
    const seq = [];
    let prev = null;
    for (let i = 0; i < tickTimes.length - 1; i++) {
      let p;
      do p = pool[Math.floor(Math.random() * pool.length)];
      while (pool.length > 1 && p.key === prev?.key);
      // Que el penúltimo no sea el ganador (para que el final sorprenda).
      if (i === tickTimes.length - 2 && p.key === winner.key && pool.length > 1) p = others[0];
      seq.push(p);
      prev = p;
    }
    seq.push(winner);
    // Precarga de texturas para no dar tirones a mitad del ciclo.
    for (const p of new Set([...seq, ...shown])) this.textures(p);

    // ---------- helpers de cámara ----------
    const shot = (start, dur, pos, target, e = ease.inOut) => {
      let p0;
      let t0;
      tl.tween(
        start,
        dur,
        (v) => {
          cam.pos.lerpVectors(p0, pos, v);
          cam.target.lerpVectors(t0, target, v);
        },
        { e, init: () => ((p0 = cam.pos.clone()), (t0 = cam.target.clone())) },
      );
    };

    const machineWorld = (local) => this.machine.localToWorld(local.clone());
    const boxWorld = (local) => this.box.localToWorld(local.clone());

    // ---------- 0 s: arranque ----------
    tl.at(0, () => {
      audio.setIntensity(1);
      audio.roundStart();
      cue('caption', 'La máquina despierta…');
      show('LA MÁQUINA DESPIERTA', 'SORTEO EN DIRECTO', '#ff2d6f');
      this.lightning(1.2, true);
      this.blackout = true;
    });
    tl.at(0.45, () => (this.blackout = false));
    tl.at(0.6, () => (this.blackout = true));
    tl.at(0.75, () => {
      this.blackout = false;
      audio.clunk();
    });
    shot(0.2, 3.0, V(-1.0, 3.1, 5.4), V(-3.0, 2.6, 0.4));

    // ---------- 3 s: manivela ----------
    tl.at(3.0, () => {
      audio.crankTurn(1.9);
      cue('caption', 'Girando la manivela');
    });
    tl.tween(3.0, 1.9, (v) => (this.crank.rotation.z = -v * Math.PI * 4), { e: ease.inOut });
    tl.tween(3.0, 0.3, (v) => (this.agitate = v), { e: ease.linear });
    tl.tween(4.8, 8.5, (v) => (this.agitate = 1 - v * 0.75), { e: ease.linear });
    shot(4.6, 8.4, V(0.5, 3.2, 8.0), V(-0.5, 2.6, 0.6), ease.inOut);

    // ---------- 4.6–12.5 s: salen los chicles ----------
    const gums = shown.map((p, i) => {
      const g = this.makeGum(p);
      g.visible = false;
      // Fila de abajo: nombre debajo; fila de arriba: encima. Así no se pisan.
      const { label } = g.userData;
      label.scale.multiplyScalar(0.78);
      label.position.y = i % 2 ? 0.52 : -0.52;
      return g;
    });
    const exit = machineWorld(V(0, 1.52, 0.9));
    const trayP = machineWorld(V(0, 1.62, 1.12));
    const slots = shown.map((_, i) => {
      const x = k > 1 ? lerp(-1.6, 2.2, i / (k - 1)) : 0.3;
      return V(x, i % 2 ? 3.3 : 2.3, 1.9);
    });
    const spawnEvery = k > 1 ? Math.min(1.0, 7.0 / (k - 1)) : 1;
    gums.forEach((g, i) => {
      const t0 = 4.6 + i * spawnEvery;
      tl.at(t0, () => {
        g.visible = true;
        g.position.copy(exit);
        g.scale.setScalar(0.4);
        audio.clunk();
        audio.roll(0.05, 0.35);
      });
      // Cae a la bandeja
      tl.tween(t0, 0.35, (v) => {
        g.position.lerpVectors(exit, trayP, v);
        g.position.y += Math.sin(v * Math.PI) * 0.1;
        g.scale.setScalar(lerp(0.4, 1, v));
      }, { e: ease.out });
      // Salta y vuela a su sitio con un arco
      let from;
      tl.tween(
        t0 + 0.42,
        1.0,
        (v) => {
          const to = slots[i];
          g.position.lerpVectors(from, to, v);
          g.position.y += Math.sin(v * Math.PI) * 1.4;
          g.userData.mesh.rotation.y = v * Math.PI * 3;
          g.userData.label.material.opacity = clamp01((v - 0.6) / 0.4);
        },
        {
          e: ease.out,
          init: () => {
            from = g.position.clone();
            audio.pop(i, 0);
            audio.whoosh(0, 0.5, 0.2);
            this.burstSparks(g.position.clone(), 30, { speed: 2, up: 1.5, colors: [colorFor(shown[i].key), '#ffffff'], life: 1 });
          },
        },
      );
      // Flotando en su sitio hasta que vayan a la caja
      tl.tween(t0 + 1.42, 13.6 + i * 0.36 - (t0 + 1.42), (v, raw) => {
        const tt = this.elapsed;
        g.position.copy(slots[i]).add(V(0, Math.sin(tt * 2 + i) * 0.06, 0));
        g.userData.mesh.rotation.y += 0.01;
      }, { e: ease.linear });
    });
    tl.at(8.5, () => {
      const label = `${count.toLocaleString('es-ES')} ${count === 1 ? 'persona' : 'personas'} en el bombo`;
      cue('caption', label);
      show(label.toUpperCase(), 'REGISTRADOS EN PLAYCTP', '#3fd9ff');
    });

    // ---------- 12.6–17 s: a la caja ----------
    shot(12.4, 2.6, V(1.6, 3.8, 7.6), V(1.8, 1.6, 0.4));
    tl.at(12.6, () => {
      cue('caption', 'A la caja misteriosa');
      audio.creak(0, 0.8);
    });
    tl.tween(12.6, 0.9, (v) => (this.lid.rotation.x = -v * 1.25), { e: ease.out });
    tl.tween(12.6, 1.0, (v) => (this.beam.material.uniforms.uIntensity.value = lerp(0.3, 1.0, v)));
    tl.tween(12.6, 1.0, (v) => (this.boxLight.intensity = v * 25));
    const mouth = boxWorld(V(0, 0.95, 0.05));
    const inside = boxWorld(V(0, 0.4, 0.05));
    gums.forEach((g, i) => {
      const t0 = 13.6 + i * 0.36;
      let from;
      tl.tween(
        t0,
        0.85,
        (v) => {
          const ctrl = from.clone().lerp(mouth, 0.5).add(V(0, 2.2, 0.4));
          // Bezier cuadrática
          const a = from.clone().lerp(ctrl, v);
          const b = ctrl.clone().lerp(mouth, v);
          g.position.copy(a.lerp(b, v));
          g.userData.mesh.rotation.x += 0.2;
          g.userData.label.material.opacity = 1 - clamp01(v * 2);
          if (v > 0.8) g.position.lerp(inside, (v - 0.8) / 0.2);
          g.scale.setScalar(v > 0.75 ? lerp(1, 0.2, (v - 0.75) / 0.25) : 1);
        },
        { e: ease.in, init: () => ((from = g.position.clone()), audio.whoosh(0, 0.6, 0.3)) },
      );
      tl.at(t0 + 0.85, () => {
        g.visible = false;
        audio.boxSwallow();
        this.boxLight.intensity = 60;
        this.burstSparks(mouth.clone(), 40, { speed: 2.5, up: 2, colors: ['#9ff3ff', '#ffffff', colorFor(shown[i].key)], life: 1.2 });
      });
    });
    const lastIn = 13.6 + (k - 1) * 0.36 + 0.85;

    // ---------- el cierre y el temblor ----------
    const slamAt = Math.max(lastIn + 0.35, 16.4);
    tl.tween(slamAt - 0.25, 0.25, (v) => (this.lid.rotation.x = lerp(-1.25, 0, v)), { e: ease.in });
    tl.at(slamAt, () => {
      audio.slam();
      audio.setIntensity(2);
      this.shake = 1.5;
      this.boxLight.intensity = 0;
      this.beam.material.uniforms.uIntensity.value = 0.15;
      this.burstSparks(boxWorld(V(0, 0.1, 0.6)), 80, { speed: 3, up: 0.5, colors: ['#8a7a6a', '#5a4a3a', '#c0a080'], life: 1.4, gravity: 4 });
      cue('caption', '¿Quién será?');
      show('¿QUIÉN SERÁ?', 'LA CAJA ESTÁ DECIDIENDO', '#ff2d2d');
      this.world.setAlarm(true);
      gums.forEach((g) => this.disposeGum(g));
    });
    shot(slamAt - 0.4, 1.2, V(1.6, 1.9, 5.0), V(2.9, 1.2, 0.2), ease.out);
    tl.at(slamAt + 0.2, () => {
      audio.rumble(2.6);
      audio.riser(3.2);
    });
    tl.tween(slamAt + 0.2, 2.6, (v) => {
      this.shake = 0.4 + v * 2.2;
      const amp = 0.02 + v * 0.06;
      this.box.position.copy(this.boxBase).add(V((Math.random() - 0.5) * amp, Math.random() * amp * 0.6, (Math.random() - 0.5) * amp));
      this.box.rotation.z = (Math.random() - 0.5) * amp * 0.6;
      this.lid.rotation.x = -Math.random() * v * 0.12;
      this.qBoost = 1 + v * 2 + (Math.random() > 0.7 ? 1 : 0);
      this.beam.material.uniforms.uIntensity.value = 0.15 + v * 0.6 + Math.random() * 0.2;
    }, { e: ease.in });
    const burstAt = slamAt + 2.9;
    tl.at(burstAt - 0.35, () => this.lightning(1.6, false));

    // ---------- se abre de golpe ----------
    tl.at(burstAt, () => {
      audio.burstOpen();
      this.box.position.copy(this.boxBase);
      this.box.rotation.z = 0;
      this.shake = 1.2;
      this.qBoost = 2;
      this.finalPass.uniforms.uFlash.value = 0.55;
      this.finalPass.uniforms.uFlashColor.value.set(0.7, 0.95, 1);
      this.burstSparks(boxWorld(V(0, 1.0, 0)), 220, { speed: 6, up: 6, colors: ['#9ff3ff', '#ffffff', '#5fd0ff'], life: 2.2 });
      cue('caption', '');
    });
    tl.tween(burstAt, 0.5, (v) => (this.lid.rotation.x = -v * 1.95), { e: ease.outBack });
    tl.tween(burstAt, 0.8, (v) => (this.finalPass.uniforms.uFlash.value = 0.55 * (1 - v)), { e: ease.out });
    tl.tween(burstAt, 1.2, (v) => {
      this.beam.material.uniforms.uIntensity.value = lerp(1.6, 0.6, v);
      this.boxLight.intensity = lerp(80, 18, v);
      this.shake = 1.2 * (1 - v);
      this.qBoost = lerp(2, 1.2, v);
    }, { e: ease.out });

    // ---------- el ciclo de nombres ----------
    const display = this.makeGum(seq[0], 0.34);
    display.visible = false;
    const dispBottom = boxWorld(V(0, 0.5, 0));
    const dispTop = boxWorld(V(0, 2.35, 0));
    tl.at(CYCLE_START - 0.6, () => {
      display.visible = true;
      display.position.copy(dispBottom);
      display.userData.label.material.opacity = 1;
      this.setGumPerson(display, seq[0], 0.42);
      cue('cycle-start');
    });
    tl.tween(CYCLE_START - 0.6, 3.2, (v) => display.position.lerpVectors(dispBottom, dispTop, v), { e: ease.out });
    tl.tween(CYCLE_START + 2.6, LOCK - CYCLE_START - 2.6, () => {
      display.position.copy(dispTop).add(V(0, Math.sin(this.elapsed * 2.2) * 0.05, 0));
    }, { e: ease.linear });
    tl.tween(CYCLE_START - 0.6, LOCK - CYCLE_START + 0.6, (v) => {
      display.userData.mesh.rotation.y = this.elapsed * lerp(9, 0.6, v);
      display.userData.mesh.rotation.x = Math.sin(this.elapsed * 3) * 0.2;
    }, { e: ease.out });
    shot(CYCLE_START - 1.0, LOCK - CYCLE_START + 1.0, V(2.3, 2.7, 5.8), V(2.9, 2.0, 0.2), ease.inOut);

    seq.forEach((p, i) => {
      const t0 = tickTimes[i];
      const last = i === seq.length - 1;
      tl.at(t0, () => {
        this.setGumPerson(display, p, 0.42);
        if (!last) show(p.name.toUpperCase(), 'LA CAJA ESTÁ DECIDIENDO', '#3fd9ff');
        if (!last) {
          audio.tick(i, i > seq.length - 8 ? 1.4 : 1);
          cue('cycle', p.name);
          // Fogonazo en cada tic lento
          if (i > seq.length - 10) {
            display.userData.glow.scale.setScalar(1.9);
            this.burstSparks(display.position.clone(), 10, { speed: 1.2, up: 0.5, colors: [colorFor(p.key), '#ffffff'], life: 0.7, gravity: 1 });
          }
        }
      });
    });
    // Música en tensión y latidos al final
    tl.at(LOCK - 6, () => cue('caption', 'Se acaba…'));
    for (let hb = LOCK - 4.6; hb < LOCK - 0.2; hb += 0.95) tl.at(hb, () => audio.heartbeat());
    tl.tween(LOCK - 4.6, 4.6, (v) => (this.finalPass.uniforms.uAberration.value = 0.0015 + v * 0.006), { e: ease.in });
    tl.tween(CYCLE_START, LOCK - CYCLE_START, () => {
      const gs = display.userData.glow.scale.x;
      display.userData.glow.scale.setScalar(lerp(gs, 1.25, 0.08));
    }, { e: ease.linear });

    // ---------- revelación ----------
    tl.at(LOCK, () => {
      audio.duck(true, 0.15);
      cue('lock', winner.name);
      show('· · ·', 'LA CAJA HA DECIDIDO', '#ffffff');
      cue('caption', '');
      this.boxKeyBoost = -80;
    });
    tl.tween(LOCK, 0.55, (v) => {
      display.scale.setScalar(lerp(1, 0.85, v));
      this.beam.material.uniforms.uIntensity.value = lerp(0.6, 0.2, v);
    }, { e: ease.in });
    const REVEAL = LOCK + 0.6;
    tl.at(REVEAL, () => {
      audio.reveal();
      this.boxKeyBoost = 60;
      this.finalPass.uniforms.uFlash.value = 1;
      this.finalPass.uniforms.uFlashColor.value.set(1, 0.95, 0.8);
      this.shake = 2.4;
      this.beam.material.uniforms.uColor.value.set(1.0, 0.78, 0.35);
      this.boxLight.color.set(0xffd27a);
      this.boxInner.material.color.set(2.4, 1.8, 0.7);
      this.qMat.color.set(2.2, 1.8, 0.9);
      this.shock.material.opacity = 1;
      display.userData.label.visible = false;
      display.userData.glow.material.color.set(2, 1.6, 0.7);
      this.burstSparks(display.position.clone(), 500, { speed: 9, up: 4, life: 3 });
      this.launchConfetti(boxWorld(V(0, 1, 0)));
      this.lightning(1.0, false);
      cue('reveal', winner);
      show(winner.name.toUpperCase(), '¡GANADOR DEL SORTEO!', '#f2d88f');
      this.world.setAlarm(false);
    });
    tl.tween(REVEAL, 1.6, (v) => {
      this.finalPass.uniforms.uFlash.value = 1 - v;
      this.finalPass.uniforms.uAberration.value = lerp(0.012, 0.0015, v);
      this.shake = 2.4 * (1 - v);
    }, { e: ease.out });
    tl.tween(REVEAL, 1.4, (v) => display.scale.setScalar(lerp(0.85, 1.7, v)), { e: ease.outElastic });
    tl.tween(REVEAL, 1.2, (v) => {
      this.shock.scale.setScalar(lerp(0.5, 16, v));
      this.shock.material.opacity = 1 - v;
      this.beam.material.uniforms.uIntensity.value = lerp(2.0, 0.55, v);
    }, { e: ease.out });
    tl.at(REVEAL + 0.4, () => audio.duck(false, 1.5));
    tl.at(REVEAL + 0.4, () => audio.setIntensity(0));
    // Órbita alrededor del ganador
    const center = dispTop.clone();
    const toMachine = Math.atan2(GM_POS.x - center.x, GM_POS.z - center.z);
    let orbit0;
    // Sin final: sigue girando hasta que se pulse «Otra vez».
    const ORBIT_FOREVER = 1e7;
    tl.tween(REVEAL + 0.1, ORBIT_FOREVER, (v, raw) => {
      const s = raw * ORBIT_FOREVER;
      const a = orbit0 + s * 0.12;
      let r = lerp(5.4, 7.2, ease.out(clamp01(s / 5)));
      // Al dar la vuelta completa se acerca a la caja junto a la máquina y
      // ante la pared del fondo, para no atravesarlas.
      r -= 2.6 * Math.max(0, Math.cos(a - toMachine)) ** 4;
      if (Math.cos(a) < 0) r = Math.min(r, (center.z + 5.6) / -Math.cos(a));
      cam.pos.set(center.x + Math.sin(a) * r, center.y + 0.9, center.z + Math.cos(a) * r);
      cam.target.lerp(center.clone().add(V(0, 0.75, 0)), 0.1);
      display.position.copy(center).add(V(0, 0.25 + Math.sin(this.elapsed * 1.8) * 0.08, 0));
      display.userData.mesh.rotation.y += 0.01;
      if (Math.random() < 0.25) {
        this.burstSparks(display.position.clone(), 2, { speed: 1, up: 1, life: 1.5, gravity: -0.5 });
      }
    }, {
      e: ease.linear,
      init: () => {
        const rel = cam.pos.clone().sub(center);
        orbit0 = Math.atan2(rel.x, rel.z);
      },
    });

    return new Promise((resolve) => {
      tl.at(REVEAL + 4.4, () => {
        cue('done', winner);
        this.drawDone = true;
        this.nextZombie = this.elapsed + 4 + Math.random() * 4;
        resolve();
      });
      this.cleanupDraw = () => {
        this.disposeGum(display);
        gums.forEach((g) => g.parent && this.disposeGum(g));
      };
    });
  }

  /** Vuelve al estado de reposo para otro sorteo. */
  reset() {
    this.cleanupDraw?.();
    this.cleanupDraw = null;
    this.timeline = null;
    this.mode = 'idle';
    this.tourT = 0;
    this.drawDone = false;
    this.shake = 0;
    this.agitate = 0;
    this.qBoost = 1;
    this.boxKeyBoost = 0;
    this.lid.rotation.x = 0;
    this.crank.rotation.z = 0;
    this.box.position.copy(this.boxBase);
    this.box.rotation.z = 0;
    this.boxLight.intensity = 0;
    this.boxLight.color.set(0x7fe8ff);
    this.boxInner.material.color.setRGB(0.4, 1.4, 2.2);
    this.qMat.color.setRGB(1.2, 1.45, 1.55);
    this.beam.material.uniforms.uColor.value.setRGB(0.35, 0.9, 1.0);
    this.finalPass.uniforms.uFlash.value = 0;
    this.finalPass.uniforms.uAberration.value = 0.0015;
    this.shock.material.opacity = 0;
    for (const it of this.confetti.items) it.life = Math.min(it.life, 1.2);
    this.audio.setIntensity(0);
    this.audio.duck(false, 0.5);
    this.world.setAlarm(false);
    Object.assign(this.world.screen, { text: 'LA CAJA DEL DESTINO', sub: 'RULETA OFICIAL PLAYCTP', accent: '#3fd9ff' });
  }
}
