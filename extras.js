// routes/extras.js — Avaliações, feedback, antecipos, chat (PostgreSQL)
const express = require('express');
const db = require('../db');
const { authRequired, roleRequired, entregadorRequired } = require('../middleware');

const router = express.Router();

// POST /api/ratings
router.post('/ratings', authRequired, async (req, res) => {
  const { order_id, stars, comment, tags } = req.body;
  const s = parseInt(stars);
  if (!order_id || !s || s < 1 || s > 5) return res.status(400).json({ error: 'Avaliação de 1 a 5 estrelas é obrigatória.' });
  const order = await db.get('SELECT * FROM orders WHERE id = $1', [order_id]);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });

  const role = req.user.role;
  let target_type, target_id, rated_col;
  if (role === 'entregador') {
    if (order.delivery_person_id !== req.user.id) return res.status(403).json({ error: 'Você não é o entregador deste pedido.' });
    if (!['a_caminho', 'entregue'].includes(order.status)) return res.status(400).json({ error: 'Você só pode avaliar depois de retirar o pedido.' });
    target_type = 'store'; target_id = order.store_id; rated_col = 'rated_store';
  } else if (role === 'cliente') {
    if (order.customer_id !== req.user.id) return res.status(403).json({ error: 'Não é seu pedido.' });
    if (order.status !== 'entregue') return res.status(400).json({ error: 'Você só pode avaliar depois de receber o pedido.' });
    if (!order.delivery_person_id) return res.status(400).json({ error: 'Este pedido não teve entregador.' });
    target_type = 'user'; target_id = order.delivery_person_id; rated_col = 'rated_delivery';
  } else {
    return res.status(403).json({ error: 'Apenas clientes e entregadores podem avaliar.' });
  }

  if (order[rated_col]) return res.status(400).json({ error: 'Você já avaliou este pedido.' });

  await db.withTransaction(async (client) => {
    await client.query(`INSERT INTO ratings (order_id,rater_user_id,target_type,target_id,stars,comment,tags) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [order_id, req.user.id, target_type, target_id, s, comment || '', tags || null]);
    await client.query(`UPDATE orders SET ${rated_col} = 1 WHERE id = $1`, [order_id]);
  });
  res.json({ ok: true, message: 'Obrigado pela sua avaliação! ⭐' });
});

// GET /api/ratings/avg
router.get('/ratings/avg', async (req, res) => {
  const { target_type, target_id } = req.query;
  if (!target_type || !target_id) return res.status(400).json({ error: 'Faltam parâmetros.' });
  const r = await db.get('SELECT AVG(stars)::float AS avg, COUNT(*)::int AS n FROM ratings WHERE target_type=$1 AND target_id=$2', [target_type, target_id]);
  res.json({ avg: r.avg ? +r.avg.toFixed(1) : null, count: r.n });
});

// POST /api/feedback
router.post('/feedback', authRequired, async (req, res) => {
  const { message, name } = req.body;
  if (!message || !message.trim()) return res.status(400).json({ error: 'Escreva sua opinião.' });
  await db.run('INSERT INTO feedback (user_id,name,message) VALUES ($1,$2,$3)', [req.user.id, name || req.user.name, message.trim()]);
  res.json({ ok: true, message: 'Obrigado! Sua opinião foi enviada à equipe.' });
});

// GET /api/feedback — admin
router.get('/feedback', authRequired, roleRequired('admin'), async (req, res) => {
  const fb = await db.query(`SELECT f.*, u.email, u.role FROM feedback f LEFT JOIN users u ON u.id=f.user_id
                         ORDER BY f.read, f.created_at DESC LIMIT 200`);
  res.json({ feedback: fb, unread: fb.filter(f => !f.read).length });
});
router.patch('/feedback/:id/read', authRequired, roleRequired('admin'), async (req, res) => {
  await db.run('UPDATE feedback SET read = 1 WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// POST /api/advances — entregador solicita antecipação
router.post('/advances', entregadorRequired, async (req, res) => {
  const { amount, note } = req.body;
  const amt = parseFloat(amount);
  if (!amt || amt <= 0) return res.status(400).json({ error: 'Informe um valor válido.' });
  const me = await db.get('SELECT balance, status, pix_key FROM users WHERE id = $1', [req.user.id]);
  if (me.status !== 'ativo') return res.status(403).json({ error: 'Conta não aprovada.' });
  if (me.balance <= 0) return res.status(400).json({ error: 'Você não tem saldo disponível para antecipação.' });
  if (amt > me.balance) return res.status(400).json({ error: `Você pode antecipar até R$ ${me.balance.toFixed(2).replace('.', ',')}.` });
  if (!me.pix_key) return res.status(400).json({ error: 'Cadastre sua Pix no seu perfil para receber antecipações.' });
  await db.run('INSERT INTO advances (user_id,amount,note) VALUES ($1,$2,$3)', [req.user.id, amt, note || '']);
  res.json({ ok: true, message: 'Solicitação de antecipação enviada. O admin aprovará via Pix em breve.' });
});

// GET /api/advances
router.get('/advances', authRequired, async (req, res) => {
  let rows;
  if (req.user.role === 'admin') {
    rows = await db.query(`SELECT a.*, u.name, u.pix_key, u.phone FROM advances a JOIN users u ON u.id=a.user_id
                       ORDER BY a.status='pendente' DESC, a.created_at DESC`);
  } else {
    rows = await db.query('SELECT * FROM advances WHERE user_id = $1 ORDER BY created_at DESC', [req.user.id]);
  }
  res.json({ advances: rows });
});

// PATCH /api/advances/:id — admin aprova/rejeita
router.patch('/advances/:id', authRequired, roleRequired('admin'), async (req, res) => {
  const { status, note } = req.body;
  if (!['aprovado', 'rejeitado'].includes(status)) return res.status(400).json({ error: 'Status inválido.' });
  const adv = await db.get('SELECT * FROM advances WHERE id = $1', [req.params.id]);
  if (!adv) return res.status(404).json({ error: 'Solicitação não encontrada.' });
  if (adv.status !== 'pendente') return res.status(400).json({ error: 'Já foi processada.' });

  await db.withTransaction(async (client) => {
    await client.query(`UPDATE advances SET status=$1, note=$2, resolved_at=NOW() WHERE id=$3`, [status, note || '', adv.id]);
    if (status === 'aprovado') {
      await client.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [adv.amount, adv.user_id]);
      await client.query(`INSERT INTO transactions (user_id,type,amount,description) VALUES ($1,'debito',$2,$3)`,
        [adv.user_id, adv.amount, `Antecipação paga via Pix - solicitação #${adv.id}`]);
    }
  });
  res.json({ ok: true, message: status === 'aprovado' ? 'Antecipação aprovada e descontada do saldo.' : 'Solicitação rejeitada.' });
});

// ==================== CHAT por pedido ====================
async function isParticipant(userId, order) {
  const store = await db.get('SELECT owner_id FROM stores WHERE id = $1', [order.store_id]);
  return userId === order.customer_id || userId === order.delivery_person_id || (store && userId === store.owner_id);
}

// POST /api/messages
router.post('/messages', authRequired, async (req, res) => {
  const { order_id, text, to_group, recipient_id } = req.body;
  if (!order_id || !text || !text.trim()) return res.status(400).json({ error: 'Pedido e mensagem são obrigatórios.' });
  const order = await db.get('SELECT * FROM orders WHERE id = $1', [order_id]);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
  if (req.user.role !== 'admin' && !(await isParticipant(req.user.id, order)))
    return res.status(403).json({ error: 'Você não participa deste pedido.' });
  const rec = to_group ? null : (recipient_id || null);
  if (rec && !(await isParticipant(rec, order))) return res.status(400).json({ error: 'Destinatário não participa deste pedido.' });
  const info = await db.run('INSERT INTO messages (order_id,sender_id,recipient_id,text) VALUES ($1,$2,$3,$4) RETURNING id',
    [order_id, req.user.id, rec, text.trim()]);
  res.json({ ok: true, message_id: info.rows[0].id });
});

// GET /api/messages/:order_id
router.get('/messages/:order_id', authRequired, async (req, res) => {
  const order = await db.get('SELECT * FROM orders WHERE id = $1', [req.params.order_id]);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
  if (req.user.role !== 'admin' && !(await isParticipant(req.user.id, order)))
    return res.status(403).json({ error: 'Você não participa deste pedido.' });
  let rows;
  if (req.user.role === 'admin') {
    rows = await db.query('SELECT m.*, u.name AS sender_name FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.order_id=$1 ORDER BY m.created_at', [req.params.order_id]);
  } else {
    rows = await db.query(`SELECT m.*, u.name AS sender_name FROM messages m JOIN users u ON u.id=m.sender_id
                       WHERE m.order_id=$1 AND (m.recipient_id IS NULL OR m.sender_id=$2 OR m.recipient_id=$2)
                       ORDER BY m.created_at`, [req.params.order_id, req.user.id, req.user.id]);
  }
  res.json({ messages: rows });
});

module.exports = router;
