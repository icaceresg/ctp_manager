import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlignLeft,
  CalendarClock,
  CheckSquare,
  Ellipsis,
  MessageSquare,
  Plus,
  Tags,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';
import { api } from '../api.js';
import { useApp, useData } from '../context.jsx';
import { addDays, parseKey, toKey, todayKey } from '../dates.js';
import { EmptyState, LoadError, Modal, Spinner } from '../components/ui.jsx';

const shortDate = (key) => parseKey(key).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }).replace('.', '');
const initials = (name) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

function Avatar({ member, size = 24 }) {
  if (!member) return null;
  return (
    <span className="member-avatar" style={{ width: size, height: size, fontSize: size * 0.42 }} title={member.name}>
      {initials(member.name)}
    </span>
  );
}

function dueClass(card) {
  if (!card.due_date) return '';
  if (card.due_done) return 'done';
  if (card.due_date < todayKey()) return 'overdue';
  if (card.due_date <= toKey(addDays(new Date(), 2))) return 'soon';
  return '';
}

// ---------- Tarjeta en la columna ----------

function CardFront({ card, labels, members, dragging, draggable, onOpen, onDragStart, onDragEnd }) {
  const cardLabels = labels.filter((l) => card.labels.includes(l.id));
  const cardMembers = members.filter((m) => card.members.includes(m.id));
  const { total, done } = card.checklist;
  return (
    <div
      className={`board-card ${dragging ? 'dragging' : ''}`}
      data-card-id={card.id}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
    >
      {cardLabels.length > 0 && (
        <div className="card-labels">
          {cardLabels.map((l) => (
            <span key={l.id} className={`lbl lbl-${l.color}`}>
              {l.name}
            </span>
          ))}
        </div>
      )}
      <div className="card-title">{card.title}</div>
      {(card.due_date || card.has_description || total > 0 || card.comments > 0 || cardMembers.length > 0) && (
        <div className="card-badges">
          {card.due_date && (
            <span className={`badge-due ${dueClass(card)}`} title="Fecha límite">
              <CalendarClock size={12} /> {shortDate(card.due_date)}
            </span>
          )}
          {card.has_description && <AlignLeft size={13} className="muted" aria-label="Tiene descripción" />}
          {total > 0 && (
            <span className={`badge-mini ${done === total ? 'complete' : ''}`} title="Checklist">
              <CheckSquare size={12} /> {done}/{total}
            </span>
          )}
          {card.comments > 0 && (
            <span className="badge-mini" title="Comentarios">
              <MessageSquare size={12} /> {card.comments}
            </span>
          )}
          <span className="spacer" />
          <span className="card-members">
            {cardMembers.map((m) => (
              <Avatar key={m.id} member={m} size={22} />
            ))}
          </span>
        </div>
      )}
    </div>
  );
}

function Composer({ placeholder, button, onSubmit, onCancel, multiline }) {
  const [text, setText] = useState('');
  const submit = async () => {
    const value = text.trim();
    if (!value) return;
    await onSubmit(value);
    setText('');
  };
  const Field = multiline ? 'textarea' : 'input';
  return (
    <div className="board-composer">
      <Field
        className="input"
        autoFocus
        rows={2}
        placeholder={placeholder}
        value={text}
        maxLength={300}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
          if (e.key === 'Escape') onCancel();
        }}
      />
      <div className="row" style={{ gap: 6 }}>
        <button className="btn primary sm" onClick={submit}>
          {button}
        </button>
        <button className="btn ghost icon sm" onClick={onCancel} aria-label="Cancelar">
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

// ---------- Detalle de la tarjeta ----------

function CardModal({ cardId, board, onClose, onBoardChange }) {
  const { me, toast } = useApp();
  const [card, setCard] = useState(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [comment, setComment] = useState('');
  const [newItem, setNewItem] = useState('');

  useEffect(() => {
    api
      .get(`/board/cards/${cardId}`)
      .then((c) => {
        setCard(c);
        setTitle(c.title);
        setDescription(c.description);
      })
      .catch((err) => {
        toast(err.message, 'error');
        onClose();
      });
  }, [cardId, toast, onClose]);

  const run = useCallback(
    async (fn) => {
      try {
        const updated = await fn();
        if (updated?.id) setCard(updated);
        onBoardChange();
      } catch (err) {
        toast(err.message, 'error');
      }
    },
    [onBoardChange, toast],
  );
  const patch = (body) => run(() => api.patch(`/board/cards/${cardId}`, body));

  if (!card) {
    return (
      <Modal title="Tarjeta" onClose={onClose}>
        <div className="modal-body">
          <Spinner />
        </div>
      </Modal>
    );
  }

  const toggle = (list, id) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const doneItems = card.checklist.filter((i) => i.done).length;
  const listTitle = board.lists.find((l) => l.id === card.list_id)?.title;

  return (
    <Modal title={`En la lista: ${listTitle || ''}`} onClose={onClose} size="xl">
      <div className="card-modal">
        <div className="card-modal-main">
          <input
            className="title-input"
            value={title}
            maxLength={300}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => (title.trim() && title !== card.title ? patch({ title }) : setTitle(card.title))}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            aria-label="Título de la tarjeta"
          />

          <section className="field">
            <span className="label">
              <AlignLeft size={14} /> Descripción
            </span>
            <textarea
              className="textarea"
              rows={5}
              placeholder="Añade más detalles…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={() => description !== card.description && patch({ description })}
            />
          </section>

          <section className="field">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="label">
                <CheckSquare size={14} /> Checklist
              </span>
              {card.checklist.length > 0 && (
                <span className="muted small">
                  {doneItems}/{card.checklist.length}
                </span>
              )}
            </div>
            {card.checklist.length > 0 && (
              <div className="progress">
                <div style={{ width: `${(doneItems / card.checklist.length) * 100}%` }} />
              </div>
            )}
            <ul className="checklist-edit">
              {card.checklist.map((item) => (
                <li key={item.id} className={item.done ? 'done' : ''}>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={item.done}
                      onChange={(e) => run(() => api.patch(`/board/checklist/${item.id}`, { done: e.target.checked }))}
                    />
                    <span>{item.text}</span>
                  </label>
                  <button className="btn ghost icon sm" aria-label={`Quitar ${item.text}`} onClick={() => run(() => api.del(`/board/checklist/${item.id}`))}>
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
            <form
              className="input-group"
              onSubmit={(e) => {
                e.preventDefault();
                if (!newItem.trim()) return;
                run(() => api.post(`/board/cards/${cardId}/checklist`, { text: newItem }));
                setNewItem('');
              }}
            >
              <input className="input sm" placeholder="Añadir elemento…" value={newItem} maxLength={300} onChange={(e) => setNewItem(e.target.value)} />
              <button className="btn sm" disabled={!newItem.trim()}>
                <Plus size={14} /> Añadir
              </button>
            </form>
          </section>

          <section className="field">
            <span className="label">
              <MessageSquare size={14} /> Comentarios
            </span>
            <form
              className="stack"
              style={{ gap: 6 }}
              onSubmit={(e) => {
                e.preventDefault();
                if (!comment.trim()) return;
                run(() => api.post(`/board/cards/${cardId}/comments`, { text: comment }));
                setComment('');
              }}
            >
              <textarea className="textarea" rows={2} placeholder="Escribe un comentario…" value={comment} maxLength={2000} onChange={(e) => setComment(e.target.value)} />
              <div>
                <button className="btn sm" disabled={!comment.trim()}>
                  Comentar
                </button>
              </div>
            </form>
            <ul className="comment-list">
              {card.comments.map((c) => (
                <li key={c.id}>
                  <div className="row" style={{ gap: 8 }}>
                    <Avatar member={{ name: c.author }} size={24} />
                    <strong>{c.author}</strong>
                    <span className="muted small">
                      {new Date(c.created_at).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' })}
                    </span>
                    <span className="spacer" />
                    {(c.user_id === me.id || me.is_admin) && (
                      <button className="btn ghost icon sm" aria-label="Borrar comentario" onClick={() => run(() => api.del(`/board/comments/${c.id}`))}>
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                  <p className="pre comment-text">{c.text}</p>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <aside className="card-modal-side">
          <div className="field">
            <span className="label">Lista</span>
            <select
              className="select sm"
              value={card.list_id}
              onChange={(e) => {
                const listId = Number(e.target.value);
                const target = board.lists.find((l) => l.id === listId);
                run(async () => {
                  await api.put(`/board/cards/${cardId}/move`, { list_id: listId, position: target.cards.length });
                  return api.get(`/board/cards/${cardId}`);
                });
              }}
            >
              {board.lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <span className="label">
              <Tags size={14} /> Etiquetas
            </span>
            <div className="label-picker">
              {board.labels.map((l) => (
                <button
                  key={l.id}
                  className={`lbl lbl-${l.color} ${card.labels.includes(l.id) ? 'on' : 'off'}`}
                  aria-pressed={card.labels.includes(l.id)}
                  onClick={() => patch({ labels: toggle(card.labels, l.id) })}
                >
                  {l.name || ' '}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <span className="label">
              <UserRound size={14} /> Personas
            </span>
            <div className="member-picker">
              {board.members.map((m) => (
                <button
                  key={m.id}
                  className={`member-option ${card.members.includes(m.id) ? 'on' : ''}`}
                  aria-pressed={card.members.includes(m.id)}
                  onClick={() => patch({ members: toggle(card.members, m.id) })}
                >
                  <Avatar member={m} size={22} /> {m.name}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <span className="label">
              <CalendarClock size={14} /> Fecha límite
            </span>
            <input type="date" className="input sm" value={card.due_date || ''} onChange={(e) => patch({ due_date: e.target.value || null })} />
            {card.due_date && (
              <label className="checkbox small">
                <input type="checkbox" checked={card.due_done} onChange={(e) => patch({ due_done: e.target.checked })} />
                <span>Completada</span>
              </label>
            )}
          </div>

          <p className="muted small">
            Creada {card.created_by ? `por ${card.created_by} ` : ''}el{' '}
            {new Date(card.created_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}
          </p>

          <button
            className="btn ghost danger"
            onClick={async () => {
              if (!window.confirm(`¿Eliminar la tarjeta "${card.title}"? No se puede deshacer.`)) return;
              try {
                await api.del(`/board/cards/${cardId}`);
                onBoardChange();
                onClose();
              } catch (err) {
                toast(err.message, 'error');
              }
            }}
          >
            <Trash2 size={15} /> Eliminar tarjeta
          </button>
        </aside>
      </div>
    </Modal>
  );
}

function LabelsEditor({ labels, onClose, onSaved }) {
  const { toast } = useApp();
  return (
    <Modal title="Etiquetas" onClose={onClose}>
      <div className="modal-body stack">
        <p className="muted small">Pon nombre a cada color. Se actualiza en todas las tarjetas.</p>
        {labels.map((l) => (
          <div key={l.id} className="row">
            <span className={`lbl lbl-${l.color} swatch`} />
            <input
              className="input sm"
              defaultValue={l.name}
              maxLength={30}
              placeholder="Sin nombre"
              onBlur={async (e) => {
                if (e.target.value === l.name) return;
                try {
                  onSaved(await api.patch(`/board/labels/${l.id}`, { name: e.target.value }));
                } catch (err) {
                  toast(err.message, 'error');
                }
              }}
            />
          </div>
        ))}
      </div>
    </Modal>
  );
}

// ---------- Página ----------

export function BoardPage() {
  const { me, toast } = useApp();
  const { data: board, loading, error, reload, setData } = useData(() => api.get('/board'));
  const [openCard, setOpenCard] = useState(null);
  const [addingIn, setAddingIn] = useState(null);
  const [addingList, setAddingList] = useState(false);
  const [editingList, setEditingList] = useState(null);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [memberFilter, setMemberFilter] = useState('all');
  const [labelFilter, setLabelFilter] = useState('all');
  const [cardDrop, setCardDrop] = useState(null);
  const [listDrop, setListDrop] = useState(null);
  const drag = useRef(null);
  // Destino actual del arrastre. Se guarda también en una ref porque el
  // "drop" puede llegar antes de que React vuelva a pintar con el estado nuevo.
  const dropRef = useRef(null);

  // Si otra persona cambia el tablero, se ve al volver a esta ventana.
  useEffect(() => {
    const onFocus = () => !drag.current && !openCard && reload();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [reload, openCard]);

  const run = useCallback(
    async (fn) => {
      try {
        const next = await fn();
        if (next?.lists) setData(next);
        else reload();
      } catch (err) {
        toast(err.message, 'error');
        reload();
      }
    },
    [reload, setData, toast],
  );
  const closeCard = useCallback(() => setOpenCard(null), []);

  if (loading && !board) return <Spinner />;
  if (!board) return <div className="page"><h1>Tablero</h1><LoadError error={error} onRetry={reload} busy={loading} /></div>;

  const filtering = memberFilter !== 'all' || labelFilter !== 'all';
  const visible = (card) =>
    (memberFilter === 'all' || card.members.includes(memberFilter === 'me' ? me.id : Number(memberFilter))) &&
    (labelFilter === 'all' || card.labels.includes(Number(labelFilter)));

  // ----- Arrastrar tarjetas -----
  const cardDragOver = (e, list) => {
    if (drag.current?.type !== 'card') return;
    e.preventDefault();
    e.stopPropagation();
    const els = [...e.currentTarget.querySelectorAll('[data-card-id]')].filter((el) => Number(el.dataset.cardId) !== drag.current.id);
    let index = els.findIndex((el) => {
      const r = el.getBoundingClientRect();
      return e.clientY < r.top + r.height / 2;
    });
    if (index < 0) index = els.length;
    dropRef.current = { listId: list.id, index };
    if (cardDrop?.listId !== list.id || cardDrop.index !== index) setCardDrop({ listId: list.id, index });
  };

  const cardDropOn = (e, list) => {
    const target = dropRef.current;
    if (drag.current?.type !== 'card' || target?.listId !== list.id) return;
    e.preventDefault();
    e.stopPropagation();
    const { id } = drag.current;
    const { index } = target;
    dropRef.current = null;
    drag.current = null;
    setCardDrop(null);
    // Movimiento inmediato en pantalla; el servidor confirma el orden.
    setData((b) => {
      const card = b.lists.flatMap((l) => l.cards).find((c) => c.id === id);
      const lists = b.lists.map((l) => ({ ...l, cards: l.cards.filter((c) => c.id !== id) }));
      const target = lists.find((l) => l.id === list.id);
      target.cards.splice(index, 0, { ...card, list_id: list.id });
      return { ...b, lists };
    });
    run(() => api.put(`/board/cards/${id}/move`, { list_id: list.id, position: index }));
  };

  // ----- Arrastrar listas -----
  const listDragOver = (e) => {
    if (drag.current?.type !== 'list') return;
    e.preventDefault();
    const cols = [...e.currentTarget.querySelectorAll('[data-list-id]')].filter((el) => Number(el.dataset.listId) !== drag.current.id);
    let index = cols.findIndex((el) => {
      const r = el.getBoundingClientRect();
      return e.clientX < r.left + r.width / 2;
    });
    if (index < 0) index = cols.length;
    dropRef.current = { list: index };
    if (listDrop !== index) setListDrop(index);
  };

  const listDropOn = (e) => {
    const target = dropRef.current;
    if (drag.current?.type !== 'list' || target?.list === undefined) return;
    e.preventDefault();
    const { id } = drag.current;
    const ids = board.lists.map((l) => l.id).filter((x) => x !== id);
    ids.splice(target.list, 0, id);
    dropRef.current = null;
    drag.current = null;
    setListDrop(null);
    setData((b) => ({ ...b, lists: ids.map((lid) => b.lists.find((l) => l.id === lid)) }));
    run(() => api.put('/board/lists/order', { ids }));
  };

  const endDrag = () => {
    drag.current = null;
    dropRef.current = null;
    setCardDrop(null);
    setListDrop(null);
  };

  const draggedCard = drag.current?.type === 'card' ? drag.current.id : null;
  const listsOrder = board.lists.filter((l) => l.id !== (drag.current?.type === 'list' ? drag.current.id : null));

  return (
    <div className="page board-page">
      <div className="page-header">
        <div>
          <h1>Tablero</h1>
          <p>Arrastra las tarjetas entre listas. Haz clic en una tarjeta para ver sus detalles.</p>
        </div>
        <div className="btn-row">
          <select className="select sm" style={{ width: 'auto' }} value={memberFilter} onChange={(e) => setMemberFilter(e.target.value)} aria-label="Filtrar por persona">
            <option value="all">Todas las personas</option>
            <option value="me">Mis tarjetas</option>
            {board.members
              .filter((m) => m.id !== me.id)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
          </select>
          <select className="select sm" style={{ width: 'auto' }} value={labelFilter} onChange={(e) => setLabelFilter(e.target.value)} aria-label="Filtrar por etiqueta">
            <option value="all">Todas las etiquetas</option>
            {board.labels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name || l.color}
              </option>
            ))}
          </select>
          <button className="btn" onClick={() => setLabelsOpen(true)}>
            <Tags size={15} /> Etiquetas
          </button>
        </div>
      </div>
      <LoadError error={error} onRetry={reload} busy={loading} hasData />
      {filtering && <p className="muted small" style={{ marginTop: -10 }}>Con filtros activos no se pueden arrastrar tarjetas.</p>}

      <div className="board" onDragOver={listDragOver} onDrop={listDropOn}>
        {board.lists.map((list) => {
          const listIndex = listsOrder.findIndex((l) => l.id === list.id);
          const cards = list.cards.filter(visible);
          let shown = 0;
          return (
            <div key={list.id} className="board-list-wrap" data-list-id={list.id}>
              {listDrop === listIndex && <div className="list-drop-indicator" />}
              <section
                className={`board-list ${drag.current?.type === 'list' && drag.current.id === list.id ? 'dragging' : ''}`}
                onDragOver={(e) => !filtering && cardDragOver(e, list)}
                onDrop={(e) => cardDropOn(e, list)}
              >
                <header
                  className="board-list-head"
                  draggable={editingList !== list.id}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', `list:${list.id}`);
                    drag.current = { type: 'list', id: list.id };
                  }}
                  onDragEnd={endDrag}
                >
                  {editingList === list.id ? (
                    <input
                      className="input sm"
                      autoFocus
                      defaultValue={list.title}
                      maxLength={80}
                      onBlur={(e) => {
                        setEditingList(null);
                        if (e.target.value.trim() && e.target.value !== list.title) {
                          run(() => api.patch(`/board/lists/${list.id}`, { title: e.target.value }));
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur();
                        if (e.key === 'Escape') setEditingList(null);
                      }}
                    />
                  ) : (
                    <h2 onClick={() => setEditingList(list.id)} title="Clic para cambiar el nombre">
                      {list.title}
                    </h2>
                  )}
                  <span className="list-count">{list.cards.length}</span>
                  <button
                    className="btn ghost icon sm"
                    aria-label={`Eliminar la lista ${list.title}`}
                    title="Eliminar lista"
                    onClick={() => {
                      const extra = list.cards.length ? ` Se borrarán también sus ${list.cards.length} tarjetas.` : '';
                      if (window.confirm(`¿Eliminar la lista "${list.title}"?${extra}`)) run(() => api.del(`/board/lists/${list.id}`));
                    }}
                  >
                    <Ellipsis size={16} />
                  </button>
                </header>

                <div className="board-cards">
                  {cards.map((card) => {
                    const isDragged = card.id === draggedCard;
                    const placeholder = cardDrop?.listId === list.id && !isDragged && cardDrop.index === shown;
                    if (!isDragged) shown += 1;
                    return (
                      <div key={card.id}>
                        {placeholder && <div className="card-drop-indicator" />}
                        <CardFront
                          card={card}
                          labels={board.labels}
                          members={board.members}
                          dragging={isDragged}
                          draggable={!filtering}
                          onOpen={() => setOpenCard(card.id)}
                          onDragStart={(e) => {
                            e.dataTransfer.effectAllowed = 'move';
                            e.dataTransfer.setData('text/plain', `card:${card.id}`);
                            drag.current = { type: 'card', id: card.id };
                          }}
                          onDragEnd={endDrag}
                        />
                      </div>
                    );
                  })}
                  {cardDrop?.listId === list.id && cardDrop.index >= shown && <div className="card-drop-indicator" />}
                  {!cards.length && filtering && <p className="muted small">Ninguna tarjeta con estos filtros.</p>}
                </div>

                {addingIn === list.id ? (
                  <Composer
                    multiline
                    placeholder="Título de la tarjeta…"
                    button="Añadir tarjeta"
                    onCancel={() => setAddingIn(null)}
                    onSubmit={(title) => run(() => api.post('/board/cards', { list_id: list.id, title }))}
                  />
                ) : (
                  <button className="btn ghost sm add-card-btn" onClick={() => setAddingIn(list.id)}>
                    <Plus size={15} /> Añadir tarjeta
                  </button>
                )}
              </section>
            </div>
          );
        })}
        {listDrop === listsOrder.length && <div className="list-drop-indicator" />}

        <div className="board-list-wrap">
          {addingList ? (
            <section className="board-list">
              <Composer
                placeholder="Nombre de la lista…"
                button="Añadir lista"
                onCancel={() => setAddingList(false)}
                onSubmit={(title) => run(() => api.post('/board/lists', { title }))}
              />
            </section>
          ) : (
            <button className="add-list-btn" onClick={() => setAddingList(true)}>
              <Plus size={16} /> Añadir otra lista
            </button>
          )}
        </div>
      </div>

      {!board.lists.length && !addingList && (
        <div className="card">
          <EmptyState title="El tablero está vacío">Crea tu primera lista con "Añadir otra lista".</EmptyState>
        </div>
      )}

      {openCard && <CardModal cardId={openCard} board={board} onClose={closeCard} onBoardChange={reload} />}
      {labelsOpen && (
        <LabelsEditor labels={board.labels} onClose={() => setLabelsOpen(false)} onSaved={(labels) => setData((b) => ({ ...b, labels }))} />
      )}
    </div>
  );
}
