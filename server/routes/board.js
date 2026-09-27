import { Router } from 'express';
import { allow, requireAuth } from '../auth.js';
import {
  addChecklistItem,
  addComment,
  createCard,
  createList,
  deleteCard,
  deleteChecklistItem,
  deleteComment,
  deleteList,
  getBoard,
  getCard,
  moveCard,
  renameLabel,
  renameList,
  reorderLists,
  updateCard,
  updateChecklistItem,
} from '../board.js';

// Tablero tipo Trello: lo usa quien tenga la sección "tablero" (y el administrador).
export const boardRouter = Router();
boardRouter.use('/board', requireAuth, allow('tablero'));

boardRouter.get('/board', (req, res) => res.json(getBoard()));

// Listas: todas las operaciones devuelven el tablero actualizado.
boardRouter.post('/board/lists', (req, res) => {
  createList(req.body);
  res.status(201).json(getBoard());
});
boardRouter.put('/board/lists/order', (req, res) => {
  reorderLists(req.body?.ids);
  res.json(getBoard());
});
boardRouter.patch('/board/lists/:id', (req, res) => {
  renameList(req.params.id, req.body);
  res.json(getBoard());
});
boardRouter.delete('/board/lists/:id', (req, res) => {
  deleteList(req.params.id);
  res.json(getBoard());
});

// Tarjetas
boardRouter.post('/board/cards', (req, res) => res.status(201).json(getCard(createCard(req.body, req.user.id))));
boardRouter.get('/board/cards/:id', (req, res) => res.json(getCard(req.params.id)));
boardRouter.patch('/board/cards/:id', (req, res) => res.json(getCard(updateCard(req.params.id, req.body))));
boardRouter.put('/board/cards/:id/move', (req, res) => {
  moveCard(req.params.id, req.body);
  res.json(getBoard());
});
boardRouter.delete('/board/cards/:id', (req, res) => {
  deleteCard(req.params.id);
  res.json({ ok: true });
});

// Checklist y comentarios: devuelven la tarjeta completa.
boardRouter.post('/board/cards/:id/checklist', (req, res) => res.status(201).json(getCard(addChecklistItem(req.params.id, req.body))));
boardRouter.patch('/board/checklist/:id', (req, res) => res.json(getCard(updateChecklistItem(req.params.id, req.body))));
boardRouter.delete('/board/checklist/:id', (req, res) => res.json(getCard(deleteChecklistItem(req.params.id))));
boardRouter.post('/board/cards/:id/comments', (req, res) => res.status(201).json(getCard(addComment(req.params.id, req.body, req.user.id))));
boardRouter.delete('/board/comments/:id', (req, res) => res.json(getCard(deleteComment(req.params.id, req.user))));

// Etiquetas (colores fijos, nombre editable)
boardRouter.patch('/board/labels/:id', (req, res) => res.json(renameLabel(req.params.id, req.body)));
