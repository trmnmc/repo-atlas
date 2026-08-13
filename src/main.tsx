/**
 * main.tsx — the React root.
 *
 * Mounts <App /> into #root (declared in index.html) and pulls in the four
 * stylesheets that make up the Survey Folio: the frozen token/render
 * vocabulary first, then the three view sheets that build on it. tokens.css
 * is also <link>-ed from index.html so the pre-paint theme bootstrap has a
 * surface to paint; importing it here is what puts it in the built bundle.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles/tokens.css';
import './styles/overview.css';
import './styles/charts.css';
import './styles/detail.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Repo Atlas: #root is missing from index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
