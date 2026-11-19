// routes/orders.js — Pedidos: fluxo completo (PostgreSQL)
const express = require('express');
const db = require('../db');
const { authRequired, roleRequired, entregadorRequired } = require('../middleware');

const router = express.Router();
const PAGAMENTOS_VALIDOS = ['pix', 'dinheiro'];

async function orderWithItems(id) {
  const order = await db.get(`SELECT o.*, s.name AS store_name, s.address AS store_address, s.lat AS store_lat, s.lng AS store_lng,
      c.name AS customer_name, c.phone AS customer_phone, c.delivery_code AS customer_delivery_code,
      d.name AS delivery_name, d.phone AS delivery_phone, d.photo AS delivery_photo, d.social_name AS delivery_social_name
    FROM orders o
    JOIN stores s ON s.id = o.store_id
    JOIN users c ON c.id = o.customer_id
    LEFT JOIN users d ON d.id = o.delivery_person_id
    WHERE o.id = $1`, [id]);
  if (!order) return null;
  order.items = await db.query('SELECT * FROM order_items WHERE order_id = $1', [id]);
  return order;
}

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371, dLat = (lat2 - lat1) * Math.PI / 180, dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
router._haversine = haversine;

function genCode() { return String(Math.floor(100000 + Math.random() * 900000)); }

// POST /api/orders — Cliente cria um pedido
router.post('/', authRequired, roleRequired('cliente'), async (req, res) => {
  const { store_id, items, delivery_address, payment_method, notes, tip } = req.body;
  if (!store_id || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Loja e ao menos um produto são obrigatórios.' });
  }
  let tipVal = 0;
  if (tip != null && tip !== '') {
    tipVal = Number(tip);
    if (!Number.isInteger(tipVal) || tipVal < 0) return res.status(400).json({ error: 'A gorjeta deve ser um número inteiro (ex: 5, 10, 20).' });
  }
  const pm = String(payment_method || 'Pix').trim().toLowerCase();
  if (!PAGAMENTOS_VALIDOS.includes(pm)) {
    return res.status(400).json({ error: 'Forma de pagamento inválida. Aceitamos apenas Pix e Dinheiro.' });
  }
  const store = await db.get('SELECT * FROM stores WHERE id = $1 AND is_approved = 1', [store_id]);
  if (!store) return res.status(404).json({ error: 'Loja não encontrada.' });
  if (!store.is_open) return res.status(400).json({ error: 'Loja fechada no momento.' });

  const addr = delivery_address || (await db.get('SELECT address FROM users WHERE id = $1', [req.user.id])).address;
  if (!addr) return res.status(400).json({ error: 'Endereço de entrega obrigatório.' });

  let subtotal = 0;
  const resolved = [];
  for (const it of items) {
    const prod = await db.get('SELECT * FROM products WHERE id = $1 AND store_id = $2 AND available = 1', [it.product_id, store_id]);
    if (!prod) return res.status(400).json({ error: `Produto não disponível: ${it.product_id}` });
    const qty = Math.max(1, parseInt(it.quantity) || 1);
    subtotal += prod.price * qty;
    resolved.push({ product_id: prod.id, product_name: prod.name, quantity: qty, unit_price: prod.price });
  }
  const total = subtotal + store.delivery_fee + tipVal;
  const pmFinal = pm === 'pix' ? 'Pix' : 'Dinheiro';

  const orderId = await db.withTransaction(async (client) => {
    const ins = await client.query(`INSERT INTO orders (customer_id,store_id,subtotal,delivery_fee,total,tip,delivery_address,payment_method,notes,status)
                                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pendente') RETURNING id`,
      [req.user.id, store_id, subtotal, store.delivery_fee, total, tipVal, addr, pmFinal, notes || '']);
    const oid = ins.rows[0].id;
    for (const it of resolved) {
      await client.query('INSERT INTO order_items (order_id,product_id,product_name,quantity,unit_price) VALUES ($1,$2,$3,$4,$5)',
        [oid, it.product_id, it.product_name, it.quantity, it.unit_price]);
    }
    return oid;
  });

  res.status(201).json({ order: await orderWithItems(orderId), message: 'Pedido realizado! A loja receberá sua solicitação agora.' });
});

// GET /api/orders — Lista según rol
router.get('/', authRequired, async (req, res) => {
  let rows;
  if (req.user.role === 'cliente') {
    rows = await db.query('SELECT * FROM orders WHERE customer_id = $1 ORDER BY created_at DESC', [req.user.id]);
  } else if (req.user.role === 'loja') {
    const store = await db.get('SELECT id FROM stores WHERE owner_id = $1', [req.user.id]);
    rows = store ? await db.query('SELECT * FROM orders WHERE store_id = $1 ORDER BY created_at DESC', [store.id]) : [];
  } else if (req.user.role === 'entregador') {
    rows = await db.query('SELECT * FROM orders WHERE delivery_person_id = $1 ORDER BY created_at DESC', [req.user.id]);
  } else {
    rows = await db.query('SELECT * FROM orders ORDER BY created_at DESC LIMIT 200');
  }
  const enriched = [];
  for (const o of rows) {
    const s = await db.get('SELECT name FROM stores WHERE id = $1', [o.store_id]);
    const c = await db.get('SELECT name FROM users WHERE id = $1', [o.customer_id]);
    enriched.push({ ...o, store_name: s?.name, customer_name: c?.name });
  }
  res.json({ orders: enriched });
});

// GET /api/orders/available — entregador: pedidos aceitos pela loja, sem entregador, por proximidade
router.get('/available', entregadorRequired, async (req, res) => {
  const me = await db.get('SELECT status, lat, lng FROM users WHERE id = $1', [req.user.id]);
  if (me.status !== 'ativo') return res.status(403).json({ error: 'Sua conta ainda não foi aprovada pelo administrador.' });
  const orders = await db.query(`SELECT o.*, s.name AS store_name, s.address AS store_address, s.lat AS store_lat, s.lng AS store_lng,
                             c.name AS customer_name
                             FROM orders o JOIN stores s ON s.id=o.store_id JOIN users c ON c.id=o.customer_id
                             WHERE o.status IN ('confirmado','preparando','pronto') AND o.delivery_person_id IS NULL
                             ORDER BY o.created_at`);
  if (me.lat != null && me.lng != null) {
    orders.forEach(o => {
      o.distancia_km = (o.store_lat != null && o.store_lng != null)
        ? haversine(me.lat, me.lng, o.store_lat, o.store_lng)
        : null;
    });
    orders.sort((a, b) => (a.distancia_km ?? 9999) - (b.distancia_km ?? 9999));
  }
  res.json({ orders, minha_localizacao: me.lat != null });
});

// GET /api/orders/:id
router.get('/:id', authRequired, async (req, res) => {
  const order = await orderWithItems(req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
  const role = req.user.role;
  const isCustomer = order.customer_id === req.user.id;
  if (!(role === 'admin' || isCustomer)) {
    delete order.customer_delivery_code;
  }
  res.json({ order });
});

// PATCH /api/orders/:id/aceitar — Entregador se candidata
router.patch('/:id/aceitar', entregadorRequired, async (req, res) => {
  const me = await db.get('SELECT status FROM users WHERE id = $1', [req.user.id]);
  if (me.status !== 'ativo') return res.status(403).json({ error: 'Conta não aprovada.' });
  const order = await db.get('SELECT * FROM orders WHERE id = $1', [req.params.id]);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
  if (!['confirmado', 'preparando', 'pronto'].includes(order.status))
    return res.status(400).json({ error: 'Este pedido ainda não foi aceito pela loja.' });
  if (order.delivery_person_id) {
    if (order.delivery_person_id === req.user.id) return res.json({ order: await orderWithItems(order.id), message: 'Você já aceitou este pedido.' });
    return res.status(409).json({ error: 'Outro entregador já aceitou este pedido.' });
  }
  const coletaCode = genCode();
  await db.run('UPDATE orders SET delivery_person_id = $1, coleta_code = $2, updated_at = NOW() WHERE id = $3',
    [req.user.id, coletaCode, order.id]);
  res.json({ order: await orderWithItems(order.id), coleta_code: coletaCode,
    message: 'Pedido aceito! Vá até a loja. Use o GPS e mostre o número do pedido e o código de coleta.' });
});

// PATCH /api/orders/:id/cheguei — Entregador marca "Cheguei na loja" (≤100m)
router.patch('/:id/cheguei', entregadorRequired, async (req, res) => {
  const { lat, lng } = req.body;
  const me = await db.get('SELECT status FROM users WHERE id = $1', [req.user.id]);
  if (me.status !== 'ativo') return res.status(403).json({ error: 'Conta não aprovada.' });
  const order = await db.get('SELECT * FROM orders WHERE id = $1', [req.params.id]);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
  if (order.delivery_person_id !== req.user.id) return res.status(403).json({ error: 'Este pedido não é seu.' });
  if (order.coletado_at) return res.status(400).json({ error: 'Pedido já coletado.' });

  const store = await db.get('SELECT * FROM stores WHERE id = $1', [order.store_id]);
  if (store.lat != null && store.lng != null && lat != null && lng != null) {
    const dist = haversine(parseFloat(lat), parseFloat(lng), store.lat, store.lng);
    if (dist > 0.1) return res.status(400).json({ error: `Você está a ${(dist * 1000).toFixed(0)} m da loja. O botão "Cheguei na loja" só aparece a até 100 m.` });
  }

  await db.run('UPDATE orders SET arrived_at=NOW(), updated_at=NOW() WHERE id=$1', [order.id]);
  res.json({ ok: true, arrived_at: new Date().toISOString(), order_number: order.id, coleta_code: order.coleta_code,
    message: 'Chegada registrada! Informe à loja o Nº do pedido e, quando o pedido estiver pronto, toque em "Coletar pedido".' });
});

// PATCH /api/orders/:id/coletar — Entregador confirma a coleta (IRREVERSÍVEL)
router.patch('/:id/coletar', entregadorRequired, async (req, res) => {
  const order = await db.get('SELECT * FROM orders WHERE id = $1', [req.params.id]);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
  if (order.delivery_person_id !== req.user.id) return res.status(403).json({ error: 'Este pedido não é seu.' });
  if (order.coletado_at) return res.status(400).json({ error: 'Pedido já coletado.' });
  if (order.status !== 'pronto') return res.status(400).json({ error: 'A loja ainda não marcou o pedido como pronto.' });

  await db.run("UPDATE orders SET status='a_caminho', coletado_at=NOW(), updated_at=NOW() WHERE id=$1", [order.id]);
  res.json({ order: await orderWithItems(order.id), order_number: order.id, coleta_code: order.coleta_code,
    message: 'Pedido coletado! A responsabilidade agora é sua. Siga até o cliente.' });
});

// PATCH /api/orders/:id/finalizar — Entregador digita o código do cliente e finaliza
router.patch('/:id/finalizar', authRequired, async (req, res) => {
  const { delivery_code, customer_code } = req.body;
  const code = delivery_code || customer_code;
  const order = await db.get('SELECT * FROM orders WHERE id = $1', [req.params.id]);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
  if (req.user.role === 'entregador' && !req.user.face_verified) {
    return res.status(403).json({ error: 'Verificação facial pendente. Saia e entre novamente para validar seu rosto.', face_verification_required: true });
  }
  const isAdmin = req.user.role === 'admin';
  if (!isAdmin && order.delivery_person_id !== req.user.id) return res.status(403).json({ error: 'Não autorizado.' });
  if (order.status !== 'a_caminho') return res.status(400).json({ error: 'O pedido ainda não está a caminho.' });

  const client = await db.get('SELECT delivery_code FROM users WHERE id = $1', [order.customer_id]);
  const codeSet = client && client.delivery_code && String(client.delivery_code).trim();
  if (codeSet && !isAdmin) {
    if (!code || String(code).trim() !== codeSet) {
      return res.status(400).json({ error: 'Código do cliente incorreto. Peça ao cliente o código cadastrado no perfil dele.' });
    }
  }

  const fin = await settleOrder(order, order.delivery_person_id);
  await db.run("UPDATE orders SET status='entregue', updated_at=NOW() WHERE id=$1", [order.id]);
  return res.json({ order: await orderWithItems(order.id), finance: fin,
    message: fin.isCash ? 'Entregue! Lembre-se de repassar o valor em dinheiro à plataforma.' : 'Entregue! Seu ganho foi creditado.' });
});

// PATCH /api/orders/:id/cheguei-cliente
router.patch('/:id/cheguei-cliente', entregadorRequired, async (req, res) => {
  const order = await db.get('SELECT * FROM orders WHERE id = $1', [req.params.id]);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
  if (order.delivery_person_id !== req.user.id) return res.status(403).json({ error: 'Não é o entregador designado.' });
  if (order.status !== 'a_caminho') return res.status(400).json({ error: 'O pedido não está a caminho.' });
  await db.run('UPDATE orders SET customer_arrived_at=NOW(), updated_at=NOW() WHERE id=$1', [order.id]);
  res.json({ ok: true, customer_arrived_at: new Date().toISOString(),
    message: 'Chegada ao cliente registrada. Peça o código pessoal dele para finalizar.' });
});

// PATCH /api/orders/:id/cliente-respondeu
router.patch('/:id/cliente-respondeu', authRequired, async (req, res) => {
  const order = await db.get('SELECT * FROM orders WHERE id = $1', [req.params.id]);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
  if (![order.customer_id, order.delivery_person_id].includes(req.user.id) && req.user.role !== 'admin')
    return res.status(403).json({ error: 'Não autorizado.' });
  await db.run('UPDATE orders SET customer_responded=1, updated_at=NOW() WHERE id=$1', [order.id]);
  res.json({ ok: true, message: 'Resposta do cliente registrada.' });
});

// ---------- Liquidação financeira ao entregar ----------
async function settleOrder(order, deliveryUserId) {
  const pct = parseFloat(await db.getSetting('commission_pct', '15'));
  const commission = +(order.subtotal * pct / 100).toFixed(2);
  const lojaReceivable = +(order.subtotal - commission).toFixed(2);
  const isCash = !order.payment_method || /dinheiro|cash|espécie|especie/i.test(order.payment_method);
  const store = await db.get('SELECT owner_id FROM stores WHERE id = $1', [order.store_id]);
  const admin = await db.get("SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1");

  await db.withTransaction(async (client) => {
    if (admin) await client.query(`INSERT INTO transactions (user_id,type,amount,description,order_id) VALUES ($1,'credito',$2,$3,$4)`,
      [admin.id, commission, `Comissão da plataforma (${pct}%) - pedido #${order.id}`, order.id]);
    await client.query(`INSERT INTO transactions (user_id,type,amount,description,order_id) VALUES ($1,'credito',$2,$3,$4)`,
      [deliveryUserId, order.delivery_fee, `Taxa de entrega - pedido #${order.id}`, order.id]);
    await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [order.delivery_fee, deliveryUserId]);
    if (order.tip > 0) {
      await client.query(`INSERT INTO transactions (user_id,type,amount,description,order_id) VALUES ($1,'credito',$2,$3,$4)`,
        [deliveryUserId, order.tip, `Gorjeta do cliente - pedido #${order.id}`, order.id]);
      await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [order.tip, deliveryUserId]);
    }
    if (isCash) {
      await client.query(`INSERT INTO transactions (user_id,type,amount,description,order_id) VALUES ($1,'debito',$2,$3,$4)`,
        [deliveryUserId, order.subtotal, `Valor recebido em dinheiro - pedido #${order.id} (repassar à plataforma)`, order.id]);
      await client.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [order.subtotal, deliveryUserId]);
      await client.query(`INSERT INTO transactions (user_id,type,amount,description,order_id) VALUES ($1,'credito',$2,$3,$4)`,
        [store.owner_id, lojaReceivable, `Venda líquida - pedido #${order.id}`, order.id]);
      await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [lojaReceivable, store.owner_id]);
    } else {
      await client.query(`INSERT INTO transactions (user_id,type,amount,description,order_id) VALUES ($1,'credito',$2,$3,$4)`,
        [store.owner_id, lojaReceivable, `Venda líquida - pedido #${order.id}`, order.id]);
      await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [lojaReceivable, store.owner_id]);
    }
    await client.query(`UPDATE orders SET ready_actual_at = COALESCE(ready_actual_at, ready_claimed_at, NOW()),
                updated_at = NOW() WHERE id = $1`, [order.id]);
  });

  return { commission, lojaReceivable, isCash };
}

// PATCH /api/orders/:id/status — loja: aceitar/preparar/pronto/recusar; admin: tudo
router.patch('/:id/status', authRequired, async (req, res) => {
  const { status } = req.body;
  const order = await db.get('SELECT * FROM orders WHERE id = $1', [req.params.id]);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });

  const role = req.user.role;
  const VALID = {
    loja: ['confirmado', 'preparando', 'pronto', 'cancelado'],
    cliente: ['cancelado'],
    admin: ['confirmado', 'preparando', 'pronto', 'a_caminho', 'entregue', 'cancelado'],
  };
  if (!VALID[role] || !VALID[role].includes(status)) {
    return res.status(403).json({ error: `Seu perfil (${role}) não pode mudar o status para "${status}".` });
  }

  if (role === 'loja') {
    const store = await db.get('SELECT id FROM stores WHERE owner_id = $1', [req.user.id]);
    if (!store || store.id !== order.store_id) return res.status(403).json({ error: 'Este pedido não é da sua loja.' });
    if (status === 'pronto') {
      await db.run("UPDATE orders SET status='pronto', ready_claimed_at=NOW(), updated_at=NOW() WHERE id=$1", [order.id]);
      return res.json({ order: await orderWithItems(order.id), message: 'Pedido marcado como pronto. O entregador poderá coletar.' });
    }
    if (status === 'preparando' && order.status === 'pronto') {
      await db.run("UPDATE orders SET status='preparando', ready_claimed_at=NULL, updated_at=NOW() WHERE id=$1", [order.id]);
      return res.json({ order: await orderWithItems(order.id), message: 'Status corrigido para "preparando".' });
    }
    if (order.status !== 'pendente' && status === 'confirmado') return res.status(400).json({ error: 'Só é possível aceitar um pedido pendente.' });
  }
  if (role === 'cliente' && order.status !== 'pendente') {
    return res.status(400).json({ error: 'Só é possível cancelar pedidos pendentes de confirmação da loja.' });
  }

  await db.run('UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2', [status, order.id]);
  res.json({ order: await orderWithItems(order.id), message: 'Status atualizado.' });
});

module.exports = router;
