import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { TabShell } from '../components/TabShell';
import { ClassAllocation } from '../apps/ClassAllocation';
import '../styles.css';

// Outside a CRM frame there is no SDK, so dev supplies its own ZOHO global:
// the live adapter, when OAuth credentials are configured (real CRM reads and
// writes). Without them nothing is installed and TabShell says so -- there are
// no fixtures. Inside CRM the page is framed, so this never runs and the real
// SDK is left alone.
if (import.meta.env.DEV && window.self === window.top) {
  const { LIVE } = await import('virtual:zoho-mode');
  if (LIVE) {
    const { installLiveZoho } = await import('../zoho/live');
    installLiveZoho();
  }
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
