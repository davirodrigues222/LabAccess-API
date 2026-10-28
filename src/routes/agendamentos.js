// src/routes/agendamentos.js
// Permissões:
//  - PESQUISADOR: solicita agendamentos (sempre em seu nome), vê/edita/cancela só os PRÓPRIOS (edição só enquanto PENDENTE)
//  - TECNICO: vê todos, aprova/rejeita (statusAprovacao, observacoesTecnico)
//  - ADMIN: acesso total
const { Router } = require('express');
const prisma = require('../db');
const { exigirPerfil } = require('../middleware/auth');
const { consultarClima, umidadeMaxima } = require('../services/clima');

const router = Router();
const STATUS_APROVACAO = ['PENDENTE', 'APROVADO', 'REJEITADO'];

// Só expõe dados básicos do usuário (nunca fingerprint/certificado)
const USUARIO_PUBLICO = { select: { id: true, nome: true, email: true, perfil: true } };

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

// INTEGRAÇÃO COM API EXTERNA (OpenWeather): consulta a previsão e decide se bloqueia a reserva
async function avaliarClima(equipamento, inicio) {
  const clima = await consultarClima(inicio);
  const bloqueado = Boolean(clima && equipamento.sensivelUmidade && clima.umidade > umidadeMaxima());
  return { clima, bloqueado };
}

function respostaBloqueioClima(clima) {
  return {
    error: "Reserva bloqueada: umidade prevista acima do limite para equipamento sensível",
    clima,
    limiteUmidade: umidadeMaxima()
  };
}

// Listar agendamentos (filtros opcionais: ?usuarioId=...&equipamentoId=...&statusAprovacao=...)
router.get('/', async (req, res) => {
  const { equipamentoId, statusAprovacao } = req.query;
  // Pesquisador só enxerga os próprios, ignorando qualquer ?usuarioId= enviado
  const usuarioId = req.usuario.perfil === 'PESQUISADOR' ? req.usuario.id : req.query.usuarioId;

  const agendamentos = await prisma.agendamento.findMany({
    where: { usuarioId, equipamentoId, statusAprovacao },
    include: { equipamento: true, usuario: USUARIO_PUBLICO },
    orderBy: { dataInicio: 'asc' }
  });
  return res.json(agendamentos);
});

// Buscar agendamento por ID
router.get('/:id', async (req, res) => {
  const agendamento = await prisma.agendamento.findUnique({
    where: { id: req.params.id },
    include: { equipamento: true, usuario: USUARIO_PUBLICO }
  });

  if (!agendamento) {
    return res.status(404).json({ error: "Agendamento não encontrado" });
  }
  if (req.usuario.perfil === 'PESQUISADOR' && agendamento.usuarioId !== req.usuario.id) {
    return res.status(403).json({ error: "Acesso negado: este agendamento pertence a outro usuário" });
  }

  return res.json(agendamento);
});

// Solicitar agendamento (PESQUISADOR/ADMIN; sempre em nome de quem está autenticado)
router.post('/', exigirPerfil('PESQUISADOR', 'ADMIN'), async (req, res) => {
  const { equipamentoId, dataInicio, dataFim, finalidade } = req.body;
  const usuarioId = req.usuario.id;

  if (!equipamentoId || !dataInicio || !dataFim || !finalidade) {
    return res.status(400).json({ error: "Campos obrigatórios: equipamentoId, dataInicio, dataFim, finalidade" });
  }

  const inicio = new Date(dataInicio);
  const fim = new Date(dataFim);
  if (isNaN(inicio) || isNaN(fim) || inicio >= fim) {
    return res.status(400).json({ error: "Datas inválidas: dataInicio deve ser anterior a dataFim" });
  }

  const equipamento = await prisma.equipamento.findUnique({ where: { id: equipamentoId } });
  if (!equipamento) {
    return res.status(404).json({ error: "Equipamento não encontrado" });
  }
  if (equipamento.status !== 'DISPONIVEL') {
    return res.status(409).json({ error: `Equipamento indisponível (status: ${equipamento.status})` });
  }

  if (await buscarConflito(equipamentoId, inicio, fim)) {
    return res.status(409).json({ error: "Já existe um agendamento para este equipamento no período" });
  }

  const { clima, bloqueado } = await avaliarClima(equipamento, inicio);
  if (bloqueado) {
    return res.status(422).json(respostaBloqueioClima(clima));
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

// Atualizar agendamento
//  - aprovação (statusAprovacao/observacoesTecnico): TECNICO ou ADMIN
//  - datas/finalidade: dono (enquanto PENDENTE) ou ADMIN
router.put('/:id', async (req, res) => {
  const { dataInicio, dataFim, finalidade, statusAprovacao, observacoesTecnico } = req.body;
  const perfil = req.usuario.perfil;

  if (statusAprovacao && !STATUS_APROVACAO.includes(statusAprovacao)) {
    return res.status(400).json({ error: `statusAprovacao deve ser um de: ${STATUS_APROVACAO.join(', ')}` });
  }

  const atual = await prisma.agendamento.findUnique({
    where: { id: req.params.id },
    include: { equipamento: true }
  });
  if (!atual) {
    return res.status(404).json({ error: "Agendamento não encontrado" });
  }

  const ehAprovador = perfil === 'TECNICO' || perfil === 'ADMIN';
  const mexeEmAprovacao = statusAprovacao !== undefined || observacoesTecnico !== undefined;
  const mexeEmDados = dataInicio !== undefined || dataFim !== undefined || finalidade !== undefined;

  if (mexeEmAprovacao && !ehAprovador) {
    return res.status(403).json({ error: "Somente técnico ou administrador podem aprovar/rejeitar agendamentos" });
  }
  if (mexeEmDados) {
    const ehDono = atual.usuarioId === req.usuario.id;
    if (perfil !== 'ADMIN' && !ehDono) {
      return res.status(403).json({ error: "Acesso negado: apenas o dono do agendamento (ou admin) pode alterar datas e finalidade" });
    }
    if (perfil !== 'ADMIN' && atual.statusAprovacao !== 'PENDENTE') {
      return res.status(409).json({ error: "Só é possível alterar agendamentos com status PENDENTE" });
    }
  }

  const inicio = dataInicio ? new Date(dataInicio) : atual.dataInicio;
  const fim = dataFim ? new Date(dataFim) : atual.dataFim;
  if (isNaN(inicio) || isNaN(fim) || inicio >= fim) {
    return res.status(400).json({ error: "Datas inválidas: dataInicio deve ser anterior a dataFim" });
  }

  let clima;
  if (dataInicio || dataFim) {
    if (await buscarConflito(atual.equipamentoId, inicio, fim, atual.id)) {
      return res.status(409).json({ error: "Já existe um agendamento para este equipamento no período" });
    }
    // Remarcar também passa pela checagem de clima (evita contornar o bloqueio mudando a data)
    const avaliacao = await avaliarClima(atual.equipamento, inicio);
    if (avaliacao.bloqueado) {
      return res.status(422).json(respostaBloqueioClima(avaliacao.clima));
    }
    clima = avaliacao.clima;
  }

  const agendamento = await prisma.agendamento.update({
    where: { id: req.params.id },
    data: {
      dataInicio: inicio,
      dataFim: fim,
      finalidade,
      statusAprovacao,
      observacoesTecnico,
      umidade: clima?.umidade,
      temperatura: clima?.temperatura,
      condicaoClimatica: clima?.condicao
    },
    include: { equipamento: true, usuario: USUARIO_PUBLICO }
  });

  return res.json(agendamento);
});

// Cancelar/remover agendamento (dono ou ADMIN)
router.delete('/:id', async (req, res) => {
  const atual = await prisma.agendamento.findUnique({ where: { id: req.params.id } });
  if (!atual) {
    return res.status(404).json({ error: "Agendamento não encontrado" });
  }
  if (req.usuario.perfil !== 'ADMIN' && atual.usuarioId !== req.usuario.id) {
    return res.status(403).json({ error: "Acesso negado: apenas o dono do agendamento (ou admin) pode cancelá-lo" });
  }
  if (req.usuario.perfil === 'TECNICO') {
    return res.status(403).json({ error: "Técnico não pode cancelar agendamentos" });
  }

  await prisma.agendamento.delete({ where: { id: req.params.id } });
  return res.status(204).send();
});

module.exports = router;
