import { useEffect, useRef, useState } from 'react';
import { MessageSquare, Send } from 'lucide-react';
import { getIntlLocale } from '../i18n/runtime.js';
import { chatCheck, systemNotice } from './tournamentLiveModel.js';
import { clock, entrantName, t, when } from './tournamentLiveUi.jsx';

const p = (key, values) => t('page.chat.' + key, values);
const legacyExact = new Map([
  ['Recuerda tomar captura al finalizar cada mapa para incluirlo en el envío del resultado.', 'captureReminder'],
  ['Las actas no coinciden. El staff revisará las pruebas adjuntas.', 'reportsDisagree'],
  ['Vencido el plazo sin acta del rival: se da por bueno el único acta subida.', 'reportTimedOut'],
]);
const legacyTemplates = [
  [/^Se ha solicitado asistencia del árbitro \(ticket ([^)]+)\)\.$/, 'refereeRequested', 'code'],
  [/^Se ha abierto una disputa por el resultado \(ticket ([^)]+)\)\. El staff revisará el caso\.$/, 'disputeOpened', 'code'],
  [/^Veto cerrado\. Orden de mapas: ([\s\S]+)$/, 'vetoClosed', 'maps'],
  [/^Resultado confirmado por el rival: (\d+-\d+)\.$/, 'resultConfirmed', 'score'],
  [/^Las dos actas coinciden: resultado firme (\d+-\d+)\.$/, 'reportsAgree', 'score'],
  [/^El staff ha resuelto la partida: (\d+-\d+)\.(?: ([\s\S]+))?$/, 'resultResolved', 'score'],
  [/^El staff ha RECTIFICADO el resultado: (\d+-\d+)\. Las rondas posteriores que dependían del resultado anterior se han deshecho\.(?: ([\s\S]+))?$/, 'resultRectified', 'score'],
  [/^El staff ha anulado el resultado\. La partida vuelve a estar pendiente\.(?: ([\s\S]+))?$/, 'resultReverted', null],
];

function localizeSystemNotice(body) {
  const notice = systemNotice(body) || legacyExact.get(body);
  if (notice) {
    try { return { text: p('notice.' + notice) }; }
    catch { return { text: p('notice.unknown') }; }
  }
  const number = new Intl.NumberFormat(getIntlLocale());
  for (const [pattern, key, value] of legacyTemplates) {
    const match = pattern.exec(body);
    if (match) return {
      text: p('notice.' + key, value === 'score' ? { score: match[1].split('-').map(part => number.format(Number(part))).join('–') }
        : value ? { [value]: match[1] } : undefined),
      reason: match[value ? 2 : 1],
    };
  }
  return { text: p('notice.unknown') };
}

function continuedBySameAuthor(previous, message) {
  return previous && !previous.system && !message.system && message.author_key
    && previous.author_key === message.author_key
    && Math.abs(Date.parse(message.created_at) - Date.parse(previous.created_at)) < 5 * 60_000;
}

export default function TournamentMatchChat({ match, messages, canWrite, busy, send }) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const list = useRef(null);
  const follow = useRef(true);
  const last = messages.at(-1)?.id;
  const check = chatCheck(draft);
  useEffect(() => {
    const node = list.current;
    if (node && follow.current) node.scrollTop = node.scrollHeight;
  }, [last]);
  async function submit() {
    if (!canWrite || !check.ready || busy) return;
    setError('');
    follow.current = true;
    const problem = await send(check.value);
    if (problem) setError(problem); else setDraft('');
  }
  return <section className="op-card op-live-chat" aria-labelledby="op-live-chat-title">
    <header className="op-section-title"><div><h3 id="op-live-chat-title"><MessageSquare size={18} aria-hidden="true" /> {p('title')}</h3>
      {canWrite && <p>{p('help')}</p>}</div></header>
    <div className="op-live-chat-scroll" ref={list} role="log" aria-labelledby="op-live-chat-title" onScroll={event => {
      const node = event.currentTarget;
      follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 64;
    }}>
      {!messages.length && <p className="op-live-empty">{p('empty')}</p>}
      {messages.length > 0 && <ol className="op-live-chat-list">
        {messages.map((message, index) => {
          const notice = message.system ? localizeSystemNotice(message.body) : null;
          const side = message.author_side;
          const continued = continuedBySameAuthor(messages[index - 1], message);
          const kind = message.system ? 'is-system' : side ? 'is-team-' + side : message.author_is_staff ? 'is-staff' : '';
          const affiliation = side && entrantName(match['entrant_' + side]);
          return <li key={message.id} className={kind + (continued ? ' is-continued' : '')}>
            {!continued && <header>
              <strong>{message.system ? p('system') : message.author_name || p('unknownAuthor')}</strong>
              {message.author_is_staff && !message.system && <span className="op-live-chat-staff">{t('arbitration.staff')}</span>}
              {affiliation && !message.system && <span className="op-live-chat-team">{affiliation}</span>}
              <time dateTime={message.created_at} title={when(message.created_at)} aria-label={when(message.created_at)}>{clock(message.created_at)}</time>
            </header>}
            <p>{notice ? notice.text : message.body}</p>
            {notice?.reason && <p>{notice.reason}</p>}
          </li>;
        })}
      </ol>}
    </div>
    {canWrite && <div className="op-live-chat-compose">
      <textarea rows={3} value={draft} disabled={busy} placeholder={p('placeholder')} aria-label={p('placeholder')}
        onChange={event => setDraft(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); } }} />
      <div className="op-live-chat-bar">
        <small className={check.tooLong ? 'is-alert' : ''}>{check.tooLong ? p('tooLong') : p('hint', { count: new Intl.NumberFormat(getIntlLocale()).format(check.left) })}</small>
        <button type="button" className="btn primary sm" disabled={busy || !check.ready} onClick={() => void submit()}><Send size={14} aria-hidden="true" /> {p('send')}</button>
      </div>
      {error && <p className="op-error" role="alert">{error}</p>}
    </div>}
  </section>;
}
