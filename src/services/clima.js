// src/services/clima.js
// Integração com a API do OpenWeather.
// - Até 5 dias à frente: usa a previsão (/forecast) do horário mais próximo de dataInicio.
// - Além disso: não há previsão disponível, retorna null (reserva não é bloqueada).

const BASE_URL = 'https://api.openweathermap.org/data/2.5';
const CINCO_DIAS_MS = 5 * 24 * 60 * 60 * 1000;

async function consultarClima(dataInicio) {
  const apiKey = process.env.WEATHER_API_KEY;
  const cidade = process.env.CIDADE_LABORATORIO || 'Fortaleza';

  if (!apiKey) {
    console.warn('WEATHER_API_KEY não configurada: consulta climática ignorada.');
    return null;
  }

  const inicio = new Date(dataInicio).getTime();
  if (inicio - Date.now() > CINCO_DIAS_MS) {
    return null;
  }

  const url = `${BASE_URL}/forecast?q=${encodeURIComponent(cidade)}&appid=${apiKey}&units=metric&lang=pt_br`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`OpenWeather respondeu ${response.status}: consulta climática ignorada.`);
      return null;
    }

    const { list } = await response.json();
    const previsao = list.reduce((maisProxima, item) =>
      Math.abs(item.dt * 1000 - inicio) < Math.abs(maisProxima.dt * 1000 - inicio) ? item : maisProxima
    );

    return {
      cidade,
      umidade: previsao.main.humidity,
      temperatura: previsao.main.temp,
      condicao: previsao.weather[0].description
    };
  } catch (error) {
    console.warn('Falha ao consultar OpenWeather:', error.message);
    return null;
  }
}

function umidadeMaxima() {
  return Number(process.env.UMIDADE_MAXIMA) || 80;
}

module.exports = { consultarClima, umidadeMaxima };
