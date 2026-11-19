// routes/stores.js — Lojas/restaurantes + produtos (PostgreSQL)
const express = require('express');
const db = require('../db');
const { authRequired, roleRequired } = require('../middleware');

const router = express.Router();

// GET /api/stores — Catálogo público (só aprovadas)
router.get('/', async (req, res) => {
  const { city, q } = req.query;
  let sql = `SELECT s.*, u.name AS owner_name FROM stores s JOIN users u ON u.id = s.owner_id
             WHERE s.is_approved = 1`;
  const params = [];
  let idx = 1;
  if (city) { sql += ` AND lower(s.city) = lower($${idx++})`; params.push(city); }
  if (q) { sql += ` AND (s.name LIKE $${idx} OR s.category LIKE $${idx + 1})`; params.push(`%${q}%`, `%${q}%`); idx += 2; }
  sql += ' ORDER BY s.is_open DESC, s.name';
  res.json({ stores: await db.query(sql, params) });
});

// GET /api/stores/:id — Detalhe + produtos
router.get('/:id', async (req, res) => {
  const store = await db.get(`SELECT s.*, u.name AS owner_name FROM stores s JOIN users u ON u.id = s.owner_id WHERE s.id = $1`, [req.params.id]);
  if (!store) return res.status(404).json({ error: 'Loja não encontrada.' });
  store.products = await db.query('SELECT * FROM products WHERE store_id = $1 ORDER BY category, name', [req.params.id]);
  res.json({ store });
});

// GET /api/stores/mine/store
router.get('/mine/store', authRequired, roleRequired('loja'), async (req, res) => {
  const store = await db.get('SELECT * FROM stores WHERE owner_id = $1', [req.user.id]);
  if (!store) return res.json({ store: null });
  store.products = await db.query('SELECT * FROM products WHERE store_id = $1 ORDER BY category, name', [store.id]);
  res.json({ store });
});

// POST /api/stores/mine — Criar/atualizar loja própria
router.post('/mine', authRequired, roleRequired('loja'), async (req, res) => {
  const { name, description, category, address, city, delivery_fee, delivery_time, is_open, lat, lng, image } = req.body;
  if (!name) return res.status(400).json({ error: 'O nome da loja é obrigatório.' });
  const minFee = parseFloat(await db.getSetting('min_delivery_fee', '8'));
  const fee = Math.max(minFee, parseFloat(delivery_fee) || minFee);
  if ((parseFloat(delivery_fee) || 0) > 0 && parseFloat(delivery_fee) < minFee) {
    return res.status(400).json({ error: `A taxa de entrega mínima da plataforma é R$ ${minFee.toFixed(2).replace('.', ',')}.` });
  }
  const latVal = lat != null && lat !== '' ? parseFloat(lat) : null;
  const lngVal = lng != null && lng !== '' ? parseFloat(lng) : null;
  const existing = await db.get('SELECT id, image FROM stores WHERE owner_id = $1', [req.user.id]);
  if (existing) {
    await db.run(`UPDATE stores SET name=$1, description=$2, category=$3, address=$4, city=$5, delivery_fee=$6, delivery_time=$7, is_open=$8, lat=$9, lng=$10, image=$11
                WHERE id=$12`,
      [name, description || '', category || '', address || '', city || '', fee, delivery_time || '', is_open ? 1 : 0, latVal, lngVal, image ?? existing.image, existing.id]);
    return res.json({ store: await db.get('SELECT * FROM stores WHERE id = $1', [existing.id]) });
  }
  const inserted = await db.run(`INSERT INTO stores (owner_id,name,description,category,address,city,delivery_fee,delivery_time,is_open,is_approved,lat,lng,image)
                           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,$10,$11,$12) RETURNING id`,
    [req.user.id, name, description || '', category || '', address || '', city || '', fee, delivery_time || '', is_open ? 1 : 0, latVal, lngVal, image || null]);
  res.status(201).json({ store: await db.get('SELECT * FROM stores WHERE id = $1', [inserted.rows[0].id]),
    message: 'Loja criada. Fica pendente de aprovação do administrador.' });
});

// POST /api/stores/mine/products — Criar produto
router.post('/mine/products', authRequired, roleRequired('loja'), async (req, res) => {
  const store = await db.get('SELECT * FROM stores WHERE owner_id = $1', [req.user.id]);
  if (!store) return res.status(400).json({ error: 'Primeiro crie sua loja.' });
  const { name, description, price, category, available, image } = req.body;
  if (!name || price == null) return res.status(400).json({ error: 'Nome e preço são obrigatórios.' });
  const inserted = await db.run(`INSERT INTO products (store_id,name,description,price,category,available,image)
                           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [store.id, name, description || '', Number(price), category || '', available === false ? 0 : 1, image || null]);
  res.status(201).json({ product: await db.get('SELECT * FROM products WHERE id = $1', [inserted.rows[0].id]) });
});

// PUT /api/stores/mine/products/:id
router.put('/mine/products/:id', authRequired, roleRequired('loja'), async (req, res) => {
  const store = await db.get('SELECT * FROM stores WHERE owner_id = $1', [req.user.id]);
  if (!store) return res.status(400).json({ error: 'Você não tem loja.' });
  const prod = await db.get('SELECT * FROM products WHERE id = $1 AND store_id = $2', [req.params.id, store.id]);
  if (!prod) return res.status(404).json({ error: 'Produto não encontrado.' });
  const { name, description, price, category, available, image } = req.body;
  await db.run(`UPDATE products SET name=$1, description=$2, price=$3, category=$4, available=$5, image=$6 WHERE id=$7`,
    [name ?? prod.name, description ?? prod.description, price != null ? Number(price) : prod.price,
      category ?? prod.category, available === undefined ? prod.available : (available ? 1 : 0), image ?? prod.image, prod.id]);
  res.json({ product: await db.get('SELECT * FROM products WHERE id = $1', [prod.id]) });
});

// DELETE /api/stores/mine/products/:id
router.delete('/mine/products/:id', authRequired, roleRequired('loja'), async (req, res) => {
  const store = await db.get('SELECT * FROM stores WHERE owner_id = $1', [req.user.id]);
  if (!store) return res.status(400).json({ error: 'Você não tem loja.' });
  await db.run('DELETE FROM products WHERE id = $1 AND store_id = $2', [req.params.id, store.id]);
  res.json({ ok: true });
});

module.exports = router;
