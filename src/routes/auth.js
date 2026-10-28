// src/routes/auth.js
// Login/logout no mTLS: a identidade vem do certificado; a "sessão" controla o tempo de acesso.
const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const prisma = require('../db');
const { exigirSessao } = require('../middleware/auth');

const router = Router();

// Limite mais apertado para tentativas de login
const limitadorLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas de login. Tente novamente em alguns minutos.' }
});

// Login: certificado válido (já checado pelo middleware) -> abre sessão
router.post('/login', limitadorLogin, async (req, res) => {
  const minutos = Number(process.env.SESSAO_MINUTOS) || 60;
  let expiraEm = new Date(Date.now() + minutos * 60 * 1000);

  // A sessão nunca dura mais que o próprio certificado
  const validadeCert = new Date(req.certificado.validoAte);
  if (!isNaN(validadeCert) && validadeCert < expiraEm) {
    expiraEm = validadeCert;
  }

  await prisma.sessaoCertificado.upsert({
    where: { fingerprint: req.certificado.fingerprint },
    update: { expiraEm, usuarioId: req.usuario.id },
    create: { fingerprint: req.certificado.fingerprint, usuarioId: req.usuario.id, expiraEm }
  });

  return res.json({
    mensagem: 'Login realizado',
    usuario: { id: req.usuario.id, nome: req.usuario.nome, perfil: req.usuario.perfil },
    certificado: { cn: req.certificado.cn, validoAte: req.certificado.validoAte },
    sessaoExpiraEm: expiraEm
  });
});

// Logout: encerra a sessão deste certificado
router.post('/logout', async (req, res) => {
  await prisma.sessaoCertificado.deleteMany({ where: { fingerprint: req.certificado.fingerprint } });
  return res.status(204).send();
});

// Quem sou eu? (exige sessão ativa)
router.get('/me', exigirSessao, (req, res) => {
  const { id, nome, email, matricula, perfil, certificadoCN } = req.usuario;
  return res.json({ id, nome, email, matricula, perfil, certificadoCN, certificado: req.certificado });
});

module.exports = router;
