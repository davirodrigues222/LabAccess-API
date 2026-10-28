// src/middleware/auth.js
// Autenticação mTLS: o handshake TLS já validou (ou não) o certificado do cliente contra a nossa CA.
// Aqui identificamos QUEM é o dono do certificado e aplicamos sessão + permissões por perfil.
const prisma = require('../db');

// Padroniza fingerprints para o formato "AB:CD:EF:..." (maiúsculo, separado por dois-pontos)
function normalizarFingerprint(valor) {
  const hex = String(valor || '').replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  return (hex.match(/.{1,2}/g) || []).join(':');
}

// 1) Certificado válido + usuário ativo -> anexa req.usuario e req.certificado
async function identificarCertificado(req, res, next) {
  const socket = req.socket;
  const cert = socket.getPeerCertificate ? socket.getPeerCertificate() : null;

  if (!cert || !cert.fingerprint256) {
    return res.status(401).json({ error: 'Certificado de cliente não apresentado (mTLS obrigatório)' });
  }
  if (!socket.authorized) {
    return res.status(401).json({
      error: 'Certificado de cliente inválido',
      motivo: String(socket.authorizationError || 'não confiável')
    });
  }

  const fingerprint = normalizarFingerprint(cert.fingerprint256);
  const usuario = await prisma.usuario.findUnique({ where: { certificadoFingerprint: fingerprint } });

  if (!usuario) {
    return res.status(401).json({ error: 'Certificado válido, mas não associado a nenhum usuário' });
  }
  if (!usuario.ativo) {
    return res.status(403).json({ error: 'Usuário desativado' });
  }

  req.usuario = usuario;
  req.certificado = { fingerprint, validoAte: cert.valid_to, cn: cert.subject && cert.subject.CN };
  next();
}

// 2) Exige que o "login" tenha sido feito e a sessão não tenha expirado
async function exigirSessao(req, res, next) {
  const sessao = await prisma.sessaoCertificado.findUnique({
    where: { fingerprint: req.certificado.fingerprint }
  });

  if (!sessao || sessao.expiraEm < new Date()) {
    return res.status(401).json({ error: 'Sessão inexistente ou expirada. Faça login em POST /auth/login' });
  }
  next();
}

// 3) Autorização por perfil (retorna 403 se o perfil não estiver na lista)
function exigirPerfil(...perfis) {
  return (req, res, next) => {
    if (!perfis.includes(req.usuario.perfil)) {
      return res.status(403).json({
        error: `Acesso negado: esta operação exige perfil ${perfis.join(' ou ')}`,
        seuPerfil: req.usuario.perfil
      });
    }
    next();
  };
}

module.exports = { normalizarFingerprint, identificarCertificado, exigirSessao, exigirPerfil };
