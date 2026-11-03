import { Download, ExternalLink, FolderOpen } from 'lucide-react';
import { parseDriveLink } from '../../../shared/drive.js';

export function DriveLinks({ url, compact = false }) {
  const link = parseDriveLink(url);
  if (!link) return null;
  return <div className={`content-drive${compact ? ' is-compact' : ''}`}>
    <div className="content-drive-actions">
      <a className="btn sm" href={link.url} target="_blank" rel="noopener noreferrer">
        {link.kind === 'folder' ? <FolderOpen size={15} /> : <ExternalLink size={15} />} Abrir en Drive
      </a>
      {link.downloadUrl && <a className="btn sm" href={link.downloadUrl} target="_blank" rel="noopener noreferrer">
        <Download size={15} /> Descargar en Drive
      </a>}
    </div>
    {!compact && <span className="hint">{link.downloadUrl
      ? 'Google puede pedirte acceso o confirmar la descarga.'
      : 'Abre el enlace para descargar desde Google. Necesitas permiso de acceso.'}</span>}
  </div>;
}
