// routes/admin.js — Painel administrativo (PostgreSQL)
const express = require('express');
const db = require('../db');
const { authRequired, roleRequired } = require('../middleware');

const router = express.Router();
router.use(authRequired, roleRequired('admin'));

// GET /api/admin/stats
router.get('/stats', async (req, res) => {
  const q = async (sql, p = []) => (await db.get(sql, p));
  const c = async (label) => (await q(`SELECT COUNT(*)::int AS c FROM ${label}`)).c;
  res.json({
    users: await c('users'),
    clientes: (await q("SELECT COUNT(*)::int AS c FROM users WHERE role='cliente'")).c,
    lojas: (await q("SELECT COUNT(*)::int AS c FROM users WHERE role='loja'")).c,
    entregadores: (await q("SELECT COUNT(*)::int AS c FROM users WHERE role='entregador'")).c,
    entregadores_pendentes: (await q("SELECT COUNT(*)::int AS c FROM users WHERE role='entregador' AND status='pendente'")).c,
    lojas_pendentes: (await q("SELECT COUNT(*)::int AS c FROM stores WHERE is_approved=0")).c,
    stores: await c('stores'),
    products: await c('products'),
    orders: await c('orders'),
    orders_today: (await q("SELECT COUNT(*)::int AS c FROM orders WHERE created_at::date = CURRENT_DATE")).c,
    revenue_total: (await q("SELECT COALESCE(SUM(total),0)::float AS s FROM orders WHERE status='entregue'")).s,
    revenue_today: (await q("SELECT COALESCE(SUM(total),0)::float AS s FROM orders WHERE status='entregue' AND created_at::date = CURRENT_DATE")).s,
    pending_approvals: (await q("SELECT COUNT(*)::int AS c FROM users WHERE status='pendente'")).c + (await q("SELECT COUNT(*)::int AS c FROM stores WHERE is_approved=0")).c,
  });
});

// GET /api/admin/users?role=&status=
router.get('/users', async (req, res) => {
  let sql = `SELECT id,name,surname,social_name,email,phone,role,address,city,vehicle,plate,vehicle_type,
      status,balance,created_at,cpf,birth_date,photo,
      bike_number,bike_color,bike_wheel_size,bike_electric,
      renavam,moto_brand,moto_model,moto_color,moto_cyl,cnh_front,cnh_back,moto_doc,email_verified,terms_accepted
      FROM users WHERE 1=1`;
  const p = [];
  let idx = 1;
  if (req.query.role) { sql += ` AND role = $${idx++}`; p.push(req.query.role); }
  if (req.query.status) { sql += ` AND status = $${idx++}`; p.push(req.query.status); }
  sql += ' ORDER BY created_at DESC';
  res.json({ users: await db.query(sql, p) });
});

// PATCH /api/admin/users/:id
router.patch('/users/:id', async (req, res) => {
  const { status } = req.body;
  if (!['ativo', 'bloqueado', 'pendente'].includes(status)) return res.status(400).json({ error: 'Status inválido.' });
  if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: 'Você não pode modificar sua própria conta.' });
  await db.run('UPDATE users SET status = $1 WHERE id = $2', [status, req.params.id]);
  res.json({ ok: true, user: await db.get('SELECT id,name,email,role,status FROM users WHERE id = $1', [req.params.id]) });
});

// GET /api/admin/stores
router.get('/stores', async (req, res) => {
  const stores = await db.query(`SELECT s.*, u.name AS owner_name, u.email AS owner_email, u.status AS owner_status
                             FROM stores s JOIN users u ON u.id = s.owner_id ORDER BY s.is_approved, s.created_at DESC`);
  res.json({ stores });
});

// PATCH /api/admin/stores/:id
router.patch('/stores/:id', async (req, res) => {
  const { is_approved, is_open } = req.body;
  const store = await db.get('SELECT * FROM stores WHERE id = $1', [req.params.id]);
  if (!store) return res.status(404).json({ error: 'Loja não encontrada.' });
  await db.run('UPDATE stores SET is_approved = $1, is_open = $2 WHERE id = $3',
    [is_approved === undefined ? store.is_approved : (is_approved ? 1 : 0),
      is_open === undefined ? store.is_open : (is_open ? 1 : 0), req.params.id]);
  res.json({ ok: true, store: await db.get('SELECT * FROM stores WHERE id = $1', [req.params.id]) });
});

// GET /api/admin/orders
router.get('/orders', async (req, res) => {
  const orders = await db.query(`SELECT o.*, s.name AS store_name, c.name AS customer_name, d.name AS delivery_name
                             FROM orders o JOIN stores s ON s.id=o.store_id JOIN users c ON c.id=o.customer_id
                             LEFT JOIN users d ON d.id=o.delivery_person_id ORDER BY o.created_at DESC LIMIT 300`);
  res.json({ orders });
});

// GET /api/admin/finance
router.get('/finance', async (req, res) => {
  const pct = parseFloat(await db.getSetting('commission_pct', '15'));
  const commissionEarned = (await db.get(`SELECT COALESCE(SUM(amount),0)::float AS s FROM transactions
                                       WHERE description LIKE 'Comissão%'`)).s;
  const lojas = await db.query(`SELECT id,name,email,phone,balance FROM users WHERE role='loja' AND balance != 0 ORDER BY balance DESC`);
  const entregadores = await db.query(`SELECT id,name,email,phone,vehicle,balance FROM users WHERE role='entregador' AND balance != 0 ORDER BY balance DESC`);
  const aPagar = [...lojas, ...entregadores].filter(u => u.balance > 0).reduce((s, u) => s + u.balance, 0);
  const aReceber = entregadores.filter(u => u.balance < 0).reduce((s, u) => s + Math.abs(u.balance), 0);
  const tx = await db.query('SELECT t.*, u.name FROM transactions t JOIN users u ON u.id=t.user_id ORDER BY t.created_at DESC LIMIT 100');
  res.json({ commission_pct: pct, commission_earned: commissionEarned, a_pagar: aPagar, a_receber: aReceber, lojas, entregadores, transactions: tx });
});

// POST /api/admin/settle/:user_id
router.post('/settle/:user_id', async (req, res) => {
  const user = await db.get('SELECT id,name,role,balance FROM users WHERE id = $1', [req.params.user_id]);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
  if (user.balance === 0) return res.status(400).json({ error: 'Saldo já está zerado.' });
  const tipo = user.balance > 0 ? 'debito' : 'credito';
  const desc = user.balance > 0 ? `Pagamento efetuado a ${user.name} (liquidação)` : `Recebido de ${user.name} (liquidação em dinheiro)`;
  await db.withTransaction(async (client) => {
    await client.query(`INSERT INTO transactions (user_id,type,amount,description) VALUES ($1,$2,$3,$4)`,
      [user.id, tipo, Math.abs(user.balance), desc]);
    await client.query('UPDATE users SET balance = 0 WHERE id = $1', [user.id]);
  });
  res.json({ ok: true, message: `Saldo de ${user.name} liquidado.` });
});

// GET /api/admin/settings
router.get('/settings', async (req, res) => {
  res.json({
    commission_pct: await db.getSetting('commission_pct', '15'),
    min_delivery_fee: await db.getSetting('min_delivery_fee', '8'),
  });
});

// PATCH /api/admin/settings
router.patch('/settings', async (req, res) => {
  const { commission_pct, min_delivery_fee } = req.body;
  if (commission_pct != null) await db.setSetting('commission_pct', String(commission_pct));
  if (min_delivery_fee != null) await db.setSetting('min_delivery_fee', String(min_delivery_fee));
  res.json({
    ok: true,
    commission_pct: await db.getSetting('commission_pct'),
    min_delivery_fee: await db.getSetting('min_delivery_fee'),
  });
});

// GET /api/admin/waiting — entregadores esperando
router.get('/waiting', async (req, res) => {
  const naLoja = await db.query(`SELECT o.id, o.status, o.arrived_at, s.name AS store_name, d.name AS delivery_name, d.phone AS delivery_phone,
      EXTRACT(EPOCH FROM (NOW() - o.arrived_at))/60::int AS minutos_espera
      FROM orders o JOIN stores s ON s.id=o.store_id JOIN users d ON d.id=o.delivery_person_id
      WHERE o.arrived_at IS NOT NULL AND o.status='pronto'`);
  const noCliente = await db.query(`SELECT o.id, o.status, o.customer_arrived_at, o.delivery_address, c.name AS customer_name, c.phone AS customer_phone,
      d.name AS delivery_name,
      EXTRACT(EPOCH FROM (NOW() - o.customer_arrived_at))/60::int AS minutos_espera
      FROM orders o JOIN users c ON c.id=o.customer_id JOIN users d ON d.id=o.delivery_person_id
      WHERE o.customer_arrived_at IS NOT NULL AND o.status='a_caminho' AND o.customer_responded=0`);
  res.json({ waiting_at_store: naLoja, waiting_at_customer: noCliente, total: naLoja.length + noCliente.length });
});

module.exports = router;
