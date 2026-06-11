# Reglas de Dominio Inmutables - TASF.B2B

Este documento describe las reglas operacionales que rigen el comportamiento del sistema. Cualquier modificación del código debe respetar estos principios para garantizar la integridad enterprise.

## 1. Source of Truth (Backend-Driven)
* El **Backend** es la única fuente de verdad operacional.
* El frontend **NUNCA** ejecuta lógica de simulación (movimiento de bultos, cálculo de rutas, generación de órdenes).
* Todos los estados operacionales provienen del backend vía API o Sockets.

## 2. Escenarios Operacionales Estrictos
El sistema solo soporta 3 tipos de escenarios. No se permiten escenarios custom o dinámicos:
1. **Operación Diaria (daily)**: 24h de operación nominal.
2. **Operación Periodo 5 Días (period_5d)**: Simulación de flujo multi-día.
3. **Operación hasta el Colapso (collapse)**: Estrés de red hasta saturación de nodos.

## 3. Arquitectura de Eventos (Real-time)
* El frontend debe ser reactivo a los eventos del servidor.
* La sincronización se realiza prioritariamente vía WebSockets a través del `SocketProvider`.
* El polling se mantiene únicamente como mecanismo de redundancia/fall-back.

## 4. Autenticación Enterprise
* Toda comunicación con el backend requiere un JWT válido.
* El refresco de tokens y la gestión de sesiones expiradas es gestionado por la capa de servicios (`api.ts`).

## 5. Visualización D3
* La capa de visualización debe estar desacoplada del ciclo de vida de React para optimizar el rendimiento.
* Se debe priorizar la estabilidad de las proyecciones y geometrías.
