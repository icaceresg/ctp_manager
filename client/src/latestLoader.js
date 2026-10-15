/** Only the newest mounted request may publish data, errors or loading state. */
export function createLatestLoader(publish) {
  let active = true;
  let sequence = 0;
  return {
    activate() { active = true; },
    dispose() { active = false; sequence += 1; },
    async run(load) {
      const request = ++sequence;
      const current = () => active && request === sequence;
      if (!current()) return;
      publish('start');
      try {
        const data = await load();
        if (current()) publish('success', data);
        return data;
      } catch (error) {
        if (current()) publish('error', error);
      } finally {
        if (current()) publish('finish');
      }
    },
  };
}
