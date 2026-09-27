// Catálogo compartido entre servidor y navegador: redes, formatos, estados
// y responsables.

export const PLATFORMS = {
  instagram: {
    label: 'Instagram',
    formats: { reel: 'Reel', carrusel: 'Carrusel', post: 'Post', story: 'Story', directo: 'Directo' },
    copyLimit: 2200,
  },
  x: {
    label: 'X',
    formats: { post: 'Post', hilo: 'Hilo' },
    copyLimit: 280,
  },
  tiktok: {
    label: 'TikTok',
    formats: { video: 'Vídeo', carrusel: 'Carrusel', story: 'Story', directo: 'Directo' },
    copyLimit: null,
  },
  youtube: {
    label: 'YouTube',
    formats: { video: 'Vídeo', short: 'Short', directo: 'Directo' },
    copyLimit: null,
  },
};

export const PLATFORM_IDS = Object.keys(PLATFORMS);

// Flujo de revisión del equipo: nunca se pasa de "No listo" a publicar.
export const STATUSES = [
  { id: 'no_listo', label: 'No listo' },
  { id: 'revision', label: 'En revisión' },
  { id: 'listo', label: 'Listo' },
  { id: 'publicado', label: 'Publicado' },
];

export const STATUS_IDS = STATUSES.map((s) => s.id);
export const DEFAULT_STATUS = 'no_listo';

// Sugerencias para el campo Responsable (se puede escribir cualquier otro).
export const DEFAULT_OWNERS = ['Diseño', 'Edición', 'RRSS'];

export function statusLabel(id) {
  return STATUSES.find((s) => s.id === id)?.label || id;
}

export function formatLabel(platform, format) {
  return PLATFORMS[platform]?.formats[format] || format;
}

/** Ordena una lista de { platform, format } según el orden del catálogo. */
export function sortPlatforms(list) {
  const rank = (p) => {
    const pi = PLATFORM_IDS.indexOf(p.platform);
    const fi = Object.keys(PLATFORMS[p.platform]?.formats || {}).indexOf(p.format);
    return pi * 100 + fi;
  };
  return [...list].sort((a, b) => rank(a) - rank(b));
}

/** Agrupa { platform, format } por red: [{ platform, formats: [...] }]. */
export function groupPlatforms(list) {
  const groups = [];
  for (const p of sortPlatforms(list || [])) {
    const last = groups.at(-1);
    if (last?.platform === p.platform) last.formats.push(p.format);
    else groups.push({ platform: p.platform, formats: [p.format] });
  }
  return groups;
}
