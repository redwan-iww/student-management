import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { TabShell } from '../components/TabShell';
import { ClassAllocation } from '../apps/ClassAllocation';
import '../styles.css';

if (import.meta.env.DEV && window.self === window.top) {
  const { installMockZoho } = await import('../zoho/mock');
  installMockZoho();
}

const host = document.getElementById('root');
if (!host) throw new Error('missing #root');

createRoot(host).render(
  <StrictMode>
    <TabShell title="Class Allocation">
      <ClassAllocation />
    </TabShell>
  </StrictMode>,
);
