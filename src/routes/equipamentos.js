// src/routes/equipamentos.js
// Permissões:
//  - PESQUISADOR: lista/consulta apenas equipamentos DISPONIVEL
//  - TECNICO: tudo de leitura, altera SOMENTE o status (ex.: colocar em manutenção), consulta condições climáticas
//  - ADMIN: acesso total (cadastro, edição, remoção)
const { Router } = require('express');
const prisma = require('../db');
const { exigirPerfil } = require('../middleware/auth');
const { consultarClimaAtual, consultarClima, umidadeMaxima } = require('../services/clima');

const router = Router();
const STATUS_VALIDOS = ['DISPONIVEL', 'MANUTENCAO'];

// Listar equipamentos (filtro opcional: ?status=DISPONIVEL)
router.get('/', async (req, res) => {
  const { status } = req.query;
  const where = req.usuario.perfil === 'PESQUISADOR'
    ? { status: 'DISPONIVEL' }
    : (status ? { status } : undefined);

  const equipamentos = await prisma.equipamento.findMany({ where, orderBy: { createdAt: 'desc' } });
  return res.json(equipamentos);
});

// INTEGRAÇÃO COM API EXTERNA: combina o equipamento (banco local) com clima atual + previsão (OpenWeather)
// Faz 2 requisições externas (/weather e /forecast). Opcional: ?data=2026-11-02T14:00:00Z
router.get('/:id/condicoes', exigirPerfil('TECNICO', 'ADMIN'), async (req, res) => {
  const equipamento = await prisma.equipamento.findUnique({ where: { id: req.params.id } });
  if (!equipamento) {
    return res.status(404).json({ error: "Equipamento não encontrado" });
  }

  const dataAlvo = req.query.data ? new Date(req.query.data) : new Date(Date.now() + 3 * 60 * 60 * 1000);
  if (isNaN(dataAlvo)) {
    return res.status(400).json({ error: "Parâmetro 'data' inválido (use formato ISO 8601)" });
  }

  const [atual, previsao] = await Promise.all([consultarClimaAtual(), consultarClima(dataAlvo)]);
  const limite = umidadeMaxima();
  const umidadeMaisAlta = Math.max(atual?.umidade ?? 0, previsao?.umidade ?? 0);

  return res.json({
    equipamento,
    clima: { atual, previsao, dataPrevisao: dataAlvo },
    limiteUmidade: limite,
    risco: equipamento.sensivelUmidade && umidadeMaisAlta > limite,
    observacao: atual || previsao ? undefined : 'Dados climáticos indisponíveis no momento (OpenWeather)'
  });
});

// Buscar equipamento por ID
router.get('/:id', async (req, res) => {
  const equipamento = await prisma.equipamento.findUnique({ where: { id: req.params.id } });

  if (!equipamento || (req.usuario.perfil === 'PESQUISADOR' && equipamento.status !== 'DISPONIVEL')) {
    return res.status(404).json({ error: "Equipamento não encontrado" });
  }

  return res.json(equipamento);
});

// Cadastrar novo equipamento (ADMIN)
router.post('/', exigirPerfil('ADMIN'), async (req, res) => {
  const { nome, patrimonio, descricao, status, localizacao, categoria, valorEstimado, sensivelUmidade } = req.body;

  if (!nome || !patrimonio || !descricao || !localizacao || !categoria || valorEstimado === undefined) {
    return res.status(400).json({ error: "Campos obrigatórios: nome, patrimonio, descricao, localizacao, categoria, valorEstimado" });
  }
  if (status && !STATUS_VALIDOS.includes(status)) {
    return res.status(400).json({ error: `status deve ser um de: ${STATUS_VALIDOS.join(', ')}` });
  }
  if (isNaN(Number(valorEstimado)) || Number(valorEstimado) < 0) {
    return res.status(400).json({ error: "valorEstimado deve ser um número maior ou igual a zero" });
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

// Atualizar equipamento (ADMIN: qualquer campo | TECNICO: somente status)
router.put('/:id', exigirPerfil('ADMIN', 'TECNICO'), async (req, res) => {
  const { nome, patrimonio, descricao, status, localizacao, categoria, valorEstimado, sensivelUmidade } = req.body;

  if (req.usuario.perfil === 'TECNICO') {
    const outrosCampos = Object.keys(req.body).filter((campo) => campo !== 'status');
    if (outrosCampos.length > 0) {
      return res.status(403).json({
        error: `Técnico só pode alterar o status do equipamento (campos não permitidos: ${outrosCampos.join(', ')})`
      });
    }
  }

  if (status && !STATUS_VALIDOS.includes(status)) {
    return res.status(400).json({ error: `status deve ser um de: ${STATUS_VALIDOS.join(', ')}` });
  }
  if (valorEstimado !== undefined && (isNaN(Number(valorEstimado)) || Number(valorEstimado) < 0)) {
    return res.status(400).json({ error: "valorEstimado deve ser um número maior ou igual a zero" });
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

// Remover equipamento (ADMIN; agendamentos vinculados são removidos em cascata)
router.delete('/:id', exigirPerfil('ADMIN'), async (req, res) => {
  await prisma.equipamento.delete({ where: { id: req.params.id } });
  return res.status(204).send();
});

module.exports = router;
