// src/routes/agendamentos.js
const { Router } = require('express');
const prisma = require('../db');
const { consultarClima, umidadeMaxima } = require('../services/clima');

const router = Router();
const STATUS_APROVACAO = ['PENDENTE', 'APROVADO', 'REJEITADO'];

// Retorna o agendamento ativo (pendente/aprovado) que conflita com o período, se houver
function buscarConflito(equipamentoId, dataInicio, dataFim, ignorarId) {
  return prisma.agendamento.findFirst({
    where: {
      equipamentoId,
      id: ignorarId ? { not: ignorarId } : undefined,
      statusAprovacao: { in: ['PENDENTE', 'APROVADO'] },
      dataInicio: { lt: dataFim },
      dataFim: { gt: dataInicio }
    }
  });
}

// Listar agendamentos (filtros opcionais: ?usuarioId=...&equipamentoId=...&statusAprovacao=...)
router.get('/', async (req, res) => {
  const { usuarioId, equipamentoId, statusAprovacao } = req.query;
  const agendamentos = await prisma.agendamento.findMany({
    where: { usuarioId, equipamentoId, statusAprovacao },
    include: { equipamento: true, usuario: true },
    orderBy: { dataInicio: 'asc' }
  });
  return res.json(agendamentos);
});

// Buscar agendamento por ID
router.get('/:id', async (req, res) => {
  const agendamento = await prisma.agendamento.findUnique({
    where: { id: req.params.id },
    include: { equipamento: true, usuario: true }
  });

  if (!agendamento) {
    return res.status(404).json({ error: "Agendamento não encontrado" });
  }

  return res.json(agendamento);
});

// Solicitar agendamento (consulta o OpenWeather antes de gravar)
router.post('/', async (req, res) => {
  const { usuarioId, equipamentoId, dataInicio, dataFim, finalidade } = req.body;

  if (!usuarioId || !equipamentoId || !dataInicio || !dataFim || !finalidade) {
    return res.status(400).json({ error: "Campos obrigatórios: usuarioId, equipamentoId, dataInicio, dataFim, finalidade" });
  }

  const inicio = new Date(dataInicio);
  const fim = new Date(dataFim);
  if (isNaN(inicio) || isNaN(fim) || inicio >= fim) {
    return res.status(400).json({ error: "Datas inválidas: dataInicio deve ser anterior a dataFim" });
  }

  const [usuario, equipamento] = await Promise.all([
    prisma.usuario.findUnique({ where: { id: usuarioId } }),
    prisma.equipamento.findUnique({ where: { id: equipamentoId } })
  ]);
  if (!usuario) {
    return res.status(404).json({ error: "Usuário não encontrado" });
  }
  if (!equipamento) {
    return res.status(404).json({ error: "Equipamento não encontrado" });
  }
  if (equipamento.status !== 'DISPONIVEL') {
    return res.status(409).json({ error: `Equipamento indisponível (status: ${equipamento.status})` });
  }

  if (await buscarConflito(equipamentoId, inicio, fim)) {
    return res.status(409).json({ error: "Já existe um agendamento para este equipamento no período" });
  }

  // INTEGRAÇÃO COM API EXTERNA (OpenWeather)
  const clima = await consultarClima(inicio);
  if (clima && equipamento.sensivelUmidade && clima.umidade > umidadeMaxima()) {
    return res.status(422).json({
      error: "Reserva bloqueada: umidade prevista acima do limite para equipamento sensível",
      clima,
      limiteUmidade: umidadeMaxima()
    });
  }

  const novoAgendamento = await prisma.agendamento.create({
    data: {
      usuarioId,
      equipamentoId,
      dataInicio: inicio,
      dataFim: fim,
      finalidade,
      umidade: clima?.umidade,
      temperatura: clima?.temperatura,
      condicaoClimatica: clima?.condicao
    },
    include: { equipamento: true }
  });

  return res.status(201).json(novoAgendamento);
});

// Atualizar agendamento (datas/finalidade, ou aprovação pelo técnico)
router.put('/:id', async (req, res) => {
  const { dataInicio, dataFim, finalidade, statusAprovacao, observacoesTecnico } = req.body;

  if (statusAprovacao && !STATUS_APROVACAO.includes(statusAprovacao)) {
    return res.status(400).json({ error: `statusAprovacao deve ser um de: ${STATUS_APROVACAO.join(', ')}` });
  }

  const atual = await prisma.agendamento.findUnique({ where: { id: req.params.id } });
  if (!atual) {
    return res.status(404).json({ error: "Agendamento não encontrado" });
  }

  const inicio = dataInicio ? new Date(dataInicio) : atual.dataInicio;
  const fim = dataFim ? new Date(dataFim) : atual.dataFim;
  if (isNaN(inicio) || isNaN(fim) || inicio >= fim) {
    return res.status(400).json({ error: "Datas inválidas: dataInicio deve ser anterior a dataFim" });
  }

  if ((dataInicio || dataFim) && await buscarConflito(atual.equipamentoId, inicio, fim, atual.id)) {
    return res.status(409).json({ error: "Já existe um agendamento para este equipamento no período" });
  }

  const agendamento = await prisma.agendamento.update({
    where: { id: req.params.id },
    data: { dataInicio: inicio, dataFim: fim, finalidade, statusAprovacao, observacoesTecnico },
    include: { equipamento: true, usuario: true }
  });

  return res.json(agendamento);
});

// Cancelar/remover agendamento
router.delete('/:id', async (req, res) => {
  await prisma.agendamento.delete({ where: { id: req.params.id } });
  return res.status(204).send();
});

module.exports = router;
