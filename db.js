// db.js — PostgreSQL (pool de conexões) + esquema + seed (versão escalável)
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

// Conexão via DATABASE_URL (ex: postgres://usuario:senha@host:5432/banco)
// ou variáveis PG* separadas. Em produção (Render/Heroku/etc.) costuma vir DATABASE_URL com SSL.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/pediuchegou',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: (process.env.PGSSL === '1' || (process.env.DATABASE_URL || '').includes('sslmode=require'))
    ? { rejectUnauthorized: false }
    : undefined,
});

// ---------- Helpers estilo "finais" (mantêm o código das rotas parecido com o original) ----------
async function query(sql, params = []) {
  return (await pool.query(sql, params)).rows;
}
async function get(sql, params = []) {
  return (await pool.query(sql, params)).rows[0];
}
async function run(sql, params = []) {
  return pool.query(sql, params); // { rows, rowCount }
}
// Transação: fn(client) — dentro dela use client.query(...)
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw e;
  } finally {
    client.release();
  }
}

const db = { pool, query, get, run, withTransaction };

// ---------- Esquema ----------
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('cliente','loja','admin','entregador')),
  address TEXT,
  city TEXT,
  vehicle TEXT,
  plate TEXT,
  status TEXT NOT NULL DEFAULT 'ativo' CHECK(status IN ('ativo','pendente','bloqueado')),
  balance REAL NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  pix_key TEXT,
  cpf TEXT,
  surname TEXT,
  social_name TEXT,
  birth_date TEXT,
  photo TEXT,
  vehicle_type TEXT,
  bike_number TEXT,
  bike_color TEXT,
  bike_wheel_size TEXT,
  bike_electric INTEGER DEFAULT 0,
  cnh_front TEXT,
  cnh_back TEXT,
  moto_doc TEXT,
  renavam TEXT,
  moto_brand TEXT,
  moto_model TEXT,
  moto_color TEXT,
  moto_cyl TEXT,
  email_verified INTEGER DEFAULT 0,
  email_code TEXT,
  terms_accepted INTEGER DEFAULT 0,
  delivery_code TEXT,
  lat REAL,
  lng REAL,
  face_verified_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS stores (
  id SERIAL PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  address TEXT,
  city TEXT,
  delivery_fee REAL NOT NULL DEFAULT 0,
  delivery_time TEXT,
  image TEXT,
  is_open INTEGER NOT NULL DEFAULT 1,
  is_approved INTEGER NOT NULL DEFAULT 1,
  lat REAL,
  lng REAL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  price REAL NOT NULL,
  category TEXT,
  image TEXT,
  available INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES users(id),
  store_id INTEGER NOT NULL REFERENCES stores(id),
  delivery_person_id INTEGER REFERENCES users(id),
  subtotal REAL NOT NULL,
  delivery_fee REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente'
    CHECK(status IN ('pendente','confirmado','preparando','pronto','a_caminho','entregue','cancelado')),
  delivery_address TEXT NOT NULL,
  payment_method TEXT,
  notes TEXT,
  tip REAL DEFAULT 0,
  rated_store INTEGER DEFAULT 0,
  rated_delivery INTEGER DEFAULT 0,
  arrived_at TIMESTAMPTZ,
  customer_arrived_at TIMESTAMPTZ,
  customer_responded INTEGER DEFAULT 0,
  coleta_code TEXT,
  coletado_at TIMESTAMPTZ,
  ready_claimed_at TIMESTAMPTZ,
  ready_actual_at TIMESTAMPTZ,
  false_reported INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id),
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS reports (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  delivery_person_id INTEGER NOT NULL REFERENCES users(id),
  store_id INTEGER NOT NULL REFERENCES stores(id),
  reason TEXT NOT NULL,
  photo TEXT,
  status TEXT NOT NULL DEFAULT 'aberto' CHECK(status IN ('aberto','resolvido')),
  resolution TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS warnings (
  id SERIAL PRIMARY KEY,
  store_id INTEGER NOT NULL REFERENCES stores(id),
  report_id INTEGER REFERENCES reports(id),
  message TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transactions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK(type IN ('credito','debito')),
  amount REAL NOT NULL,
  description TEXT NOT NULL,
  order_id INTEGER REFERENCES orders(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ratings (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  rater_user_id INTEGER NOT NULL REFERENCES users(id),
  target_type TEXT NOT NULL CHECK(target_type IN ('store','user')),
  target_id INTEGER NOT NULL,
  stars INTEGER NOT NULL CHECK(stars BETWEEN 1 AND 5),
  comment TEXT,
  tags TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS feedback (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  name TEXT,
  message TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS advances (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  amount REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente' CHECK(status IN ('pendente','aprovado','rejeitado')),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  sender_id INTEGER NOT NULL REFERENCES users(id),
  recipient_id INTEGER,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS face_verifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  captured_photo TEXT,
  match_score REAL,
  result TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_store ON orders(store_id);
CREATE INDEX IF NOT EXISTS idx_orders_delivery ON orders(delivery_person_id);
CREATE INDEX IF NOT EXISTS idx_products_store ON products(store_id);
CREATE INDEX IF NOT EXISTS idx_reports_store ON reports(store_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_ratings_target ON ratings(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_advances_user ON advances(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_order ON messages(order_id);
CREATE INDEX IF NOT EXISTS idx_face_verify_user ON face_verifications(user_id);
`;

async function getSetting(key, def) {
  const row = await get('SELECT value FROM settings WHERE key = $1', [key]);
  return row ? row.value : def;
}
async function setSetting(k, v) {
  await run(`INSERT INTO settings (key,value) VALUES ($1,$2)
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [k, String(v)]);
}
db.getSetting = getSetting;
db.setSetting = setSetting;

// ---------- Inicialização: cria esquema + dados demo + admin ----------
async function init() {
  await pool.query(SCHEMA);

  // Configurações padrão
  try { await setSetting('commission_pct', '15'); } catch (e) {}
  try { await setSetting('min_delivery_fee', '8'); } catch (e) {}

  const SEED_DEMO = process.env.SEED_DEMO === '1' || process.env.SEED_DEMO === 'true';
  const userCount = (await get('SELECT COUNT(*)::int AS c FROM users')).c;

  if (userCount === 0 && SEED_DEMO) {
    const hash = (pw) => bcrypt.hashSync(pw, 10);
    const insUser = `INSERT INTO users (name,email,phone,password_hash,role,address,city,vehicle,plate,status,email_verified,terms_accepted)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,1) RETURNING id`;
    const insStore = `INSERT INTO stores (owner_id,name,description,category,address,city,delivery_fee,delivery_time,is_open,is_approved)
                      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1,1) RETURNING id`;
    const insProd = `INSERT INTO products (store_id,name,description,price,category,available) VALUES ($1,$2,$3,$4,$5,1)`;

    const admin = (await run(insUser, ['Administrador','admin@entregapp.com','11999990000',hash('admin123'),'admin','','São Paulo','','','ativo'])).rows[0];
    const loja = (await run(insUser, ['José da Pizzaria','loja@exemplo.com','11988881111',hash('loja123'),'loja','Rua das Flores, 100','São Paulo','','','ativo'])).rows[0];
    const loja2 = (await run(insUser, ['Maria do Açaí','acai@exemplo.com','11977772222',hash('loja123'),'loja','Av. Paulista, 500','São Paulo','','','ativo'])).rows[0];
    const entregador = (await run(insUser, ['Carlos Entregador','motoboy@exemplo.com','11966663333',hash('moto123'),'entregador','Rua A, 50','São Paulo','Moto','ABC1D23','ativo'])).rows[0];
    const entregador2 = (await run(insUser, ['Ana Entregadora','ana@exemplo.com','11955554444',hash('moto123'),'entregador','Rua B, 80','São Paulo','Bicicleta','','pendente'])).rows[0];
    const cliente = (await run(insUser, ['João Cliente','cliente@exemplo.com','11944445555',hash('cli123'),'cliente','Rua dos Clientes, 200, Apto 30','São Paulo','','','ativo'])).rows[0];

    const s1 = (await run(insStore, [loja.id,'Pizzaria do Zé','Pizzas artesanais feitas no forno a lenha.','Pizza','Rua das Flores, 100','São Paulo',8.99,'30-45 min'])).rows[0];
    const s2 = (await run(insStore, [loja2.id,'Açaí da Maria','Açaí cremoso com mais de 30 complementos.','Saudável','Av. Paulista, 500','São Paulo',8.00,'20-30 min'])).rows[0];

    await run(insProd, [s1.id,'Pizza Margherita','Molho, mussarela, manjericão fresco.',39.90,'Pizzas']);
    await run(insProd, [s1.id,'Pizza Calabresa','Calabresa, cebola, mussarela.',42.90,'Pizzas']);
    await run(insProd, [s1.id,'Refrigerante 2L','Coca-Cola ou Guaraná.',12.00,'Bebidas']);
    await run(insProd, [s2.id,'Açaí 500ml','Açaí com granola e banana.',18.90,'Açaí']);
    await run(insProd, [s2.id,'Açaí 750ml','Açaí com morango e leite condensado.',24.90,'Açaí']);

    await run("UPDATE users SET delivery_code = '1234' WHERE email = 'cliente@exemplo.com'");
    console.log('✅ Dados de demonstração carregados (SEED_DEMO=1).');
  }

  await ensureAdmin();
}

// Garante pelo menos um administrador.
async function ensureAdmin() {
  const exists = (await get("SELECT COUNT(*)::int AS c FROM users WHERE role = 'admin'")).c;
  if (exists > 0) return;
  const crypto = require('crypto');
  const email = (process.env.ADMIN_EMAIL || 'admin@pediuchegou.com').toLowerCase().trim();
  let password = process.env.ADMIN_PASSWORD;
  let generated = false;
  if (!password) { password = crypto.randomBytes(6).toString('hex'); generated = true; }
  await run(`INSERT INTO users (name,email,phone,password_hash,role,address,city,vehicle,plate,status,email_verified,terms_accepted)
             VALUES ($1,$2,$3,$4,'admin','','','','','ativo',1,1)`,
    ['Administrador', email, '', bcrypt.hashSync(password, 10)]);
  console.log('');
  console.log('👑 Administrador inicial criado:');
  console.log(`   E-mail: ${email}`);
  if (generated) console.log(`   Senha temporária (GERADA — troque assim que entrar): ${password}`);
  else console.log('   Senha: definida pela variável ADMIN_PASSWORD.');
  console.log('   Dica: defina ADMIN_EMAIL e ADMIN_PASSWORD no ambiente de produção.');
  console.log('');
}

db.init = init;
module.exports = db;
