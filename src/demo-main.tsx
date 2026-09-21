/**
 * demo-main.tsx — the React root for the hosted single-file demo.
 *
 * Same mount as main.tsx, with one step first: installDemoBackend swaps the
 * window's fetch and EventSource for an in-browser stand-in that serves
 * shared/demoSnapshot.js. It MUST run before render — useAtlas fetches on
 * mount and resolves EventSource lazily at the same moment.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { installDemoBackend } from './demo/demoBackend.ts';
import { App } from './App.tsx';
import './styles/tokens.css';
import './styles/overview.css';
import './styles/charts.css';
import './styles/detail.css';
import './styles/demo.css';

installDemoBackend(window);

const container = document.getElementById('root');
if (!container) {
  throw new Error('Repo Atlas: #root is missing from demo.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
