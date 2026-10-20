// Texturas generadas en un <canvas>: nada se descarga de fuera.
import * as THREE from 'three';

export const GUM_COLORS = [
  '#ff2d55', '#ffb000', '#22d3ff', '#7cff4f', '#b14dff',
  '#ff6a1a', '#ff4fd8', '#3d7bff', '#00f0b5', '#ffe14d',
];

const DISPLAY_FONT = '"Saira Condensed", "Arial Narrow", sans-serif';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function toTexture(c, { srgb = true, repeat } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

// Ruido de valores barato y determinista para las texturas procedurales.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function shade(hex, amount) {
  const c = new THREE.Color(hex);
  const hsl = {};
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + amount)));
  return `#${c.getHexString()}`;
}

function fitFont(ctx, text, maxWidth, size, weight = 800) {
  let s = size;
  do {
    ctx.font = `${weight} ${s}px ${DISPLAY_FONT}`;
    if (ctx.measureText(text).width <= maxWidth) break;
    s -= 4;
  } while (s > 20);
  return s;
}

/** Textura de un chicle con el nombre impreso alrededor del ecuador. */
export function gumTexture(name, color) {
  const [c, ctx] = canvas(1024, 512);
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, shade(color, 0.12));
  g.addColorStop(0.5, color);
  g.addColorStop(1, shade(color, -0.18));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1024, 512);
  // Motitas de azúcar.
  const r = rng(name.length * 977 + color.charCodeAt(2));
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.04 + r() * 0.1})`;
    ctx.beginPath();
    ctx.arc(r() * 1024, r() * 512, 1 + r() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  // Banda oscura para el nombre: una banda blanca se quemaba con las luces
  // y el bloom, y el texto desaparecía.
  ctx.fillStyle = 'rgba(14,10,14,0.9)';
  ctx.fillRect(0, 196, 1024, 120);
  ctx.fillStyle = shade(color, -0.3);
  ctx.fillRect(0, 190, 1024, 8);
  ctx.fillRect(0, 314, 1024, 8);
  const label = name.toUpperCase();
  for (const x of [256, 768]) {
    const size = fitFont(ctx, label, 440, 104);
    ctx.font = `800 ${size}px ${DISPLAY_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f4ead4';
    ctx.fillText(label, x, 259);
  }
  return toTexture(c);
}

/** Cartel flotante (sprite) con el nombre. Devuelve textura y proporción. */
export function labelTexture(name, color, { big = false } = {}) {
  const H = big ? 260 : 180;
  const label = name.toUpperCase();
  const [m, mctx] = canvas(10, 10);
  const size = fitFont(mctx, label, big ? 1500 : 900, big ? 150 : 104);
  mctx.font = `800 ${size}px ${DISPLAY_FONT}`;
  const textW = Math.ceil(mctx.measureText(label).width);
  const W = Math.min(2048, Math.max(H * 2.2, textW + H * 0.9));
  const [c, ctx] = canvas(W, H);
  const pad = 14;
  const rad = (H - pad * 2) / 2;
  const path = () => {
    ctx.beginPath();
    ctx.roundRect(pad, pad, W - pad * 2, H - pad * 2, rad);
  };
  // Halo
  ctx.shadowColor = color;
  ctx.shadowBlur = 26;
  path();
  ctx.fillStyle = 'rgba(8,6,10,0.94)';
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = big ? 9 : 7;
  ctx.strokeStyle = color;
  path();
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.roundRect(pad + 10, pad + 10, W - pad * 2 - 20, H - pad * 2 - 20, rad - 10);
  ctx.stroke();
  ctx.font = `800 ${size}px ${DISPLAY_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Sin halo en las letras: un contorno oscuro las mantiene nítidas.
  const y = H / 2 + size * 0.04;
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(6, size * 0.12);
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.strokeText(label, W / 2, y);
  ctx.fillStyle = '#fff8e8';
  ctx.fillText(label, W / 2, y);
  return { texture: toTexture(c), aspect: W / H };
}

export function woodTexture() {
  const [c, ctx] = canvas(1024, 512);
  const r = rng(42);
  const planks = 5;
  const ph = 512 / planks;
  for (let p = 0; p < planks; p++) {
    const base = 28 + r() * 14;
    ctx.fillStyle = `hsl(24, 42%, ${base * 0.55}%)`;
    ctx.fillRect(0, p * ph, 1024, ph);
    for (let i = 0; i < 70; i++) {
      const y = p * ph + r() * ph;
      ctx.strokeStyle = `hsla(22, 40%, ${8 + r() * 14}%, ${0.25 + r() * 0.35})`;
      ctx.lineWidth = 1 + r() * 2.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x <= 1024; x += 64) ctx.lineTo(x, y + Math.sin(x * 0.01 + i) * 3 * r());
      ctx.stroke();
    }
    // Nudos
    for (let k = 0; k < 2; k++) {
      const x = r() * 1024;
      const y = p * ph + ph * (0.3 + r() * 0.4);
      const grad = ctx.createRadialGradient(x, y, 1, x, y, 16 + r() * 10);
      grad.addColorStop(0, 'rgba(20,8,2,0.9)');
      grad.addColorStop(1, 'rgba(20,8,2,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(x, y, 30, 12, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(0, p * ph, 1024, 4);
  }
  // Suciedad
  for (let i = 0; i < 40; i++) {
    const x = r() * 1024;
    const y = r() * 512;
    const grad = ctx.createRadialGradient(x, y, 1, x, y, 40 + r() * 90);
    grad.addColorStop(0, 'rgba(0,0,0,0.35)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x - 130, y - 130, 260, 260);
  }
  return toTexture(c);
}

export function concreteTexture() {
  const [c, ctx] = canvas(512, 512);
  const r = rng(7);
  ctx.fillStyle = '#2a2622';
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 2600; i++) {
    const l = 8 + r() * 22;
    ctx.fillStyle = `hsla(30, 8%, ${l}%, ${0.15 + r() * 0.3})`;
    const s = 1 + r() * 4;
    ctx.fillRect(r() * 512, r() * 512, s, s);
  }
  for (let i = 0; i < 26; i++) {
    const x = r() * 512;
    const y = r() * 512;
    const grad = ctx.createRadialGradient(x, y, 2, x, y, 30 + r() * 80);
    grad.addColorStop(0, `rgba(${r() > 0.5 ? '10,6,4' : '60,52,44'},0.35)`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x - 120, y - 120, 240, 240);
  }
  // Grietas
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  for (let i = 0; i < 9; i++) {
    let x = r() * 512;
    let y = r() * 512;
    ctx.lineWidth = 0.6 + r() * 1.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k < 14; k++) {
      x += (r() - 0.5) * 40;
      y += (r() - 0.5) * 40;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  return toTexture(c, { repeat: [10, 10] });
}

export function brickTexture() {
  const [c, ctx] = canvas(512, 512);
  const r = rng(99);
  ctx.fillStyle = '#1a1210';
  ctx.fillRect(0, 0, 512, 512);
  const bh = 32;
  const bw = 96;
  for (let row = 0; row < 512 / bh; row++) {
    const off = row % 2 ? bw / 2 : 0;
    for (let x = -bw; x < 512 + bw; x += bw) {
      const l = 14 + r() * 12;
      ctx.fillStyle = `hsl(${8 + r() * 10}, ${30 + r() * 20}%, ${l}%)`;
      ctx.fillRect(x + off + 3, row * bh + 3, bw - 6, bh - 6);
      if (r() > 0.85) {
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(x + off + 3 + r() * 40, row * bh + 3, 30 + r() * 30, bh - 6);
      }
    }
  }
  return toTexture(c, { repeat: [2, 1] });
}

/** Interrogación luminosa de la caja misteriosa. */
export function questionTexture() {
  const [c, ctx] = canvas(256, 256);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 220px ${DISPLAY_FONT}`;
  ctx.shadowColor = '#5ff3ff';
  ctx.shadowBlur = 30;
  ctx.fillStyle = '#d9fdff';
  ctx.fillText('?', 128, 140);
  ctx.shadowBlur = 8;
  ctx.fillText('?', 128, 140);
  return toTexture(c);
}

export function signTexture() {
  const [c, ctx] = canvas(1024, 256);
  ctx.fillStyle = '#120708';
  ctx.fillRect(0, 0, 1024, 256);
  ctx.strokeStyle = '#d4a843';
  ctx.lineWidth = 10;
  ctx.strokeRect(14, 14, 996, 228);
  // Bombillas del marco
  for (let x = 40; x < 1000; x += 48) {
    for (const y of [30, 226]) {
      ctx.fillStyle = '#ffe9a8';
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 132px ${DISPLAY_FONT}`;
  ctx.shadowColor = '#ff3b5c';
  ctx.shadowBlur = 28;
  ctx.fillStyle = '#ffd9e0';
  ctx.fillText('CTP · GUM', 512, 134);
  return toTexture(c);
}

/** Punto suave para partículas y halos. */
export function softDotTexture() {
  const [c, ctx] = canvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.65)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return toTexture(c, { srgb: false });
}

export function smokeTexture() {
  const [c, ctx] = canvas(256, 256);
  const r = rng(5);
  for (let i = 0; i < 60; i++) {
    const x = 128 + (r() - 0.5) * 120;
    const y = 128 + (r() - 0.5) * 120;
    const rad = 30 + r() * 60;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, 'rgba(255,255,255,0.09)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
  }
  return toTexture(c, { srgb: false });
}

/** Anillo para la onda expansiva de la revelación. */
export function ringTexture() {
  const [c, ctx] = canvas(256, 256);
  const g = ctx.createRadialGradient(128, 128, 70, 128, 128, 128);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.75, 'rgba(255,255,255,0.9)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  return toTexture(c, { srgb: false });
}
