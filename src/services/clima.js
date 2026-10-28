// src/services/clima.js
// Integração com a API do OpenWeather (2 endpoints diferentes):
//  - /weather  -> clima ATUAL (consultarClimaAtual)
//  - /forecast -> PREVISÃO até 5 dias, usando o horário mais próximo de dataInicio (consultarClima)
// Falhas/timeout não derrubam a API: retornam null (a reserva NÃO é bloqueada — decisão "fail-open").

const BASE_URL = 'https://api.openweathermap.org/data/2.5';
const CINCO_DIAS_MS = 5 * 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 5000;

function cidade() {
  return process.env.CIDADE_LABORATORIO || 'Fortaleza';
}

async function chamarOpenWeather(caminho) {
  const apiKey = process.env.WEATHER_API_KEY;
  if (!apiKey) {
    console.warn('WEATHER_API_KEY não configurada: consulta climática ignorada.');
    return null;
  }

  const url = `${BASE_URL}/${caminho}?q=${encodeURIComponent(cidade())}&appid=${apiKey}&units=metric&lang=pt_br`;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) {
      console.warn(`OpenWeather (${caminho}) respondeu ${response.status}: consulta climática ignorada.`);
      return null;
    }
    return await response.json();
  } catch (error) {
    console.warn(`Falha ao consultar OpenWeather (${caminho}):`, error.message);
    return null;
  }
}

function resumir(item) {
  return {
    cidade: cidade(),
    umidade: item.main.humidity,
    temperatura: item.main.temp,
    condicao: item.weather[0].description
  };
}

// Requisição 1: clima atual
async function consultarClimaAtual() {
  const dados = await chamarOpenWeather('weather');
  return dados ? { ...resumir(dados), referencia: new Date(dados.dt * 1000).toISOString() } : null;
}

// Requisição 2: previsão para a data desejada (até 5 dias à frente)
async function consultarClima(dataInicio) {
  const inicio = new Date(dataInicio).getTime();
  if (inicio - Date.now() > CINCO_DIAS_MS) {
    return null; // sem previsão disponível além de 5 dias
  }

  const dados = await chamarOpenWeather('forecast');
  if (!dados || !Array.isArray(dados.list) || dados.list.length === 0) {
    return null;
  }

  const previsao = dados.list.reduce((maisProxima, item) =>
    Math.abs(item.dt * 1000 - inicio) < Math.abs(maisProxima.dt * 1000 - inicio) ? item : maisProxima
  );

  return { ...resumir(previsao), referencia: new Date(previsao.dt * 1000).toISOString() };
}

function umidadeMaxima() {
  return Number(process.env.UMIDADE_MAXIMA) || 80;
}

module.exports = { consultarClima, consultarClimaAtual, umidadeMaxima };
