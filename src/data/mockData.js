// Genera datos simulados en tiempo real
export function generateRealTimeData() {
  const hour = new Date().getHours();
  const isDaytime = hour >= 7 && hour <= 20;
  const solarPeak = hour >= 10 && hour <= 15;

  const pvGeneration = isDaytime
    ? solarPeak
      ? 4.2 + Math.random() * 1.8
      : 1.5 + Math.random() * 2.0
    : 0;

  const climaConsumption = 0.8 + Math.random() * 0.6;
  const baseConsumption = 1.2 + Math.random() * 0.4;
  const totalConsumption = baseConsumption + climaConsumption;

  const gridDemand = Math.max(0, totalConsumption - pvGeneration);
  const batteryFlow = pvGeneration - totalConsumption; // + = carga, - = descarga
  const batteryLevel = 45 + Math.random() * 30;

  return {
    pvGeneration: +pvGeneration.toFixed(2),
    totalConsumption: +totalConsumption.toFixed(2),
    climaConsumption: +climaConsumption.toFixed(2),
    gridDemand: +gridDemand.toFixed(2),
    batteryFlow: +batteryFlow.toFixed(2),
    batteryLevel: +batteryLevel.toFixed(1),
    exterior: {
      temperature: +(18 + Math.random() * 12).toFixed(1),
      humidity: +(40 + Math.random() * 30).toFixed(1),
      radiation: isDaytime ? +(200 + Math.random() * 700).toFixed(0) : 0,
    },
    interior: {
      temperature: +(21 + Math.random() * 4).toFixed(1),
      humidity: +(45 + Math.random() * 20).toFixed(1),
      co2: +(400 + Math.random() * 600).toFixed(0),
    },
    timestamp: new Date().toISOString(),
  };
}

// Genera historial de las últimas 24 horas
export function generateHistoricalData() {
  const data = [];
  const now = new Date();
  for (let i = 143; i >= 0; i--) {
    const time = new Date(now.getTime() - i * 10 * 60 * 1000);
    const h = time.getHours();
    const isDaytime = h >= 7 && h <= 20;
    const solarPeak = h >= 10 && h <= 15;

    const pv = isDaytime ? (solarPeak ? 3.5 + Math.random() * 2 : 1 + Math.random() * 2.5) : 0;
    const clima = 0.6 + Math.random() * 0.8;
    const base = 1.0 + Math.random() * 0.6;
    const total = base + clima;
    const grid = Math.max(0, total - pv);
    const batFlow = +(pv - total).toFixed(2);

    data.push({
      time: time.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
      datetime: time.toISOString(),
      pvGeneration: +pv.toFixed(2),
      totalConsumption: +total.toFixed(2),
      climaConsumption: +clima.toFixed(2),
      gridDemand: +grid.toFixed(2),
      batteryFlow: batFlow,
      batteryLevel: +(40 + Math.random() * 40).toFixed(1),
      extTemperature: +(15 + Math.random() * 15).toFixed(1),
      extHumidity: +(35 + Math.random() * 40).toFixed(1),
      radiation: isDaytime ? +(100 + Math.random() * 800).toFixed(0) : 0,
      intTemperature: +(20 + Math.random() * 5).toFixed(1),
      intHumidity: +(45 + Math.random() * 20).toFixed(1),
      co2: +(380 + Math.random() * 700).toFixed(0),
    });
  }
  return data;
}
