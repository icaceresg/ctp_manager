import {ticketProofUrl} from './ticket-proof.js';

/** Evidence is opened by staff explicitly; no provider requests or embeds. */
export function reportEvidenceUrls(details) {
  if (typeof details !== 'string' || details.length > 2000) return [];
  const candidates = details.match(/https?:\/\/[^\s<>"\u0000-\u001f\u007f]+/g) || [];
  return [...new Set(candidates.map(ticketProofUrl).filter(Boolean))].slice(0, 3);
}
