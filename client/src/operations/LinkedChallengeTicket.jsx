import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { isOpenChallengeResultTicket } from '../../../shared/challenges.js';
import { api } from '../api.js';
import { translate } from '../i18n/runtime.js';
import { competitionDateTime } from './competitionTime.js';
import { Field, FormDialog } from './ui.jsx';

const label = key => translate(`manager.tickets.challenge.${key}`);
const teamName = (team, empty = 'missingOpponent') => team?.name || translate(`manager.challenges.${team ? 'unknownClub' : empty}`);
const lockedCases = ['resolved', 'rejected', 'closed', 'closed_internal', 'resolution_pending'];

export function canProposeChallengeResult(incident, thread, match) {
  return Boolean(incident.source === 'ctp' && thread?.can_change_status && thread.ticket.id === incident.id && thread.ticket.challenge_id
    && match?.id === thread.ticket.challenge_id && match.status === 'en_disputa'
    && !lockedCases.includes(incident.status) && isOpenChallengeResultTicket(thread.ticket));
}

export function ChallengeResultDialog({ incident, match, mutate, onClose, onQueued }) {
  const teams = [match.poster_team, match.accepter_team].filter(team => team?.id && team.name);
  const [decision, setDecision] = useState(teams.length ? 'award' : 'cancel');
  async function submit(body) {
    const payload = { decision, resolution: body.resolution, expected_version: incident.version };
    if (decision === 'award') payload.winner_team_id = body.winner_team_id;
    try {
      await mutate('post', `/incidents/${encodeURIComponent(incident.id)}/resolve`, payload, label('proposalQueued'));
      onQueued();
    } catch (problem) {
      throw new Error(label(problem.status === 409 ? 'proposalConflict' : 'proposalFailed'));
    }
  }
  return <FormDialog title={label('resolve')} submitLabel={label('prepareProposal')} cancelLabel={label('cancel')}
    closeLabel={label('close')} help={label('proposalHelp')} onClose={onClose} submit={submit}>
    <Field label={label('decision')}><select value={decision} onChange={event => setDecision(event.target.value)}>
      {teams.length > 0 && <option value="award">{label('award')}</option>}
      <option value="cancel">{label('cancelMatch')}</option>
    </select></Field>
    {decision === 'award' && <Field label={translate('manager.challenges.winner')}>
      <select name="winner_team_id" defaultValue="" required>
        <option value="">{label('selectWinner')}</option>
        {teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}
      </select>
    </Field>}
    <Field label={label('reason')}><textarea name="resolution" required minLength={10} maxLength={2000} rows={5} /></Field>
  </FormDialog>;
}

export function LinkedChallengeTicket({ challengeId, incident, thread, focus, mutate }) {
  const [read, setRead] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [dialog, setDialog] = useState(false);
  const [queuedVersion, setQueuedVersion] = useState(null);
  const panel = useRef(null);
  const query = new URLSearchParams({ challenge_id: challengeId });
  useEffect(() => {
    const controller = new AbortController();
    const filters = new URLSearchParams({ challenge_id: challengeId });
    api.get(`/operations/challenges/matches?${filters}`, { signal: controller.signal }).then(value => {
      if (!controller.signal.aborted) setRead({ match: value.rows.find(row => row.id === challengeId) });
    }).catch(() => {
      if (!controller.signal.aborted) setRead({ failed: true });
    });
    return () => controller.abort();
  }, [challengeId, attempt]);
  const match = read?.match;
  useEffect(() => {
    if (!focus || !match) return;
    panel.current?.focus({ preventScroll: true });
    panel.current?.scrollIntoView({ block: 'nearest' });
  }, [focus, match]);

  const canResolve = queuedVersion !== incident.version && typeof mutate === 'function' && canProposeChallengeResult(incident, thread, match);
  const winner = match?.winner_team_id && [match.poster_team, match.accepter_team].find(team => team?.id === match.winner_team_id);
  return <section className="op-card" ref={panel} tabIndex={-1} aria-labelledby="ticket-challenge-heading">
    <div className="op-section-title">
      <div>
        <h3 id="ticket-challenge-heading">{label('heading')}</h3>
        {match && <p>{translate('manager.challenges.fixture', { home: teamName(match.poster_team), away: teamName(match.accepter_team) })}</p>}
      </div>
      <div className="op-actions">
        <Link className="btn sm" to={`/retos?${query}`}>{translate('manager.challenges.linkedMatch')}</Link>
        {canResolve && <button type="button" className="btn primary sm" onClick={() => setDialog(true)}>{label('resolve')}</button>}
      </div>
    </div>
    {!read && <p className="muted" role="status">{label('loading')}</p>}
    {read?.failed && <div className="op-actions"><p role="alert">{label('unavailable')}</p>
      <button type="button" className="btn sm" onClick={() => { setRead(null); setAttempt(value => value + 1); }}>{label('retry')}</button>
    </div>}
    {read && !match && !read.failed && <p className="muted">{label('notFound')}</p>}
    {match && <dl className="case-workspace__match-details">
      <div><dt>{translate('manager.challenges.status')}</dt><dd>{translate(`manager.challenges.matches.status.${match.status}`)}</dd></div>
      <div><dt>{translate('manager.challenges.scheduled')}</dt><dd><time dateTime={match.scheduled_slot}>{competitionDateTime(match.scheduled_slot)}</time></dd></div>
      {match.winner_team_id && <div><dt>{translate('manager.challenges.winner')}</dt><dd>{teamName(winner, 'unknownClub')}</dd></div>}
    </dl>}
    {dialog && canResolve && <ChallengeResultDialog incident={incident} match={match} mutate={mutate}
      onClose={() => setDialog(false)} onQueued={() => setQueuedVersion(incident.version)} />}
  </section>;
}
