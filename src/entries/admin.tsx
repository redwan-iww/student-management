import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { TabShell } from '../components/TabShell';
import { Admin } from '../apps/Admin';
import '../styles.css';

const host = document.getElementById('root');
if (!host) throw new Error('missing #root');

createRoot(host).render(
  <StrictMode>
    <TabShell title="Setup">
      <Admin />
    </TabShell>
  </StrictMode>,
);
