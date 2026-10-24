import { Badge } from '../operations/ui.jsx';
import { divisionLabel, rankedModeKey, rankedModeLabel } from './rankedLabels.js';

/** Selected mode of a match: Punto caliente or BYD, or the vote still open. */
export function ModeTag({ mode, pending }) {
  if (pending) return <Badge value="pending">Votando modo</Badge>;
  const key = rankedModeKey(mode);
  return mode ? <span className={`op-badge rm-mode ${key ? `is-${key}` : ''}`}>{rankedModeLabel(mode)}</span> : <span className="muted">—</span>;
}

const xpFormat = new Intl.NumberFormat('es-ES');
/** Division and XP the player had when the match formed. */
export function RankTag({ player }) {
  if (!player.division && player.xp == null) return null;
  return <span className={`rl-rank ${player.division ? `rank-${player.division}` : ''}`} title="División y XP con los que entró en la partida">
    {player.division ? divisionLabel(player.division) : 'Sin división'}{player.top50 ? ' · Top 50' : ''}{player.xp != null ? ` · ${xpFormat.format(player.xp)} XP` : ''}
  </span>;
}
