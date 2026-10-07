import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Home from './pages/Home';
import Create from './pages/Create';
import Player from './pages/Player';
import Master from './pages/Master';
import TV from './pages/TV';
import '@fontsource-variable/archivo/wdth.css';
import '@fontsource-variable/geist';
import './styles.css';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/crear" element={<Create />} />
      <Route path="/p/:code" element={<Player />} />
      <Route path="/mc/:code" element={<Master />} />
      <Route path="/tv/:code" element={<TV />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  </BrowserRouter>
);
