// src/routes/equipamentos.js
const { Router } = require('express');
const prisma = require('../db');

const router = Router();
const STATUS_VALIDOS = ['DISPONIVEL', 'MANUTENCAO'];

// Listar todos os equipamentos (filtro opcional: ?status=DISPONIVEL)
router.get('/', async (req, res) => {
  const { status } = req.query;
  const equipamentos = await prisma.equipamento.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: 'desc' }
  });
  return res.json(equipamentos);
});

// Buscar equipamento por ID
router.get('/:id', async (req, res) => {
  const equipamento = await prisma.equipamento.findUnique({
    where: { id: req.params.id }
  });

  if (!equipamento) {
    return res.status(404).json({ error: "Equipamento não encontrado" });
  }

  return res.json(equipamento);
});

// Cadastrar novo equipamento
router.post('/', async (req, res) => {
  const { nome, patrimonio, descricao, status, localizacao, categoria, valorEstimado, sensivelUmidade } = req.body;

  if (!nome || !patrimonio || !descricao || !localizacao || !categoria || valorEstimado === undefined) {
    return res.status(400).json({ error: "Campos obrigatórios: nome, patrimonio, descricao, localizacao, categoria, valorEstimado" });
  }
  if (status && !STATUS_VALIDOS.includes(status)) {
    return res.status(400).json({ error: `status deve ser um de: ${STATUS_VALIDOS.join(', ')}` });
  }

  const novoEquipamento = await prisma.equipamento.create({
    data: {
      nome,
      patrimonio,
      descricao,
      status: status || 'DISPONIVEL',
      localizacao,
      categoria,
      valorEstimado: Number(valorEstimado),
      sensivelUmidade: Boolean(sensivelUmidade)
    }
  });

  return res.status(201).json(novoEquipamento);
});

// Atualizar equipamento (envie apenas os campos que deseja alterar)
router.put('/:id', async (req, res) => {
  const { nome, patrimonio, descricao, status, localizacao, categoria, valorEstimado, sensivelUmidade } = req.body;

  if (status && !STATUS_VALIDOS.includes(status)) {
    return res.status(400).json({ error: `status deve ser um de: ${STATUS_VALIDOS.join(', ')}` });
  }

  const equipamento = await prisma.equipamento.update({
    where: { id: req.params.id },
    data: {
      nome,
      patrimonio,
      descricao,
      status,
      localizacao,
      categoria,
      valorEstimado: valorEstimado === undefined ? undefined : Number(valorEstimado),
      sensivelUmidade
    }
  });

  return res.json(equipamento);
});

// Remover equipamento (agendamentos vinculados são removidos em cascata)
router.delete('/:id', async (req, res) => {
  await prisma.equipamento.delete({ where: { id: req.params.id } });
  return res.status(204).send();
});

module.exports = router;
