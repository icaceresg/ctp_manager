import es from './locales/es.json' with { type: 'json' };
import en from './locales/en.json' with { type: 'json' };
import it from './locales/it.json' with { type: 'json' };
import fr from './locales/fr.json' with { type: 'json' };
import pt from './locales/pt.json' with { type: 'json' };
import de from './locales/de.json' with { type: 'json' };

const catalogues = { es, en, it, fr, pt, de };
const locales = { es: 'es-ES', en: 'en-GB', it: 'it-IT', fr: 'fr-FR', pt: 'pt-PT', de: 'de-DE' };
function language() {
  const requested = (globalThis.document?.documentElement?.lang || 'es').toLowerCase().split('-')[0];
  return Object.hasOwn(catalogues, requested) ? requested : 'en';
}
export const getIntlLocale = () => locales[language()];
export function translate(key, values = {}) {
  const sentence = catalogues[language()][key];
  if (typeof sentence !== 'string') throw new Error(`Unknown translation key: ${key}`);
  return sentence.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? `{${name}}`));
}
