import { useEffect, useRef } from 'react';
import { LoaderCircle, UserRound, X } from 'lucide-react';
import { siInstagram, siTiktok, siX, siYoutube } from 'simple-icons';
import { PLATFORMS, formatLabel, groupPlatforms, statusLabel } from '../../../shared/catalog.js';

export function Spinner({ size = 16 }) {
  return <LoaderCircle size={size} className="spin" aria-label="Cargando" />;
}

// Pila de modales abiertos: Escape solo cierra el de arriba.
const modalStack = [];

export function Modal({ title, onClose, children, footer, size, headerExtra }) {
  const id = useRef(Symbol('modal'));
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const self = id.current;
    modalStack.push(self);
    const onKey = (e) => e.key === 'Escape' && modalStack.at(-1) === self && closeRef.current?.();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      modalStack.splice(modalStack.indexOf(self), 1);
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${size || ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-header">
          <h2>{title}</h2>
          {headerExtra}
          <span className="spacer" />
          <button className="btn ghost icon sm" onClick={onClose} aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>
        {children}
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children, action }) {
  return (
    <div className="empty">
      {Icon && <Icon size={40} strokeWidth={1.5} />}
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  );
}

export function StatusBadge({ status }) {
  return <span className={`badge status-${status}`}>{statusLabel(status)}</span>;
}

const ICONS = { instagram: siInstagram, x: siX, tiktok: siTiktok, youtube: siYoutube };

/** Logotipo de la red, en el color de la red (o del texto si es negro). */
export function PlatformIcon({ platform, size = 14 }) {
  const icon = ICONS[platform];
  if (!icon) return null;
  return (
    <svg
      className={`platform-icon p-${platform}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      role="img"
      aria-label={PLATFORMS[platform].label}
    >
      <path d={icon.path} />
    </svg>
  );
}

/** Iconos de las redes de una tarjeta (uno por red); con `withFormat` añade los formatos. */
export function PlatformList({ platforms, withFormat = false, size = 13 }) {
  if (!platforms?.length) return null;
  return (
    <span className="platform-list">
      {groupPlatforms(platforms).map((g) => {
        const formats = g.formats.map((f) => formatLabel(g.platform, f)).join(' + ');
        return (
          <span key={g.platform} className="platform-item" title={`${PLATFORMS[g.platform]?.label}: ${formats}`}>
            <PlatformIcon platform={g.platform} size={size} />
            {withFormat && <span>{formats}</span>}
          </span>
        );
      })}
    </span>
  );
}

export function OwnerBadge({ owner }) {
  if (!owner) return null;
  return (
    <span className="owner-badge" title={`Responsable: ${owner}`}>
      <UserRound size={11} /> {owner}
    </span>
  );
}

export function ResourceProgress({ resources }) {
  if (!resources?.length) return null;
  const done = resources.filter((r) => r.done).length;
  const complete = done === resources.length;
  return (
    <span className={`resource-progress ${complete ? 'complete' : ''}`} title={`${done} de ${resources.length} recursos listos`}>
      {done}/{resources.length}
    </span>
  );
}
