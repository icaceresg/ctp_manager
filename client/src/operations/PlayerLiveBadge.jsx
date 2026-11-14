import { useSyncExternalStore } from 'react';
import { Radio, ExternalLink } from 'lucide-react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { translate } from '../i18n/runtime.js';
import { createPlayerLiveStore, playerLiveUrl } from './playerLiveModel.js';
import './player-live.css';

const stores = new Map();
const emptySnapshot = () => null;
const inactive = () => () => {};
function sessionStore(id) {
  if (id == null) return null;
  if (!stores.has(id)) {
    if (stores.size >= 8) stores.delete(stores.keys().next().value);
    stores.set(id, createPlayerLiveStore({
      request: signal => api.get('/operations/player-live', { signal }),
      isVisible: () => typeof document !== 'undefined' && document.visibilityState !== 'hidden',
      observeVisibility(changed) { document.addEventListener('visibilitychange', changed); return () => document.removeEventListener('visibilitychange', changed); },
    }));
  }
  return stores.get(id);
}

/** No player-specific requests: all badges subscribe to one visible, bounded read. */
export default function PlayerLiveBadge({ userId, name }) {
  const store = sessionStore(useApp()?.me?.id);
  const directory = useSyncExternalStore(store?.subscribe ?? inactive, store?.getSnapshot ?? emptySnapshot, emptySnapshot);
  const channel = directory?.streams.find(row => row.user_id === String(userId).toLowerCase())?.channel;
  return <PlayerLiveLink channel={channel} name={name} />;
}

/** Pure presentation boundary used by the explicitly synthetic DEV checks. */
export function PlayerLiveLink({ channel, name }) {
  const href = playerLiveUrl(channel);
  if (!href) return null;
  const label = translate('manager.playerLive.watch', { name: name || channel });
  return <a className="op-player-live" href={href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"
    title={label} aria-label={label} onClick={event => event.stopPropagation()}>
    <Radio size={13} aria-hidden="true" /><span>{translate('manager.playerLive.badge')}</span><ExternalLink size={11} aria-hidden="true" />
  </a>;
}
