import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

import { AuthProvider } from './providers/AuthProvider';
import { SocketProvider } from './providers/SocketProvider';
import { SimulationProvider } from './providers/SimulationProvider';
import { MonitoringProvider } from './providers/MonitoringProvider';
import { ToastProvider } from './providers/ToastProvider';
import { MapProvider } from './providers/MapProvider';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <MapProvider>
        <AuthProvider>
          <SocketProvider>
            <SimulationProvider>
              <MonitoringProvider>
                <App />
              </MonitoringProvider>
            </SimulationProvider>
          </SocketProvider>
        </AuthProvider>
      </MapProvider>
    </ToastProvider>
  </StrictMode>,
);
