import React, { useState, useEffect, useCallback } from 'react';
import './App.css';
import Header from './components/Header';
import StatsBar from './components/StatsBar';
import EnergyFlow from './components/EnergyFlow';
import HistoricalData from './components/HistoricalData';
import { generateRealTimeData } from './data/mockData';

const REFRESH_INTERVAL = 10000; // 10 segundos
const API_BASE = 'http://localhost:3001';

async function fetchLive() {
  const res = await fetch(`${API_BASE}/api/live`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();

  // Para campos sin sensor real, complementar con valores simulados
  const mock = generateRealTimeData();
  return {
    ...data,
    exterior: {
      temperature: data.exterior?.temperature ?? mock.exterior.temperature,
      humidity:    data.exterior?.humidity    ?? mock.exterior.humidity,
      radiation:   data.exterior?.radiation   ?? mock.exterior.radiation,
    },
    interior: {
      temperature: data.interior?.temperature ?? mock.interior.temperature,
      humidity:    data.interior?.humidity    ?? mock.interior.humidity,
      co2:         data.interior?.co2         ?? mock.interior.co2,
    },
  };
}

export default function App() {
  const [liveData, setLiveData]   = useState(null);
  const [apiStatus, setApiStatus] = useState('connecting');

  const refreshLive = useCallback(async () => {
    try {
      const data = await fetchLive();
      setLiveData(data);
      setApiStatus('live');
    } catch {
      setLiveData(generateRealTimeData());
      setApiStatus('mock');
    }
  }, []);

  useEffect(() => {
    refreshLive();
    const interval = setInterval(refreshLive, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [refreshLive]);

  return (
    <div className="app">
      <Header lastUpdate={liveData?.timestamp} apiStatus={apiStatus} />
      <main className="main-content">
        <StatsBar data={liveData} />
        <EnergyFlow data={liveData} />
        <HistoricalData />
      </main>
      <footer className="footer">
        <span>Regenera Levante © {new Date().getFullYear()}</span>
        <span className="footer-sep">·</span>
        <span>Plataforma de Monitorización Energética</span>
        <span className="footer-sep">·</span>
        <span className="footer-update">Actualización automática cada {REFRESH_INTERVAL / 1000}s</span>
      </footer>
    </div>
  );
}
