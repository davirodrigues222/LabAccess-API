// src/routes/usuarios.js
// Gestão de contas: somente ADMIN (contém dados pessoais e fingerprints de certificados).
const { Router } = require('express');
const prisma = require('../db');
const { exigirPerfil, normalizarFingerprint } = require('../middleware/auth');

const router = Router();
const PERFIS_VALIDOS = ['PESQUISADOR', 'TECNICO', 'ADMIN'];
const TAMANHO_FINGERPRINT = 95; // SHA-256: 32 bytes em hex com ":" -> 32*2 + 31

router.use(exigirPerfil('ADMIN'));

// Listar usuários
router.get('/', async (req, res) => {
  const usuarios = await prisma.usuario.findMany({ orderBy: { nome: 'asc' } });
  return res.json(usuarios);
});

// Buscar usuário por ID (com histórico de agendamentos)
router.get('/:id', async (req, res) => {
  const usuario = await prisma.usuario.findUnique({
    where: { id: req.params.id },
    include: { agendamentos: { include: { equipamento: true } } }
  });

  if (!usuario) {
    return res.status(404).json({ error: "Usuário não encontrado" });
  }

  return res.json(usuario);
});

// Cadastrar usuário (associa um certificado de cliente via fingerprint SHA-256)
router.post('/', async (req, res) => {
  const { nome, email, matricula, perfil, certificadoCN, certificadoFingerprint } = req.body;

  if (!nome || !email || !matricula || !perfil || !certificadoCN || !certificadoFingerprint) {
    return res.status(400).json({ error: "Campos obrigatórios: nome, email, matricula, perfil, certificadoCN, certificadoFingerprint" });
  }
  if (!PERFIS_VALIDOS.includes(perfil)) {
    return res.status(400).json({ error: `perfil deve ser um de: ${PERFIS_VALIDOS.join(', ')}` });
  }
  const fingerprint = normalizarFingerprint(certificadoFingerprint);
  if (fingerprint.length !== TAMANHO_FINGERPRINT) {
    return res.status(400).json({ error: "certificadoFingerprint inválido (esperado SHA-256: 32 bytes em hexadecimal)" });
  }

  const usuario = await prisma.usuario.create({
    data: { nome, email, matricula, perfil, certificadoCN, certificadoFingerprint: fingerprint }
  });

  return res.status(201).json(usuario);
});

// Atualizar usuário
router.put('/:id', async (req, res) => {
  const { nome, email, matricula, perfil, certificadoCN, certificadoFingerprint, ativo } = req.body;

  if (perfil && !PERFIS_VALIDOS.includes(perfil)) {
    return res.status(400).json({ error: `perfil deve ser um de: ${PERFIS_VALIDOS.join(', ')}` });
  }

  let fingerprint;
  if (certificadoFingerprint !== undefined) {
    fingerprint = normalizarFingerprint(certificadoFingerprint);
    if (fingerprint.length !== TAMANHO_FINGERPRINT) {
      return res.status(400).json({ error: "certificadoFingerprint inválido (esperado SHA-256: 32 bytes em hexadecimal)" });
    }
  }

  const usuario = await prisma.usuario.update({
    where: { id: req.params.id },
    data: { nome, email, matricula, perfil, certificadoCN, certificadoFingerprint: fingerprint, ativo }
  });

  // Troca de certificado ou desativação: derruba as sessões abertas desse usuário
  if (fingerprint !== undefined || ativo === false) {
    await prisma.sessaoCertificado.deleteMany({ where: { usuarioId: usuario.id } });
  }

  return res.json(usuario);
});

// Remover usuário (sessões e agendamentos são removidos em cascata)
router.delete('/:id', async (req, res) => {
  if (req.params.id === req.usuario.id) {
    return res.status(400).json({ error: "Você não pode remover o próprio usuário" });
  }
  await prisma.usuario.delete({ where: { id: req.params.id } });
  return res.status(204).send();
});

module.exports = router;
