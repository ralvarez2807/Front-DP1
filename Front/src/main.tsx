import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

import { AuthProvider } from './providers/AuthProvider';
import { SocketProvider } from './providers/SocketProvider';
import { SimulationProvider } from './providers/SimulationProvider';
import { MonitoringProvider } from './providers/MonitoringProvider';
import { OperationsProvider } from './providers/OperationsProvider';
import { BulkUploadProvider } from './providers/BulkUploadProvider';
import { ToastProvider } from './providers/ToastProvider';
import { MapProvider } from './providers/MapProvider';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <AuthProvider>
        <MapProvider>
          <SocketProvider>
            <SimulationProvider>
              <MonitoringProvider>
                <OperationsProvider>
                  <BulkUploadProvider>
                    <App />
                  </BulkUploadProvider>
                </OperationsProvider>
              </MonitoringProvider>
            </SimulationProvider>
          </SocketProvider>
        </MapProvider>
      </AuthProvider>
    </ToastProvider>
  </StrictMode>,
);
