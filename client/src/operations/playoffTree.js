/**
 * Position cards by their tournament slot and link each match to the same
 * destination used by the results server: next round, ceil(position / 2).
 * Slot spacing is independent of which fixtures are present or highlighted.
 */
export function playoffTree(matches) {
  const valid = matches.filter(({ round, position }) =>
    Number.isSafeInteger(round) && round >= 1 && round <= 16 &&
    Number.isSafeInteger(position) && position >= 1 && position <= 256);
  const first = Math.min(...valid.map(match => match.round));
  const nodes = valid.map(match => {
    const span = 2 ** (match.round - first);
    return { ...match, center: (match.position - 0.5) * span, span };
  });
  const bySlot = new Map(nodes.map(node => [`${node.round}:${node.position}`, node]));
  const feeders = new Map();
  for (const node of nodes) {
    const next = bySlot.get(`${node.round + 1}:${Math.ceil(node.position / 2)}`);
    if (!next) continue;
    const from = feeders.get(next.id) ?? [];
    from.push(node.center);
    feeders.set(next.id, from);
  }
  const columns = [...new Set(nodes.map(node => node.round))].sort((a, b) => a - b).map(round => ({
    round,
    nodes: nodes.filter(node => node.round === round).sort((a, b) => a.position - b.position),
    joins: nodes.filter(node => node.round === round + 1 && feeders.has(node.id)).map(node => {
      const starts = feeders.get(node.id);
      const top = Math.min(node.center, ...starts);
      return { id: node.id, starts, end: node.center, top, height: Math.max(node.center, ...starts) - top };
    }),
  }));
  return { columns, rows: Math.max(1, ...nodes.map(node => node.center + node.span / 2)) };
}
