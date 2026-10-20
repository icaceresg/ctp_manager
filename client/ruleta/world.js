// El mapa: un búnker industrial cerrado, de noche, al estilo de los mapas de
// zombies. Paredes por los cuatro lados (nunca se ve "vacío"), techo de
// cerchas con un boquete por el que entra la luna, contenedores, bidones
// ardiendo, sacos terreros, alambradas, tuberías y la marca PlayCTP por todas
// partes: lona gigante, neones, carteles de las competiciones, pegatinas de
// las divisiones de Ranked, grafitis y una pantalla LED que sigue el sorteo.
import * as THREE from 'three';
import { woodTexture } from './textures.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const MEDIA = '/ruleta-media';
const DISPLAY = '"Saira Condensed", "Arial Narrow", sans-serif';

// Dimensiones del recinto
const BACK_Z = -7.2;
const FRONT_Z = 17;
const SIDE_X = 13;
const ROOF_Y = 9.6;

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function tex(c, { repeat, srgb = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// ---------------------------------------------------------------------------
// Texturas procedurales del mapa
// ---------------------------------------------------------------------------

function concreteWallTexture(seed = 3) {
  const [c, ctx] = canvas(1024, 1024);
  const r = rng(seed);
  ctx.fillStyle = '#3b3631';
  ctx.fillRect(0, 0, 1024, 1024);
  // Paneles de hormigón encofrado
  for (let y = 0; y < 1024; y += 256) {
    for (let x = 0; x < 1024; x += 512) {
      const l = 18 + r() * 8;
      ctx.fillStyle = `hsl(28, 7%, ${l}%)`;
      ctx.fillRect(x + 3, y + 3, 506, 250);
      for (const [hx, hy] of [[60, 60], [450, 60], [60, 196], [450, 196]]) {
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.beginPath();
        ctx.arc(x + hx, y + hy, 7, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = `hsla(30, 6%, ${8 + r() * 30}%, ${0.08 + r() * 0.2})`;
    const s = 1 + r() * 3;
    ctx.fillRect(r() * 1024, r() * 1024, s, s);
  }
  // Churretones de humedad
  for (let i = 0; i < 70; i++) {
    const x = r() * 1024;
    const y = r() * 600;
    const h = 120 + r() * 500;
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, 'rgba(12,8,4,0.55)');
    g.addColorStop(1, 'rgba(12,8,4,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, 3 + r() * 14, h);
  }
  // Salpicaduras oscuras de batallas pasadas
  for (let i = 0; i < 14; i++) {
    const x = r() * 1024;
    const y = 600 + r() * 400;
    const g = ctx.createRadialGradient(x, y, 2, x, y, 40 + r() * 90);
    g.addColorStop(0, 'rgba(40,6,6,0.55)');
    g.addColorStop(1, 'rgba(40,6,6,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 140, y - 140, 280, 280);
  }
  // Agujeros de bala
  for (let i = 0; i < 90; i++) {
    const x = r() * 1024;
    const y = 300 + r() * 600;
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.beginPath();
    ctx.arc(x, y, 2 + r() * 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(180,170,160,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, 5 + r() * 3, 0, Math.PI * 2);
    ctx.stroke();
  }
  return tex(c);
}

function corrugatedTexture(seed = 9, hue = 18) {
  const [c, ctx] = canvas(512, 512);
  const r = rng(seed);
  for (let x = 0; x < 512; x += 2) {
    const k = 0.5 + 0.5 * Math.sin((x / 512) * Math.PI * 24);
    ctx.fillStyle = `hsl(${hue}, 14%, ${12 + k * 16}%)`;
    ctx.fillRect(x, 0, 2, 512);
  }
  for (let i = 0; i < 60; i++) {
    const x = r() * 512;
    const y = r() * 512;
    const g = ctx.createRadialGradient(x, y, 2, x, y, 20 + r() * 70);
    g.addColorStop(0, `rgba(${110 + r() * 50},${40 + r() * 20},10,0.55)`);
    g.addColorStop(1, 'rgba(90,40,10,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 100, y - 100, 200, 200);
  }
  return tex(c, { repeat: [3, 1] });
}

function floorTexture() {
  const [c, ctx] = canvas(1024, 1024);
  const r = rng(77);
  ctx.fillStyle = '#2a2622';
  ctx.fillRect(0, 0, 1024, 1024);
  for (let y = 0; y < 1024; y += 256) {
    for (let x = 0; x < 1024; x += 256) {
      ctx.fillStyle = `hsl(30, 6%, ${13 + r() * 6}%)`;
      ctx.fillRect(x + 2, y + 2, 252, 252);
    }
  }
  for (let i = 0; i < 12000; i++) {
    ctx.fillStyle = `hsla(30, 8%, ${6 + r() * 26}%, ${0.1 + r() * 0.25})`;
    const s = 1 + r() * 3;
    ctx.fillRect(r() * 1024, r() * 1024, s, s);
  }
  for (let i = 0; i < 40; i++) {
    const x = r() * 1024;
    const y = r() * 1024;
    const g = ctx.createRadialGradient(x, y, 4, x, y, 50 + r() * 140);
    g.addColorStop(0, 'rgba(4,3,2,0.5)');
    g.addColorStop(1, 'rgba(4,3,2,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 200, y - 200, 400, 400);
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  for (let i = 0; i < 16; i++) {
    let x = r() * 1024;
    let y = r() * 1024;
    ctx.lineWidth = 0.6 + r() * 1.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k < 16; k++) {
      x += (r() - 0.5) * 60;
      y += (r() - 0.5) * 60;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  return tex(c, { repeat: [7, 6] });
}

function hazardTexture() {
  const [c, ctx] = canvas(256, 64);
  ctx.fillStyle = '#e0a72a';
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = '#141210';
  for (let x = -64; x < 300; x += 48) {
    ctx.beginPath();
    ctx.moveTo(x, 64);
    ctx.lineTo(x + 24, 64);
    ctx.lineTo(x + 88, 0);
    ctx.lineTo(x + 64, 0);
    ctx.fill();
  }
  const r = rng(4);
  for (let i = 0; i < 500; i++) {
    ctx.fillStyle = `rgba(0,0,0,${r() * 0.35})`;
    ctx.fillRect(r() * 256, r() * 64, 2 + r() * 6, 1 + r() * 3);
  }
  return tex(c, { repeat: [6, 1] });
}

function containerTexture(color, label, seed) {
  const [c, ctx] = canvas(1024, 512);
  const r = rng(seed);
  for (let x = 0; x < 1024; x += 4) {
    const k = Math.abs(Math.sin((x / 1024) * Math.PI * 30));
    ctx.fillStyle = color;
    ctx.globalAlpha = 1;
    ctx.fillRect(x, 0, 4, 512);
    ctx.fillStyle = `rgba(0,0,0,${0.15 + k * 0.3})`;
    ctx.fillRect(x, 0, 4, 512);
  }
  for (let i = 0; i < 80; i++) {
    const x = r() * 1024;
    const y = r() * 512;
    const g = ctx.createRadialGradient(x, y, 2, x, y, 20 + r() * 80);
    g.addColorStop(0, 'rgba(100,45,12,0.6)');
    g.addColorStop(1, 'rgba(100,45,12,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 100, y - 100, 200, 200);
  }
  ctx.font = `800 120px ${DISPLAY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(240,235,225,0.82)';
  ctx.fillText(label, 512, 230);
  ctx.font = `700 40px ${DISPLAY}`;
  ctx.fillText('CONNECT TO PLAY · LOGISTICS · CTPU 220771', 512, 330);
  return tex(c);
}

/** Lona con el logo de PlayCTP (se dibuja cuando carga la imagen). */
function bannerTexture(logo) {
  const [c, ctx] = canvas(1600, 800);
  const g = ctx.createLinearGradient(0, 0, 0, 800);
  g.addColorStop(0, '#15120e');
  g.addColorStop(1, '#0a0908');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1600, 800);
  // Franjas diagonales del brandbook
  ctx.fillStyle = 'rgba(212,160,48,0.12)';
  for (let x = -800; x < 1600; x += 220) {
    ctx.beginPath();
    ctx.moveTo(x, 800);
    ctx.lineTo(x + 70, 800);
    ctx.lineTo(x + 470, 0);
    ctx.lineTo(x + 400, 0);
    ctx.fill();
  }
  ctx.strokeStyle = '#d4a030';
  ctx.lineWidth = 14;
  ctx.strokeRect(24, 24, 1552, 752);
  if (logo) {
    const s = 1080;
    ctx.drawImage(logo, 0, 0, logo.width, logo.height, 800 - s / 2, 330 - s / 2, s, s);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 84px ${DISPLAY}`;
  ctx.fillStyle = '#ebebeb';
  ctx.fillText('LA CAJA DEL DESTINO', 800, 640);
  ctx.font = `700 40px ${DISPLAY}`;
  ctx.fillStyle = '#f2d88f';
  ctx.fillText('PLAYCTP.COM', 800, 712);
  // Desgaste
  const r = rng(12);
  for (let i = 0; i < 1800; i++) {
    ctx.fillStyle = `rgba(0,0,0,${r() * 0.35})`;
    ctx.fillRect(r() * 1600, r() * 800, 1 + r() * 4, 1 + r() * 4);
  }
  for (let i = 0; i < 25; i++) {
    const x = r() * 1600;
    const y = r() * 800;
    const gg = ctx.createRadialGradient(x, y, 4, x, y, 60 + r() * 120);
    gg.addColorStop(0, 'rgba(0,0,0,0.4)');
    gg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gg;
    ctx.fillRect(x - 200, y - 200, 400, 400);
  }
  return tex(c);
}

/** Cartel enmarcado con un emblema de competición. */
function posterTexture(img, title, accent) {
  const [c, ctx] = canvas(512, 720);
  ctx.fillStyle = '#100d0b';
  ctx.fillRect(0, 0, 512, 720);
  const g = ctx.createRadialGradient(256, 300, 20, 256, 300, 360);
  g.addColorStop(0, accent);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 720);
  ctx.globalAlpha = 1;
  if (img) {
    const h = 430;
    const w = (img.width / img.height) * h;
    ctx.drawImage(img, 256 - w / 2, 70, w, h);
  }
  ctx.textAlign = 'center';
  ctx.font = `800 74px ${DISPLAY}`;
  ctx.fillStyle = '#f2d88f';
  ctx.fillText(title, 256, 590);
  ctx.font = `700 30px ${DISPLAY}`;
  ctx.fillStyle = '#ebebeb';
  ctx.fillText('TEMPORADA 2026/27', 256, 640);
  ctx.strokeStyle = '#d4a030';
  ctx.lineWidth = 8;
  ctx.strokeRect(14, 14, 484, 692);
  const r = rng(title.length * 31);
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = `rgba(0,0,0,${r() * 0.4})`;
    ctx.fillRect(r() * 512, r() * 720, 1 + r() * 3, 1 + r() * 3);
  }
  // Esquina rasgada
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.moveTo(512, 0);
  ctx.lineTo(430, 0);
  ctx.lineTo(512, 70);
  ctx.fill();
  return tex(c);
}

function neonTexture(text, color, { w = 1024, h = 256, size = 150 } = {}) {
  const [c, ctx] = canvas(w, h);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 ${size}px ${DISPLAY}`;
  ctx.shadowColor = color;
  for (const blur of [40, 20, 8]) {
    ctx.shadowBlur = blur;
    ctx.fillStyle = color;
    ctx.fillText(text, w / 2, h / 2);
  }
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#fff6ea';
  ctx.globalAlpha = 0.85;
  ctx.fillText(text, w / 2, h / 2);
  return tex(c, { srgb: false });
}

function graffitiTexture() {
  const [c, ctx] = canvas(1024, 512);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const r = rng(21);
  // Plantilla "CTP" estilo spray
  ctx.font = `800 300px ${DISPLAY}`;
  ctx.fillStyle = 'rgba(212,160,48,0.9)';
  ctx.fillText('CTP', 430, 230);
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = `rgba(0,0,0,${r() * 0.7})`;
    ctx.fillRect(r() * 1024, r() * 512, 1 + r() * 4, 1 + r() * 4);
  }
  ctx.globalCompositeOperation = 'source-over';
  // Goteo
  ctx.fillStyle = 'rgba(212,160,48,0.75)';
  for (let i = 0; i < 18; i++) {
    const x = 220 + r() * 420;
    ctx.fillRect(x, 330, 3 + r() * 3, 30 + r() * 120);
  }
  ctx.font = `700 64px ${DISPLAY}`;
  ctx.fillStyle = 'rgba(235,235,235,0.75)';
  ctx.save();
  ctx.translate(800, 420);
  ctx.rotate(-0.12);
  ctx.fillText('CONNECT TO PLAY', 0, 0);
  ctx.restore();
  return tex(c);
}

/** Contorno de tiza de un arma en la pared, con su precio (genérico). */
function chalkTexture() {
  const [c, ctx] = canvas(1024, 400);
  ctx.strokeStyle = 'rgba(235,235,230,0.85)';
  ctx.lineWidth = 7;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const pts = [
    [90, 210], [210, 190], [230, 160], [520, 160], [540, 140], [620, 140], [640, 160], [880, 168], [900, 186], [880, 200],
    [700, 205], [690, 250], [660, 255], [645, 210], [560, 214], [520, 330], [470, 330], [480, 230], [300, 236], [260, 290], [130, 300], [90, 270],
  ];
  for (let pass = 0; pass < 3; pass++) {
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x + Math.random() * 4, y + Math.random() * 4) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.stroke();
  }
  ctx.globalAlpha = 0.85;
  ctx.font = `700 70px ${DISPLAY}`;
  ctx.fillStyle = 'rgba(235,235,230,0.9)';
  ctx.textAlign = 'center';
  ctx.fillText('1500', 500, 385);
  return tex(c);
}

function warningSignTexture(text, sub) {
  const [c, ctx] = canvas(512, 384);
  ctx.fillStyle = '#d9a422';
  ctx.fillRect(0, 0, 512, 384);
  ctx.fillStyle = '#121010';
  ctx.fillRect(14, 14, 484, 356);
  ctx.fillStyle = '#d9a422';
  ctx.beginPath();
  ctx.moveTo(256, 40);
  ctx.lineTo(346, 196);
  ctx.lineTo(166, 196);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#121010';
  ctx.font = `800 110px ${DISPLAY}`;
  ctx.textAlign = 'center';
  ctx.fillText('!', 256, 186);
  ctx.fillStyle = '#ebebeb';
  ctx.font = `800 64px ${DISPLAY}`;
  ctx.fillText(text, 256, 270);
  ctx.font = `600 32px ${DISPLAY}`;
  ctx.fillStyle = '#d9a422';
  ctx.fillText(sub, 256, 328);
  return tex(c);
}

// ---------------------------------------------------------------------------
// Construcción
// ---------------------------------------------------------------------------

export function buildWorld(stage) {
  const scene = stage.scene;
  const dot = stage.tex.dot;
  const smoke = stage.tex.smoke;
  const updaters = [];
  const flickerLights = [];

  const mesh = (geo, mat, x, y, z, { ry = 0, rx = 0, rz = 0, cast = true, receive = true, parent = scene } = {}) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = cast;
    m.receiveShadow = receive;
    parent.add(m);
    return m;
  };

  // --- Materiales comunes ---
  const wallTex = concreteWallTexture(3);
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.92, color: 0xb0a59a });
  const wallTexSide = concreteWallTexture(8);
  const sideMat = new THREE.MeshStandardMaterial({ map: wallTexSide, roughness: 0.92, color: 0xa69a8f });
  const metalMat = new THREE.MeshStandardMaterial({ map: corrugatedTexture(9), roughness: 0.7, metalness: 0.55, color: 0x9a8f88 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x2a2725, roughness: 0.55, metalness: 0.85 });
  const rust = new THREE.MeshStandardMaterial({ color: 0x4a2a18, roughness: 0.8, metalness: 0.5 });
  const wood = new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.88, color: 0xa0806a });
  const hazard = new THREE.MeshStandardMaterial({ map: hazardTexture(), roughness: 0.7 });
  const sackMat = new THREE.MeshStandardMaterial({ color: 0x5f563f, roughness: 1 });
  const rubble = new THREE.MeshStandardMaterial({ color: 0x3c3632, roughness: 0.95 });

  // --- Suelo ---
  const floor = mesh(new THREE.PlaneGeometry(SIDE_X * 2, FRONT_Z - BACK_Z), new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.82, metalness: 0.08, color: 0x9a9088 }), 0, 0, (FRONT_Z + BACK_Z) / 2, { rx: -Math.PI / 2, cast: false });
  floor.material.map.repeat.set(9, 8);
  // Charcos que reflejan neones y fuego
  const puddle = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.03, metalness: 0.7 });
  for (const [x, z, sx, sz] of [[0.6, 2.8, 2.0, 0.9], [-6.2, 3.4, 1.4, 0.7], [6.4, 2.6, 1.6, 0.8], [-1.6, -2.4, 1.2, 0.5], [8.5, -3.2, 1.8, 0.8], [-9.3, -1.2, 1.3, 0.6]]) {
    const p = mesh(new THREE.CircleGeometry(1, 40), puddle, x, 0.006, z, { rx: -Math.PI / 2, cast: false });
    p.scale.set(sx, sz, 1);
  }
  // Franja de peligro alrededor de la zona del sorteo
  for (const [x, z, w, ry] of [[0, 3.4, 11, 0], [0, -3.2, 11, 0], [-5.5, 0.1, 6.6, Math.PI / 2], [5.5, 0.1, 6.6, Math.PI / 2]]) {
    const s = mesh(new THREE.PlaneGeometry(w, 0.32), hazard, x, 0.008, z, { rx: -Math.PI / 2, rz: ry, cast: false });
    s.material.map.repeat.set(w / 1.6, 1);
  }

  // --- Paredes (cuatro lados) ---
  const H = ROOF_Y;
  const back = mesh(new THREE.BoxGeometry(SIDE_X * 2 + 1, H, 0.8), wallMat, 0, H / 2, BACK_Z - 0.4);
  back.material.map.repeat.set(3, 1.2);
  wallTex.wrapS = wallTex.wrapT = THREE.RepeatWrapping;
  wallTexSide.wrapS = wallTexSide.wrapT = THREE.RepeatWrapping;
  wallTexSide.repeat.set(3, 1.2);
  mesh(new THREE.BoxGeometry(0.8, H, FRONT_Z - BACK_Z), sideMat, -SIDE_X - 0.4, H / 2, (FRONT_Z + BACK_Z) / 2);
  mesh(new THREE.BoxGeometry(0.8, H, FRONT_Z - BACK_Z), sideMat, SIDE_X + 0.4, H / 2, (FRONT_Z + BACK_Z) / 2);
  mesh(new THREE.BoxGeometry(SIDE_X * 2 + 1, H, 0.8), sideMat, 0, H / 2, FRONT_Z + 0.4);
  // Zócalo metálico y pilares en las paredes
  for (const x of [-SIDE_X + 0.2, -6.5, 6.5, SIDE_X - 0.2]) {
    mesh(new THREE.BoxGeometry(0.7, H, 0.7), steel, x, H / 2, BACK_Z + 0.15);
  }
  for (const z of [-2, 4.5, 11]) {
    mesh(new THREE.BoxGeometry(0.7, H, 0.7), steel, -SIDE_X + 0.15, H / 2, z);
    mesh(new THREE.BoxGeometry(0.7, H, 0.7), steel, SIDE_X - 0.15, H / 2, z);
  }
  const skirting = mesh(new THREE.BoxGeometry(SIDE_X * 2, 0.9, 0.12), metalMat, 0, 0.45, BACK_Z + 0.06);
  skirting.material = metalMat.clone();
  skirting.material.map = metalMat.map.clone();
  skirting.material.map.repeat.set(12, 1);
  skirting.material.map.needsUpdate = true;

  // --- Techo: cerchas de acero y chapa con un boquete ---
  for (let z = BACK_Z + 1; z < FRONT_Z; z += 3.2) {
    mesh(new THREE.BoxGeometry(SIDE_X * 2, 0.35, 0.3), steel, 0, ROOF_Y - 0.4, z, { cast: false });
    for (let x = -SIDE_X + 1; x < SIDE_X; x += 2.2) {
      mesh(new THREE.BoxGeometry(0.08, 0.9, 0.08), steel, x, ROOF_Y - 0.9, z, { rz: (x % 4.4 > 0 ? 1 : -1) * 0.7, cast: false });
    }
    mesh(new THREE.BoxGeometry(SIDE_X * 2, 0.12, 0.2), steel, 0, ROOF_Y - 1.35, z, { cast: false });
  }
  const roofMat = new THREE.MeshStandardMaterial({ map: corrugatedTexture(31, 10), roughness: 0.8, metalness: 0.5, color: 0x5a524c, side: THREE.DoubleSide });
  roofMat.map.repeat.set(8, 1);
  // Paneles del techo (dejando un boquete encima de la caja)
  for (let z = BACK_Z; z < FRONT_Z; z += 3) {
    for (let x = -SIDE_X; x < SIDE_X; x += 4) {
      const hole = x >= -2 && x <= 4 && z >= -5 && z <= 1;
      if (hole) continue;
      mesh(new THREE.PlaneGeometry(4.02, 3.02), roofMat, x + 2, ROOF_Y, z + 1.5, { rx: Math.PI / 2, cast: false });
    }
  }
  // Chapa colgando del boquete
  mesh(new THREE.PlaneGeometry(3.2, 2.2), roofMat, 0.4, ROOF_Y - 1.1, -5.2, { rx: 1.0, rz: 0.2, cast: true });
  mesh(new THREE.PlaneGeometry(2.4, 1.6), roofMat, 4.6, ROOF_Y - 0.8, -1.2, { rx: 1.2, rz: -0.4, cast: true });
  // Rayos de luna entrando por el boquete
  const godMat = new THREE.MeshBasicMaterial({ map: smoke, color: new THREE.Color(0.35, 0.42, 0.75), transparent: true, opacity: 0.07, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
  for (let i = 0; i < 3; i++) {
    const shaft = mesh(new THREE.CylinderGeometry(1.2 + i * 0.4, 2.6 + i * 0.6, ROOF_Y, 24, 1, true), godMat, 1.4 + i * 0.3, ROOF_Y / 2, -2.2 - i * 0.3, { rz: 0.18, rx: 0.12, cast: false, receive: false });
    shaft.renderOrder = 2;
  }

  // --- Tuberías y cables ---
  for (const [y, r, color] of [[7.4, 0.22, 0x3a2a1e], [6.9, 0.14, 0x26322c], [6.55, 0.1, 0x553322]]) {
    const pipe = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.7 });
    mesh(new THREE.CylinderGeometry(r, r, SIDE_X * 2, 16), pipe, 0, y, BACK_Z + 0.45, { rz: Math.PI / 2 });
    for (let x = -SIDE_X + 1.5; x < SIDE_X; x += 3.3) mesh(new THREE.BoxGeometry(0.12, 0.5, 0.35), steel, x, y, BACK_Z + 0.3);
  }
  for (const side of [-1, 1]) {
    mesh(new THREE.CylinderGeometry(0.18, 0.18, FRONT_Z - BACK_Z, 14), rust, side * (SIDE_X - 0.5), 7.8, (FRONT_Z + BACK_Z) / 2, { rx: Math.PI / 2 });
  }
  // Cables colgantes
  const cableMat = new THREE.MeshStandardMaterial({ color: 0x0d0d0d, roughness: 0.7 });
  for (const [x0, x1, z, sag] of [[-8, -2, -3.6, 1.1], [2, 9, -4.4, 1.4], [-4, 5, 6, 1.2]]) {
    const curve = new THREE.QuadraticBezierCurve3(V(x0, ROOF_Y - 1.4, z), V((x0 + x1) / 2, ROOF_Y - 1.4 - sag, z), V(x1, ROOF_Y - 1.4, z));
    mesh(new THREE.TubeGeometry(curve, 24, 0.025, 6), cableMat, 0, 0, 0, { cast: false });
  }

  // --- Lona gigante de PlayCTP en la pared del fondo ---
  const bannerT = bannerTexture(null);
  const bannerMat = new THREE.MeshStandardMaterial({ map: bannerT, roughness: 0.9, side: THREE.DoubleSide, emissive: 0xffffff, emissiveMap: bannerT, emissiveIntensity: 0.14 });
  const bannerGeo = new THREE.PlaneGeometry(8.4, 4.2, 40, 20);
  const banner = mesh(bannerGeo, bannerMat, 0, 5.55, BACK_Z + 0.75, { cast: false });
  const bannerBase = bannerGeo.attributes.position.array.slice();
  updaters.push((t) => {
    const p = bannerGeo.attributes.position.array;
    for (let i = 0; i < p.length; i += 3) {
      const x = bannerBase[i];
      const y = bannerBase[i + 1];
      const hang = (2.1 - y) / 4.2; // 0 arriba, 1 abajo
      p[i + 2] = Math.sin(x * 0.9 + t * 1.3) * 0.08 * hang + Math.sin(x * 2.3 - t * 0.7) * 0.03 * hang;
    }
    bannerGeo.attributes.position.needsUpdate = true;
    bannerGeo.computeVertexNormals();
  });
  mesh(new THREE.CylinderGeometry(0.06, 0.06, 9, 10), steel, 0, 7.7, BACK_Z + 0.75, { rz: Math.PI / 2 });
  for (const x of [-4.1, 4.1]) mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.9, 6), cableMat, x, 8.65, BACK_Z + 0.75, { cast: false });
  const bannerSpot = new THREE.SpotLight(0xffd59a, 60, 14, 0.55, 0.6, 1.6);
  bannerSpot.position.set(0, 1.2, 1.8);
  bannerSpot.target = banner;
  scene.add(bannerSpot);

  // --- Neones ---
  const neons = [];
  const neon = (text, color, x, y, z, w, h, ry = 0, opts) => {
    const t = neonTexture(text, color, opts);
    const m = mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: new THREE.Color(1.6, 1.6, 1.6) }), x, y, z, { ry, cast: false, receive: false });
    const light = new THREE.PointLight(new THREE.Color(color), 9, 7, 1.6);
    light.position.set(x + Math.sin(ry) * 0.6, y, z + Math.cos(ry) * 0.6);
    scene.add(light);
    neons.push({ m, light, base: 9, phase: Math.random() * 20, flicky: neons.length === 1 });
    return m;
  };
  neon('CONNECT TO PLAY', '#ff2d6f', -8.6, 6.6, BACK_Z + 0.42, 5.2, 1.3);
  neon('PLAYCTP.COM', '#3fd9ff', 8.7, 6.7, BACK_Z + 0.42, 4.8, 1.2);
  neon('RANKED', '#b06cff', SIDE_X - 0.42, 6.4, 1.4, 4.2, 1.05, -Math.PI / 2);
  neon('ZONA DE SORTEO', '#ffb340', -SIDE_X + 0.42, 6.4, 3.2, 5.2, 1.1, Math.PI / 2);
  neon('CTP', '#d4a030', 0, 7.6, FRONT_Z - 0.42, 3, 1.4, Math.PI);

  // --- Pantalla LED que acompaña el sorteo ---
  const [sc, sctx] = canvas(1024, 512);
  const screenTex = tex(sc);
  const screen = { text: 'LA CAJA DEL DESTINO', sub: 'RULETA OFICIAL PLAYCTP', accent: '#3fd9ff', dirty: true };
  const drawScreen = (t) => {
    sctx.fillStyle = '#04060a';
    sctx.fillRect(0, 0, 1024, 512);
    sctx.textAlign = 'center';
    sctx.textBaseline = 'middle';
    sctx.font = `700 46px ${DISPLAY}`;
    sctx.fillStyle = screen.accent;
    sctx.fillText(screen.sub, 512, 120);
    let size = 150;
    do {
      sctx.font = `800 ${size}px ${DISPLAY}`;
      size -= 6;
    } while (sctx.measureText(screen.text).width > 940 && size > 40);
    sctx.shadowColor = screen.accent;
    sctx.shadowBlur = 24;
    sctx.fillStyle = '#ffffff';
    sctx.fillText(screen.text, 512, 280);
    sctx.shadowBlur = 0;
    // Teletipo inferior
    sctx.fillStyle = '#d4a030';
    sctx.fillRect(0, 420, 1024, 92);
    sctx.font = `800 48px ${DISPLAY}`;
    sctx.fillStyle = '#120c02';
    const ticker = '  EN DIRECTO  ·  PLAYCTP.COM  ·  CTP CUP  ·  CTP MAJOR  ·  CTP CHAMP  ·  RANKED  ·  ';
    const tw = sctx.measureText(ticker).width;
    const off = (t * 120) % tw;
    sctx.textAlign = 'left';
    for (let x = -off; x < 1024; x += tw) sctx.fillText(ticker, x, 468);
    // Líneas de escaneo
    sctx.fillStyle = 'rgba(0,0,0,0.25)';
    for (let y = 0; y < 512; y += 4) sctx.fillRect(0, y, 1024, 2);
    screenTex.needsUpdate = true;
  };
  drawScreen(0);
  const screenMesh = mesh(new THREE.PlaneGeometry(4.4, 2.2), new THREE.MeshBasicMaterial({ map: screenTex, color: new THREE.Color(1.3, 1.3, 1.3) }), -SIDE_X + 0.48, 3.7, -2.6, { ry: Math.PI / 2, cast: false });
  mesh(new THREE.BoxGeometry(0.25, 2.5, 4.7), steel, -SIDE_X + 0.3, 3.7, -2.6);
  const screenLight = new THREE.PointLight(0x3fd9ff, 6, 8, 1.6);
  screenLight.position.set(-SIDE_X + 1.6, 3.7, -2.6);
  scene.add(screenLight);
  let screenAccum = 0;
  updaters.push((t, dt) => {
    screenAccum += dt;
    if (screenAccum > 1 / 30) {
      screenAccum = 0;
      drawScreen(t);
    }
    screenLight.color.set(screen.accent);
  });

  // --- Carteles de las competiciones CTP y Ranked ---
  const posters = [];
  const posterFrame = new THREE.MeshStandardMaterial({ color: 0x1b1714, roughness: 0.6, metalness: 0.6 });
  const addPoster = (title, file, accent, x, y, z, ry) => {
    const t = posterTexture(null, title, accent);
    const mat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.8, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.2 });
    const p = mesh(new THREE.PlaneGeometry(1.6, 2.25), mat, x, y, z, { ry, cast: false });
    mesh(new THREE.BoxGeometry(1.75, 2.4, 0.06), posterFrame, x - Math.sin(ry) * 0.04, y, z - Math.cos(ry) * 0.04, { ry });
    posters.push({ title, file, accent, mat });
    const lamp = new THREE.SpotLight(0xffe2b0, 18, 5, 0.6, 0.7, 1.5);
    lamp.position.set(x + Math.sin(ry) * 1.2, y + 1.9, z + Math.cos(ry) * 1.2);
    lamp.target = p;
    scene.add(lamp);
  };
  addPoster('CTP CUP', 'ctp-cup.png', '#3fd9ff', -10.6, 3.0, BACK_Z + 0.42, 0);
  addPoster('CTP MAJOR', 'ctp-major.png', '#ff2d6f', -6.9, 2.9, BACK_Z + 0.42, 0);
  addPoster('CTP CHAMP', 'ctp-champ.png', '#d4a030', 10.6, 3.0, BACK_Z + 0.42, 0);

  // Pegatinas de las divisiones de Ranked en la pared derecha
  const ranks = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'crimson', 'iridescent', 'top50'];
  const loader = new THREE.TextureLoader();
  ranks.forEach((r, i) => {
    const t = loader.load(`${MEDIA}/rank-${r}.webp`);
    t.colorSpace = THREE.SRGBColorSpace;
    const col = i % 4;
    const row = Math.floor(i / 4);
    const m = new THREE.MeshBasicMaterial({ map: t, transparent: true, color: new THREE.Color(1.15, 1.15, 1.15), depthWrite: false });
    mesh(new THREE.PlaneGeometry(1.25, 1.25), m, SIDE_X - 0.42, 4.6 - row * 1.5, -0.6 + col * 1.5, { ry: -Math.PI / 2, cast: false });
  });

  // Grafiti CTP y tiza del arma
  mesh(new THREE.PlaneGeometry(4.6, 2.3), new THREE.MeshStandardMaterial({ map: graffitiTexture(), transparent: true, roughness: 0.9, depthWrite: false }), 7.3, 2.8, BACK_Z + 0.42, { cast: false });
  mesh(new THREE.PlaneGeometry(2.8, 1.1), new THREE.MeshBasicMaterial({ map: chalkTexture(), transparent: true, color: new THREE.Color(0.8, 0.8, 0.8), depthWrite: false }), -SIDE_X + 0.42, 2.4, 8.4, { ry: Math.PI / 2, cast: false });
  mesh(new THREE.PlaneGeometry(1.1, 0.82), new THREE.MeshStandardMaterial({ map: warningSignTexture('PELIGRO', 'ALTA TENSIÓN'), roughness: 0.6 }), -3.0, 2.4, BACK_Z + 0.42, { cast: false });

  // --- Ventanas tapiadas con fuego detrás ---
  const fireLights = [];
  for (const wx of [-3.4, 3.6]) {
    const glow = mesh(new THREE.PlaneGeometry(2.4, 1.8), new THREE.MeshBasicMaterial({ map: dot, color: new THREE.Color(1.3, 0.4, 0.08), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), wx, 3.6, BACK_Z + 0.02, { cast: false, receive: false });
    glow.renderOrder = 1;
    mesh(new THREE.BoxGeometry(2.2, 0.12, 0.5), steel, wx, 2.62, BACK_Z + 0.3);
    for (let i = 0; i < 4; i++) {
      mesh(new THREE.BoxGeometry(2.4, 0.24, 0.07), wood, wx + (i % 2 ? 0.08 : -0.08), 2.95 + i * 0.4, BACK_Z + 0.5, { rz: (i % 2 ? 1 : -1) * (0.1 + i * 0.03) });
    }
    const l = new THREE.PointLight(0xff5a1a, 6, 7, 1.6);
    l.position.set(wx, 3.6, BACK_Z + 1.1);
    scene.add(l);
    fireLights.push(l);
  }

  // --- Interruptor de corriente (power switch) ---
  const panel = new THREE.Group();
  panel.position.set(-1.6, 2.2, BACK_Z + 0.5);
  scene.add(panel);
  mesh(new THREE.BoxGeometry(1.1, 1.4, 0.35), new THREE.MeshStandardMaterial({ color: 0x31392f, roughness: 0.6, metalness: 0.6 }), 0, 0, 0, { parent: panel });
  mesh(new THREE.BoxGeometry(0.16, 0.6, 0.12), steel, 0.25, 0.1, 0.24, { parent: panel, rz: 0.5 });
  const powerLed = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 3, 0.4) }));
  powerLed.position.set(-0.3, 0.5, 0.2);
  panel.add(powerLed);
  mesh(new THREE.BoxGeometry(0.06, 2.6, 0.06), steel, -0.25, 1.95, 0.05, { parent: panel });

  // --- Contenedores marítimos CTP ---
  const cont = (color, label, seed, x, y, z, ry) => {
    const t = containerTexture(color, label, seed);
    const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.75, metalness: 0.45 });
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = ry;
    scene.add(g);
    mesh(new THREE.BoxGeometry(6, 2.6, 2.45), m, 0, 1.3, 0, { parent: g });
    for (const sx of [-1, 1]) for (const sy of [0, 1]) mesh(new THREE.BoxGeometry(0.16, 0.16, 2.5), steel, sx * 2.95, sy * 2.6 + (sy ? -0.08 : 0.08), 0, { parent: g });
  };
  cont('#7a1d1d', 'CTP', 101, -10.0, 0, -4.4, 0.05);
  cont('#1c3e5c', 'PLAYCTP', 102, -10.3, 2.6, -4.6, -0.04);
  cont('#2f4a2a', 'CTP RANKED', 103, 10.4, 0, 6.8, Math.PI / 2 + 0.06);
  cont('#5c4a1c', 'CTP CUP', 104, -10.6, 0, 9.5, Math.PI / 2 - 0.08);

  // --- Bidones (algunos ardiendo) ---
  const drumMat = new THREE.MeshStandardMaterial({ color: 0x3d1d12, roughness: 0.6, metalness: 0.6 });
  const drumBand = new THREE.MeshStandardMaterial({ color: 0x1f1a17, roughness: 0.5, metalness: 0.8 });
  const fires = [];
  const drum = (x, z, burning, tilt = 0) => {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.z = tilt;
    scene.add(g);
    mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.25, 24), drumMat, 0, 0.625, 0, { parent: g });
    for (const y of [0.3, 0.95]) mesh(new THREE.TorusGeometry(0.43, 0.025, 8, 28), drumBand, 0, y, 0, { parent: g, rx: Math.PI / 2 });
    if (burning) {
      const light = new THREE.PointLight(0xff6a22, 12, 8, 1.6);
      light.position.set(x, 1.8, z);
      scene.add(light);
      const flames = [];
      for (let i = 0; i < 9; i++) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, color: new THREE.Color(2.4, 0.9, 0.2), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
        s.position.set(x, 1.3, z);
        scene.add(s);
        flames.push({ s, p: Math.random(), speed: 0.8 + Math.random() * 0.8 });
      }
      fires.push({ light, flames, x, z });
    }
  };
  drum(-7.6, 1.4, true);
  drum(-8.4, 2.1, false);
  drum(7.9, -1.6, true);
  drum(8.7, -0.9, false, 0.08);
  drum(5.9, 9.2, true);
  drum(-5.4, 10.5, true);
  drum(9.6, 3.9, false);

  // --- Sacos terreros y barricadas ---
  const sandbags = (x, z, n, ry) => {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    scene.add(g);
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < n - row; i++) {
        const s = mesh(new THREE.SphereGeometry(0.42, 14, 10), sackMat, (i - (n - row - 1) / 2) * 0.78, 0.22 + row * 0.36, 0, { parent: g, ry: Math.random() * 0.3 });
        s.scale.set(1, 0.46, 0.6);
      }
    }
  };
  sandbags(-7.2, 3.2, 5, 0.2);
  sandbags(7.4, 2.8, 5, -0.25);
  sandbags(0.2, 9.4, 6, 0);
  sandbags(-2.8, -5.6, 4, 0);

  // Alambradas de espino
  const wireMat = new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 0.4, metalness: 0.9 });
  const barbed = (x, z, len, ry) => {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    scene.add(g);
    for (let i = 0; i <= len; i += 2) mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.3, 6), rust, i - len / 2, 0.65, 0, { parent: g });
    const pts = [];
    for (let a = 0; a < len * 3.2; a += 0.12) pts.push(V(a / 3.2 - len / 2, 0.75 + Math.sin(a) * 0.32, Math.cos(a) * 0.32));
    mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 400, 0.012, 4), wireMat, 0, 0, 0, { parent: g, cast: false });
  };
  barbed(-9.4, 6.4, 6, 0.4);
  barbed(9.6, 1.2, 4, -1.3);
  barbed(3.4, -5.9, 6, 0);

  // Cajas de madera apiladas
  for (const [x, y, z, s, ry] of [[9.2, 0, -4.8, 1.1, 0.2], [10.2, 0, -4.4, 0.9, -0.3], [9.6, 1.1, -4.7, 0.9, 0.5], [-5.6, 0, -5.8, 1.0, 0.1], [4.8, 0, 11.6, 1.2, 0.4], [-11.2, 0, 2.8, 1.0, 0.7]]) {
    mesh(new THREE.BoxGeometry(s, s, s), wood, x, y + s / 2, z, { ry });
  }

  // Valla metálica (malla)
  const [mc, mctx] = canvas(256, 256);
  mctx.strokeStyle = 'rgba(180,180,180,0.9)';
  mctx.lineWidth = 3;
  for (let i = -256; i < 512; i += 32) {
    mctx.beginPath();
    mctx.moveTo(i, 0);
    mctx.lineTo(i + 256, 256);
    mctx.moveTo(i + 256, 0);
    mctx.lineTo(i, 256);
    mctx.stroke();
  }
  const meshTex = tex(mc, { repeat: [6, 3] });
  const fenceMat = new THREE.MeshStandardMaterial({ map: meshTex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, metalness: 0.8, roughness: 0.4, color: 0x9a9a9a });
  for (const [x, z, ry] of [[11.2, -1.0, Math.PI / 2], [-11.4, 6.8, Math.PI / 2]]) {
    mesh(new THREE.PlaneGeometry(5.6, 3), fenceMat, x, 1.5, z, { ry, cast: false });
    for (const o of [-2.8, 0, 2.8]) mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.1, 8), steel, x, 1.55, z + o);
  }

  // Escombros y casquillos
  for (let i = 0; i < 60; i++) {
    const a = Math.random() * Math.PI * 2;
    const rad = 4.5 + Math.random() * 7.5;
    const x = Math.cos(a) * rad * 1.1;
    const z = Math.sin(a) * rad * 0.8 + 1.5;
    if (Math.abs(x) > SIDE_X - 0.6 || z < BACK_Z + 0.6 || z > FRONT_Z - 0.6) continue;
    const s = 0.08 + Math.random() * 0.3;
    mesh(new THREE.DodecahedronGeometry(s, 0), rubble, x, s * 0.5, z, { ry: Math.random() * 3, rx: Math.random() });
  }
  const brass = new THREE.MeshStandardMaterial({ color: 0xc8a050, roughness: 0.3, metalness: 1 });
  const shells = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.012, 0.012, 0.06, 6), brass, 120);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  for (let i = 0; i < 120; i++) {
    q.setFromEuler(new THREE.Euler(Math.PI / 2, Math.random() * 6, 0));
    m4.compose(V((Math.random() - 0.5) * 16, 0.012, Math.random() * 9 - 2), q, V(1, 1, 1));
    shells.setMatrixAt(i, m4);
  }
  scene.add(shells);

  // --- Lámparas industriales colgantes que se balancean ---
  const lamps = [];
  const shadeMat = new THREE.MeshStandardMaterial({ color: 0x2a3a2a, roughness: 0.5, metalness: 0.7, side: THREE.DoubleSide });
  for (const [x, z, len] of [[-3.3, 1.6, 2.6], [3.1, 1.8, 2.8], [-8.2, 6.2, 2.4], [8.4, 6.6, 2.2], [0.2, 11.5, 2.4]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, ROOF_Y - 1.35, z);
    scene.add(pivot);
    mesh(new THREE.CylinderGeometry(0.012, 0.012, len, 6), cableMat, 0, -len / 2, 0, { parent: pivot, cast: false });
    mesh(new THREE.ConeGeometry(0.42, 0.32, 24, 1, true), shadeMat, 0, -len - 0.1, 0, { parent: pivot, cast: false });
    const bulbMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.4, 1.6) });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), bulbMat);
    bulb.position.y = -len - 0.2;
    pivot.add(bulb);
    const l = new THREE.PointLight(0xffc888, 16, 11, 1.5);
    l.position.y = -len - 0.3;
    pivot.add(l);
    lamps.push({ pivot, l, bulbMat, phase: Math.random() * 10, base: 16, len });
  }

  // Tubos fluorescentes rotos en la pared del fondo (parpadeo)
  const tubes = [];
  for (const x of [-5.2, 5.4]) {
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.6, 2.8) });
    mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 10), mat, x, 5.1, BACK_Z + 0.5, { rz: Math.PI / 2, cast: false });
    const l = new THREE.PointLight(0xcfe8ff, 5, 6, 1.6);
    l.position.set(x, 4.9, BACK_Z + 1.1);
    scene.add(l);
    tubes.push({ mat, l, phase: Math.random() * 10 });
  }

  // Baliza de alarma roja giratoria junto a la caja
  const beacon = new THREE.Group();
  beacon.position.set(5.4, 4.2, BACK_Z + 0.9);
  scene.add(beacon);
  mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.3, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.2, 0.15) }), 0, 0, 0, { parent: beacon, cast: false });
  const alarm = new THREE.SpotLight(0xff2a1a, 0, 18, 0.35, 0.5, 1.3);
  alarm.position.set(0, 0, 0);
  beacon.add(alarm);
  const alarmTarget = new THREE.Object3D();
  alarmTarget.position.set(4, -2, 0);
  beacon.add(alarmTarget);
  alarm.target = alarmTarget;

  // Chispas de un cable roto
  let nextSpark = 3;

  // Carga de imágenes de marca (cuando llegan, se repintan las texturas)
  Promise.all([loadImage(`${MEDIA}/logo.png`), ...posters.map((p) => loadImage(`${MEDIA}/${p.file}`))]).then(([logo, ...imgs]) => {
    const bt = bannerTexture(logo);
    bannerMat.map = bt;
    bannerMat.emissiveMap = bt;
    bannerMat.needsUpdate = true;
    posters.forEach((p, i) => {
      const t = posterTexture(imgs[i], p.title, p.accent);
      p.mat.map = t;
      p.mat.emissiveMap = t;
      p.mat.needsUpdate = true;
    });
  });

  return {
    screen,
    setAlarm(on) {
      this.alarmOn = on;
    },
    alarmOn: false,
    update(t, dt, { blackout = false, agitate = 0 } = {}) {
      const dim = blackout ? 0.06 : 1;
      for (const fn of updaters) fn(t, dt);
      for (const n of neons) {
        const flick = n.flicky && Math.sin(t * 17 + n.phase) * Math.sin(t * 5.3) > 0.85 ? 0.15 : 1;
        n.m.material.opacity = flick * (blackout ? 0.05 : 1);
        n.light.intensity = n.base * flick * dim;
      }
      for (const l of lamps) {
        const sway = Math.sin(t * 0.9 + l.phase) * (0.05 + agitate * 0.12);
        l.pivot.rotation.z = sway;
        l.pivot.rotation.x = Math.cos(t * 0.7 + l.phase) * 0.03;
        const off = Math.sin(t * 11 + l.phase) * Math.sin(t * 6.7 + l.phase * 2) > 0.95 ? 0.15 : 1;
        l.l.intensity = l.base * off * dim;
        l.bulbMat.color.setRGB(3, 2.4, 1.6).multiplyScalar(off * dim);
      }
      for (const tb of tubes) {
        const on = Math.sin(t * 23 + tb.phase) > -0.6 || Math.sin(t * 3 + tb.phase) > 0.7 ? 1 : 0.05;
        tb.l.intensity = 5 * on * dim;
        tb.mat.color.setRGB(2.2, 2.6, 2.8).multiplyScalar(on * dim);
      }
      for (const [i, f] of fireLights.entries()) f.intensity = (5 + Math.sin(t * 9 + i) * 1.3 + Math.sin(t * 23 + i * 3) * 1.1) * (blackout ? 0.3 : 1);
      for (const f of fires) {
        f.light.intensity = (10 + Math.sin(t * 13 + f.x) * 3 + Math.sin(t * 29 + f.z) * 2) * (blackout ? 0.5 : 1);
        for (const fl of f.flames) {
          fl.p += dt * fl.speed;
          if (fl.p > 1) fl.p -= 1;
          const k = fl.p;
          fl.s.position.set(f.x + Math.sin(t * 4 + fl.speed * 9) * 0.12 * (1 - k), 1.25 + k * 1.1, f.z + Math.cos(t * 3 + fl.speed * 7) * 0.12 * (1 - k));
          const sz = (0.75 - k * 0.5) * (1 + agitate * 0.4);
          fl.s.scale.set(sz, sz * 1.4, 1);
          fl.s.material.color.setRGB(2.6, 0.9 + (1 - k) * 0.8, 0.2).multiplyScalar(1 - k * 0.85);
        }
      }
      powerLed.material.color.setRGB(0.2, 3, 0.4).multiplyScalar(Math.sin(t * 4) > 0 ? 1 : 0.2);
      beacon.rotation.y += dt * 5;
      alarm.intensity = this.alarmOn ? 160 : 0;
      beacon.children[0].material.color.setRGB(2.4, 0.2, 0.15).multiplyScalar(this.alarmOn ? 1.6 : 0.25);
      if (t > nextSpark) {
        stage.burstSparks(V(-2.2, ROOF_Y - 2.3, -3.6), 18, { speed: 2, up: 0.3, colors: ['#fff3c0', '#ffd27a', '#ffffff'], life: 0.9, gravity: 9 });
        nextSpark = t + 2 + Math.random() * 6;
      }
    },
    bounds: { BACK_Z, FRONT_Z, SIDE_X, ROOF_Y },
    screenMesh,
  };
}
