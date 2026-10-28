// src/routes/usuarios.js
const { Router } = require('express');
const prisma = require('../db');

const router = Router();
const PERFIS_VALIDOS = ['PESQUISADOR', 'TECNICO', 'ADMIN'];

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

// Cadastrar usuário
router.post('/', async (req, res) => {
  const { nome, email, matricula, perfil, certificadoCN } = req.body;

  if (!nome || !email || !matricula || !perfil || !certificadoCN) {
    return res.status(400).json({ error: "Campos obrigatórios: nome, email, matricula, perfil, certificadoCN" });
  }
  if (!PERFIS_VALIDOS.includes(perfil)) {
    return res.status(400).json({ error: `perfil deve ser um de: ${PERFIS_VALIDOS.join(', ')}` });
  }

  const usuario = await prisma.usuario.create({
    data: { nome, email, matricula, perfil, certificadoCN }
  });

  return res.status(201).json(usuario);
});

// Atualizar usuário
router.put('/:id', async (req, res) => {
  const { nome, email, matricula, perfil, certificadoCN, ativo } = req.body;

  if (perfil && !PERFIS_VALIDOS.includes(perfil)) {
    return res.status(400).json({ error: `perfil deve ser um de: ${PERFIS_VALIDOS.join(', ')}` });
  }

  const usuario = await prisma.usuario.update({
    where: { id: req.params.id },
    data: { nome, email, matricula, perfil, certificadoCN, ativo }
  });

  return res.json(usuario);
});

// Remover usuário
router.delete('/:id', async (req, res) => {
  await prisma.usuario.delete({ where: { id: req.params.id } });
  return res.status(204).send();
});

module.exports = router;
