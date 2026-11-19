// routes/reports.js — Denúncias + avisos amigáveis (PostgreSQL)
const express = require('express');
const db = require('../db');
const { authRequired, roleRequired, entregadorRequired } = require('../middleware');

const router = express.Router();

// POST /api/reports — Entregador denuncia
router.post('/', entregadorRequired, async (req, res) => {
  const { order_id, reason, photo } = req.body;
  if (!order_id || !reason || !reason.trim()) return res.status(400).json({ error: 'Conte o que aconteceu (motivo obrigatório).' });
  const me = await db.get('SELECT status FROM users WHERE id = $1', [req.user.id]);
  if (me.status !== 'ativo') return res.status(403).json({ error: 'Conta não aprovada.' });
  const order = await db.get('SELECT * FROM orders WHERE id = $1', [order_id]);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
  if (!['pronto', 'a_caminho'].includes(order.status))
    return res.status(400).json({ error: 'Só é possível denunciar um pedido marcado como pronto ou em entrega.' });

  const inserted = await db.run(`INSERT INTO reports (order_id,delivery_person_id,store_id,reason,photo,status)
                           VALUES ($1,$2,$3,$4,$5,'aberto') RETURNING id`,
    [order_id, req.user.id, order.store_id, reason.trim(), photo || null]);
  await db.run('UPDATE orders SET false_reported = 1 WHERE id = $1', [order_id]);

  res.status(201).json({ report_id: inserted.rows[0].id,
    message: 'Denúncia registrada. A equipe analisará e, se confirmado, a loja receberá um aviso amigável. Você não será prejudicado.' });
});

// GET /api/reports — Admin lista
router.get('/', authRequired, roleRequired('admin'), async (req, res) => {
  let sql = `SELECT r.*, o.status AS order_status, o.total, o.ready_claimed_at,
             s.name AS store_name, u.name AS delivery_name, u.phone AS delivery_phone
             FROM reports r
             JOIN orders o ON o.id = r.order_id
             JOIN stores s ON s.id = r.store_id
             JOIN users u ON u.id = r.delivery_person_id`;
  const p = [];
  if (req.query.status) { sql += ' WHERE r.status = $1'; p.push(req.query.status); }
  sql += " ORDER BY CASE WHEN r.status='aberto' THEN 0 ELSE 1 END, r.created_at DESC";
  res.json({ reports: await db.query(sql, p) });
});

// PATCH /api/reports/:id — Admin resolve; warn_loja gera aviso amigável
router.patch('/:id', authRequired, roleRequired('admin'), async (req, res) => {
  const { resolution, warn_loja } = req.body;
  const report = await db.get('SELECT * FROM reports WHERE id = $1', [req.params.id]);
  if (!report) return res.status(404).json({ error: 'Denúncia não encontrada.' });

  await db.withTransaction(async (client) => {
    await client.query(`UPDATE reports SET status='resolvido', resolution=$1, resolved_at=NOW() WHERE id=$2`,
      [resolution || 'Analisado pela equipe.', report.id]);
    if (warn_loja) {
      const msg = `Olá! Um entregador relatou que o pedido #${report.order_id} foi marcado como "pronto" antes de estar realmente pronto. `
        + `Isso pode ter sido um engano — sem problemas! Da próxima vez, ajuste o status somente quando o pedido estiver de fato pronto, `
        + `assim o entregador não perde tempo e todos saem ganhando. Você pode corrigir o status a qualquer momento na tela de pedidos.`;
      await client.query('INSERT INTO warnings (store_id, report_id, message) VALUES ($1,$2,$3)', [report.store_id, report.id, msg]);
    }
  });

  res.json({ ok: true, message: warn_loja ? 'Resolvido. Aviso amigável enviado à loja.' : 'Resolvido (arquivado).' });
});

// GET /api/reports/warnings/mine — Loja vê seus avisos
router.get('/warnings/mine', authRequired, roleRequired('loja'), async (req, res) => {
  const store = await db.get('SELECT id FROM stores WHERE owner_id = $1', [req.user.id]);
  if (!store) return res.json({ warnings: [] });
  const warnings = await db.query('SELECT * FROM warnings WHERE store_id = $1 ORDER BY created_at DESC', [store.id]);
  const unread = warnings.filter(w => !w.read).length;
  res.json({ warnings, unread });
});

// PATCH /api/reports/warnings/:id/read
router.patch('/warnings/:id/read', authRequired, roleRequired('loja'), async (req, res) => {
  await db.run('UPDATE warnings SET read = 1 WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
