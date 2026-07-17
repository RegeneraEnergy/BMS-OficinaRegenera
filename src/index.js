import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';

// Inyecta el token JWT en todas las llamadas a la API automáticamente
const _fetch = window.fetch.bind(window);
window.fetch = (url, opts = {}) => {
  const token = localStorage.getItem('bms_token');
  if (token && typeof url === 'string' && url.includes('/api/') && !url.includes('/api/auth/')) {
    opts = { ...opts, headers: { Authorization: `Bearer ${token}`, ...opts.headers } };
  }
  return _fetch(url, opts);
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
