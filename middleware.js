// middleware.js — Autenticación JWT + control de roles + verificación facial (entregador)
const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET || 'entregapp-dev-secret-cambiar-en-produccion';

// faceVerified: sólo relevante para entregadores (true = ya validó su rostro en este login)
function signToken(user, faceVerified = false) {
  return jwt.sign(
    { id: user.id, role: user.role, name: user.name, face_verified: !!faceVerified },
    SECRET,
    { expiresIn: '7d' }
  );
}

function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Não autorizado. Faça login.' });
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Token inválido ou expirado.' });
  }
}

function roleRequired(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Permissão negada para seu perfil.' });
    }
    next();
  };
}

// Entregador só opera depois de validar o rosto neste login (conta é pessoal e intransferível)
function faceVerifiedRequired(req, res, next) {
  if (req.user && req.user.role === 'entregador' && !req.user.face_verified) {
    return res.status(403).json({
      error: 'Verificação facial pendente. Saia e entre novamente para validar seu rosto.',
      face_verification_required: true,
    });
  }
  next();
}

// Atalho: autentica + exige perfil entregador + rosto validado
const entregadorRequired = [authRequired, roleRequired('entregador'), faceVerifiedRequired];

module.exports = { signToken, authRequired, roleRequired, faceVerifiedRequired, entregadorRequired, SECRET };
