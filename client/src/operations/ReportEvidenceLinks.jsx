import {ExternalLink} from 'lucide-react';
import {reportEvidenceUrls} from '../../../shared/report-evidence.js';

export function ReportEvidenceLinks({details}) {
  const links = reportEvidenceUrls(details);
  if (!links.length) return null;
  return <div className="rl-report-evidence">{links.map(url => <a key={url} className="btn sm" href={url} target="_blank" rel="noopener noreferrer nofollow">
    <ExternalLink size={14} aria-hidden="true"/> Ver prueba · {new URL(url).hostname}
  </a>)}</div>;
}
