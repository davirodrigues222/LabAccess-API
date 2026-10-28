// src/index.js
const express = require('express');
const prisma = require('./db');
const app = express();

app.use(express.json());

// --- ROTAS DE EQUIPAMENTOS ---

// Listar todos os equipamentos
app.get('/equipamentos', async (req, res) => {
  try {
    const equipamentos = await prisma.equipamento.findMany();
    res.json(equipamentos);
  } catch (error) {
    res.status(500).json({ error: "Erro ao buscar equipamentos" });
  }
});

// Criar um novo equipamento (com os campos exigidos)
app.post('/equipamentos', async (req, res) => {
  try {
    const { nome, patrimonio, descricao, status, localizacao, categoria, valorEstimado } = req.body;
    const novoEquipamento = await prisma.equipamento.create({
      data: { nome, patrimonio, descricao, status, localizacao, categoria, valorEstimado }
    });
    res.status(201).json(novoEquipamento);
  } catch (error) {
    res.status(400).json({ error: "Erro ao criar equipamento. Verifique se o patrimônio é único." });
  }
});

// --- ROTAS DE AGENDAMENTOS & INTEGRAÇÃO EXTERNA (OpenWeather) ---

app.post('/agendamentos', async (req, res) => {
  try {
    const { usuarioId, equipamentoId, dataInicio, dataFim, finalidade, statusAprovacao, observacoesTecnico, cidade } = req.body;

    // INTEGRAÇÃO COM API EXTERNA (OpenWeather)
    const apiKey = process.env.WEATHER_API_KEY || 'sua_chave_aqui';
    const cidadeConsulta = cidade || 'Fortaleza';
    
    const response = await fetch(`https://api.openweathermap.org/data/2.5/weather?q=${cidadeConsulta}&appid=${apiKey}&units=metric`);
    const climaData = await response.json();

    if (response.ok) {
      const umidade = climaData.main.humidity;
      if (umidade > 90) {
        console.log(`Alerta: Umidade alta em ${cidadeConsulta} (${umidade}%)`);
      }
    }

    const novoAgendamento = await prisma.agendamento.create({
      data: {
        usuarioId,
        equipamentoId,
        dataInicio: new Date(dataInicio),
        dataFim: new Date(dataFim),
        finalidade,
        statusAprovacao: statusAprovacao || 'PENDENTE',
        observacoesTecnico: observacoesTecnico || 'Agendamento criado com sucesso.'
      }
    });

    res.status(201).json(novoAgendamento);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erro ao registrar agendamento ou consultar API externa." });
  }
});

app.get('/agendamentos', async (req, res) => {
  try {
    const agendamentos = await prisma.agendamento.findMany({
      include: { equipamento: true }
    });
    res.json(agendamentos);
  } catch (error) {
    res.status(500).json({ error: "Erro ao buscar agendamentos" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});