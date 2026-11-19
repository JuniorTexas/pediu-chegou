// routes/auth.js — Registro, login, perfil y verificaciones (PostgreSQL)
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signToken, authRequired, faceVerifiedRequired } = require('../middleware');

const router = express.Router();
const PUBLIC_FIELDS = `id,name,surname,social_name,email,phone,role,address,city,vehicle,plate,
  vehicle_type,status,balance,pix_key,created_at,cpf,birth_date,photo,
  bike_number,bike_color,bike_wheel_size,bike_electric,
  renavam,moto_brand,moto_model,moto_color,moto_cyl,
  email_verified,terms_accepted,delivery_code,lat,lng`;

// ---------- Reglas de contraseña ----------
function validatePassword(pw, refs = {}) {
  if (!pw || pw.length < 8) return 'A senha deve ter no mínimo 8 caracteres.';
  const digits = (pw.match(/\d/g) || []).length;
  const upper = (pw.match(/[A-Z]/g) || []).length;
  const lower = (pw.match(/[a-z]/g) || []).length;
  if (digits < 2) return 'A senha deve conter pelo menos 2 números.';
  if (upper < 1) return 'A senha deve conter pelo menos 1 letra maiúscula.';
  if (lower < 5) return 'A senha deve conter pelo menos 5 letras minúsculas.';
  const norm = (s) => String(s || '').replace(/\D/g, '');
  const pwDigits = norm(pw);
  const proibidos = [norm(refs.cpf), norm(refs.birth_date), norm(refs.renavam)].filter((x) => x.length >= 4);
  for (const f of proibidos) {
    if (pwDigits === f || pw.includes(f)) {
      return 'A senha não pode ser seu CPF, data de nascimento ou número de RENAVAM. Tente outra (pode tentar na hora, sem penalidade).';
    }
  }
  return null;
}

function genEmailCode() { return String(Math.floor(100000 + Math.random() * 900000)); }
function genColetaCode() { return String(Math.floor(100000 + Math.random() * 900000)); }
router._genColetaCode = genColetaCode;

// POST /api/auth/register — cliente / loja (entregador usa /register-entregador)
router.post('/register', async (req, res) => {
  const { name, email, phone, password, role, address, city, vehicle, plate } = req.body;
  if (!name || !email || !password || !role) {
    return res.status(400).json({ error: 'Nome, e-mail e senha são obrigatórios.' });
  }
  if (!['cliente', 'loja'].includes(role)) {
    return res.status(400).json({ error: 'Use o cadastro próprio de entregador.' });
  }
  const cpfNorm = (req.body.cpf || '').replace(/\D/g, '') || null;
  const exists = await db.get('SELECT id FROM users WHERE lower(email) = $1 OR cpf = $2', [email.toLowerCase(), cpfNorm]);
  if (exists) return res.status(409).json({ error: 'Este e-mail ou CPF já está cadastrado.' });

  const pwErr = validatePassword(password, { cpf: req.body.cpf });
  if (pwErr) return res.status(400).json({ error: pwErr });
  if (!req.body.terms_accepted) return res.status(400).json({ error: 'Você deve aceitar os Termos e Condições de uso.' });

  const status = role === 'cliente' ? 'ativo' : 'pendente';
  const hash = bcrypt.hashSync(password, 10);
  const emailCode = genEmailCode();

  const inserted = await db.run(`INSERT INTO users (name,email,phone,password_hash,role,address,city,vehicle,plate,status,cpf,email_code,email_verified,terms_accepted)
                                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,0,1) RETURNING id`,
    [name.trim(), email.toLowerCase().trim(), phone || '', hash, role, address || '', city || '', vehicle || '', plate || '', status, cpfNorm, emailCode]);
  const userId = inserted.rows[0].id;

  const user = await db.get(`SELECT ${PUBLIC_FIELDS} FROM users WHERE id = $1`, [userId]);
  const token = signToken(user);
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) console.log(`📧 Código de verificação de e-mail (${email}): ${emailCode}`);
  res.status(201).json({
    token, user, ...(isProd ? {} : { dev_email_code: emailCode }),
    message: 'Cadastro recebido. Confirme seu e-mail com o código enviado.'
      + (status === 'pendente' ? ' Depois, um administrador aprovará sua conta.' : ''),
  });
});

// POST /api/auth/register-entregador — cadastro completo em etapas
router.post('/register-entregador', async (req, res) => {
  const {
    name, surname, social_name, cpf, birth_date, email, phone,
    password, vehicle_type,
    bike_number, bike_color, bike_wheel_size, bike_electric,
    photo, cnh_front, cnh_back, moto_doc, renavam, moto_brand, moto_model, moto_color, moto_cyl,
    terms_accepted,
  } = req.body;

  if (!name || !surname || !cpf || !birth_date || !email || !password) {
    return res.status(400).json({ error: 'Nome, sobrenome, CPF, data de nascimento, e-mail e senha são obrigatórios.' });
  }
  if (!photo) return res.status(400).json({ error: 'A foto do rosto é obrigatória (sem óculos, boné ou chapéu).' });
  const cpfNorm = String(cpf).replace(/\D/g, '');
  if (cpfNorm.length < 11) return res.status(400).json({ error: 'CPF inválido.' });

  const exists = await db.get('SELECT id FROM users WHERE lower(email) = $1 OR cpf = $2', [email.toLowerCase(), cpfNorm]);
  if (exists) return res.status(409).json({ error: 'Este e-mail ou CPF já está cadastrado.' });

  const pwErr = validatePassword(password, { cpf: cpfNorm, birth_date, renavam });
  if (pwErr) return res.status(400).json({ error: pwErr });

  if (!['bicicleta', 'moto'].includes(vehicle_type)) {
    return res.status(400).json({ error: 'Escolha bicicleta ou moto.' });
  }
  if (vehicle_type === 'bicicleta') {
    if (!bike_number || !bike_color || !['24', '26'].includes(String(bike_wheel_size))) {
      return res.status(400).json({ error: 'Informe número de identificação, cor e aro (24 ou 26) da bicicleta.' });
    }
  } else {
    if (!cnh_front || !cnh_back) return res.status(400).json({ error: 'Envie a foto da CNH dos dois lados (provisória vale).' });
    if (!moto_doc || !renavam) return res.status(400).json({ error: 'Envie o documento da moto e o número do RENAVAM.' });
    if (!moto_brand || !moto_model || !moto_color || !moto_cyl) {
      return res.status(400).json({ error: 'Informe marca, modelo, cor e cilindrada da moto (pré-preenchidos pelo RENAVAM).' });
    }
  }

  if (!terms_accepted) return res.status(400).json({ error: 'Você deve aceitar os termos e condições.' });

  const hash = bcrypt.hashSync(password, 10);
  const emailCode = genEmailCode();

  const inserted = await db.run(`INSERT INTO users
      (name,surname,social_name,cpf,birth_date,email,phone,password_hash,role,status,
       photo,vehicle_type,vehicle,plate,
       bike_number,bike_color,bike_wheel_size,bike_electric,
       cnh_front,cnh_back,moto_doc,renavam,moto_brand,moto_model,moto_color,moto_cyl,
       terms_accepted,email_code,email_verified)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'entregador','pendente',
       $9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,1,$25,0) RETURNING id`,
    [name.trim(), surname.trim(), (social_name || '').trim() || null, cpfNorm, birth_date,
      email.toLowerCase().trim(), phone || '', hash,
      photo, vehicle_type, vehicle_type === 'moto' ? 'Moto' : 'Bicicleta', '',
      bike_number || null, bike_color || null, bike_wheel_size || null, vehicle_type === 'bicicleta' ? (bike_electric ? 1 : 0) : null,
      cnh_front || null, cnh_back || null, moto_doc || null, renavam ? String(renavam).replace(/\D/g, '') : null,
      moto_brand || null, moto_model || null, moto_color || null, moto_cyl || null,
      emailCode]);
  const userId = inserted.rows[0].id;

  const user = await db.get(`SELECT ${PUBLIC_FIELDS} FROM users WHERE id = $1`, [userId]);
  const token = signToken(user);
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) console.log(`📧 Código de verificação de e-mail (${email}): ${emailCode}`);
  res.status(201).json({
    token, user, ...(isProd ? {} : { dev_email_code: emailCode }),
    message: 'Cadastro enviado para análise. Confirme seu e-mail com o código enviado. A administração aprovará seu perfil em breve.',
  });
});

// POST /api/auth/verify-email
router.post('/verify-email', authRequired, async (req, res) => {
  const { code } = req.body;
  const user = await db.get('SELECT email_code FROM users WHERE id = $1', [req.user.id]);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
  if (!code || String(code).trim() !== String(user.email_code || '')) {
    return res.status(400).json({ error: 'Código inválido. Verifique o e-mail e tente novamente.' });
  }
  await db.run('UPDATE users SET email_verified = 1, email_code = NULL WHERE id = $1', [req.user.id]);
  const u = await db.get(`SELECT ${PUBLIC_FIELDS} FROM users WHERE id = $1`, [req.user.id]);
  u.face_verified = !!req.user.face_verified;
  res.json({ user: u, message: 'E-mail confirmado!' });
});

// POST /api/auth/resend-email-code
router.post('/resend-email-code', authRequired, async (req, res) => {
  const code = genEmailCode();
  await db.run('UPDATE users SET email_code = $1 WHERE id = $2', [code, req.user.id]);
  const u = await db.get('SELECT email FROM users WHERE id = $1', [req.user.id]);
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) console.log(`📧 Novo código de verificação (${u.email}): ${code}`);
  res.json({ ...(isProd ? {} : { dev_email_code: code }), message: 'Novo código enviado para seu e-mail.' });
});

// POST /api/auth/login — aceita e-mail, CPF ou nome de usuário
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Usuário e senha são obrigatórios.' });
  const login = String(email).trim().toLowerCase();
  const loginDigits = login.replace(/\D/g, '') || null;
  const user = await db.get('SELECT * FROM users WHERE lower(email) = $1 OR cpf = $2', [login, loginDigits]);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
  }
  if (user.status === 'bloqueado') return res.status(403).json({ error: 'Conta bloqueada. Contate o administrador.' });
  const pub = await db.get(`SELECT ${PUBLIC_FIELDS} FROM users WHERE id = $1`, [user.id]);
  const ehEntregador = pub.role === 'entregador';
  const token = signToken(pub, !ehEntregador);
  pub.face_verified = !ehEntregador;
  res.json({
    token,
    user: pub,
    pending: pub.status === 'pendente',
    needs_email_verification: !pub.email_verified,
    needs_face_verification: ehEntregador,
  });
});

// GET /api/auth/me
router.get('/me', authRequired, async (req, res) => {
  const user = await db.get(`SELECT ${PUBLIC_FIELDS} FROM users WHERE id = $1`, [req.user.id]);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
  user.face_verified = !!req.user.face_verified;
  res.json({ user });
});

// PATCH /api/auth/me — atualizar perfil
router.patch('/me', authRequired, async (req, res) => {
  const {
    name, phone, address, city, pix_key, vehicle, plate,
    social_name, delivery_code,
    bike_number, bike_color, bike_wheel_size, bike_electric,
    moto_brand, moto_model, moto_color, moto_cyl, renavam, photo,
  } = req.body;
  const cur = await db.get('SELECT * FROM users WHERE id = $1', [req.user.id]);
  await db.run(`UPDATE users SET
      name=$1, phone=$2, address=$3, city=$4, pix_key=$5, vehicle=$6, plate=$7,
      social_name=$8, delivery_code=$9,
      bike_number=$10, bike_color=$11, bike_wheel_size=$12, bike_electric=$13,
      moto_brand=$14, moto_model=$15, moto_color=$16, moto_cyl=$17, renavam=$18, photo=$19
      WHERE id=$20`,
    [name ?? cur.name, phone ?? cur.phone, address ?? cur.address, city ?? cur.city,
      pix_key ?? cur.pix_key, vehicle ?? cur.vehicle, plate ?? cur.plate,
      social_name ?? cur.social_name, delivery_code ?? cur.delivery_code,
      bike_number ?? cur.bike_number, bike_color ?? cur.bike_color, bike_wheel_size ?? cur.bike_wheel_size,
      bike_electric === undefined ? cur.bike_electric : (bike_electric ? 1 : 0),
      moto_brand ?? cur.moto_brand, moto_model ?? cur.moto_model, moto_color ?? cur.moto_color, moto_cyl ?? cur.moto_cyl,
      renavam ? String(renavam).replace(/\D/g, '') : cur.renavam,
      photo ?? cur.photo,
      req.user.id]);
  const user = await db.get(`SELECT ${PUBLIC_FIELDS} FROM users WHERE id = $1`, [req.user.id]);
  user.face_verified = !!req.user.face_verified;
  res.json({ user, message: 'Perfil atualizado.' });
});

// POST /api/auth/location — entregador atualiza sua localização
router.post('/location', authRequired, faceVerifiedRequired, async (req, res) => {
  const { lat, lng } = req.body;
  if (lat == null || lng == null) return res.status(400).json({ error: 'Localização inválida.' });
  await db.run('UPDATE users SET lat=$1, lng=$2 WHERE id=$3', [parseFloat(lat), parseFloat(lng), req.user.id]);
  res.json({ ok: true });
});

// POST /api/auth/face-verify — entregador valida o rosto após o login (obrigatório em cada login)
router.post('/face-verify', authRequired, async (req, res) => {
  if (req.user.role !== 'entregador') {
    const pub = await db.get(`SELECT ${PUBLIC_FIELDS} FROM users WHERE id = $1`, [req.user.id]);
    pub.face_verified = true;
    return res.json({ token: signToken(pub, true), user: pub, message: 'Perfil não exige verificação facial.' });
  }
  const { photo, match_score, enrolled } = req.body;
  if (!photo || !String(photo).startsWith('data:image')) {
    return res.status(400).json({ error: 'Captura de rosto inválida. Habilite a câmera e tente novamente.' });
  }
  const cur = await db.get('SELECT photo FROM users WHERE id = $1', [req.user.id]);
  const temReferencia = !!(cur && cur.photo);
  let result = 'match';
  if (enrolled && !temReferencia) {
    await db.run('UPDATE users SET photo = $1 WHERE id = $2', [photo, req.user.id]);
    result = 'enrolled';
  } else if (match_score == null) {
    result = 'fallback';
  }
  await db.run(`INSERT INTO face_verifications (user_id,captured_photo,match_score,result) VALUES ($1,$2,$3,$4)`,
    [req.user.id, photo, match_score == null ? null : parseFloat(match_score), result]);
  await db.run('UPDATE users SET face_verified_at = NOW() WHERE id = $1', [req.user.id]);

  const pub = await db.get(`SELECT ${PUBLIC_FIELDS} FROM users WHERE id = $1`, [req.user.id]);
  pub.face_verified = true;
  const token = signToken(pub, true);
  res.json({
    token, user: pub,
    message: result === 'enrolled'
      ? 'Rosto cadastrado como referência. Nos próximos logins ele será comparado.'
      : 'Verificação facial concluída. Bem-vindo!',
  });
});

module.exports = router;
