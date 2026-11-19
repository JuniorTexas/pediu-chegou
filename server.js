// server.js — Punto de entrada: Express + API + frontend estático (PostgreSQL)
require('dotenv').config(); // carga variables del archivo .env
const express = require('express');
const path = require('path');
const db = require('./db');

const app = express();
app.use(express.json({ limit: '1mb' }));

// API
app.use('/api/auth', require('./routes/auth'));
app.use('/api/stores', require('./routes/stores'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api', require('./routes/extras')); // /ratings, /feedback, /advances, /messages

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString(), db: 'postgresql' }));

// Frontend estático (SPA)
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Manejador de errores
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Erro interno do servidor.' });
});

const PORT = process.env.PORT || 3000;
const SEED_DEMO = process.env.SEED_DEMO === '1' || process.env.SEED_DEMO === 'true';
const PROD = process.env.NODE_ENV === 'production';

// Inicializa o banco (esquema + seed + admin) antes de aceitar conexões
db.init()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`\n🚀 Pediu Chegou (PostgreSQL) rodando em http://localhost:${PORT}`);
      if (PROD) console.log('   🔒 Modo produção (NODE_ENV=production): o código de e-mail NÃO é devolvido pela API.');
      if (SEED_DEMO) {
        console.log('   🧪 Modo demonstração (SEED_DEMO=1) — contas de teste (banco vazio):');
        console.log('   Admin:      admin@entregapp.com / admin123');
        console.log('   Loja:       loja@exemplo.com    / loja123');
        console.log('   Entregador: motoboy@exemplo.com / moto123');
        console.log('   Cliente:    cliente@exemplo.com / cli123');
      } else {
        console.log(`   ℹ️  Sem contas de teste. Admin: ${process.env.ADMIN_EMAIL || 'admin@pediuchegou.com'} (senha via ADMIN_PASSWORD ou gerada no 1º acesso, impressa no console).`);
        console.log('      Para reativar contas demo: SEED_DEMO=1 npm start (com o banco PostgreSQL vazio).');
      }
      console.log('');
    });
  })
  .catch((err) => {
    console.error('❌ Falha ao conectar/inicializar o PostgreSQL:', err.message);
    console.error('   Verifique DATABASE_URL (ou PG*). Para subir um Postgres local rápido: docker compose up -d db');
    process.exit(1);
  });
