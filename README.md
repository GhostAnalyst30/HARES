# Heterogeneous Adaptive Robotic Expedition System (HARES) 🤖🛸

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![ROS 2: Humble](https://img.shields.io/badge/ROS%202-Humble-blue)](https://docs.ros.org/en/humble/index.html)
[![AI: YOLOv8](https://img.shields.io/badge/AI-YOLOv8-green)](https://ultralytics.com/)
[![Simulation: 2D](https://img.shields.io/badge/Simulator-2D-orange)](./simulator.html)
[![Simulation: 3D](https://img.shields.io/badge/Simulator-3D-blue)](./simulator3d.html)

**HARES** es un ecosistema robótico heterogéneo diseñado para el seguimiento autónomo de personas en entornos complejos. El sistema combina la autonomía energética de un **Rover Madre (UGV)** con la agilidad táctica de un **Dron de Apoyo (UAV)**, utilizando inteligencia artificial y árboles de comportamiento para decidir dinámicamente cuándo cambiar de modalidad de locomoción.

---

## 🚀 Visión del Proyecto
El problema central de la robótica de expedición es la transitabilidad. Los UGVs son robustos pero se bloquean ante obstáculos; los UAVs son ágiles pero tienen batería limitada. **HARES** resuelve esto mediante **coordinación adaptativa**: el rover cambia de ruedas a patas en terreno difícil y solo desacopla el UAV cuando un score de necesidad supera una cota dinámica (sin ruta terrestre, desvío excesivo, contacto en riesgo y energía suficiente).

### Características Clave:
*   **Decisión Adaptativa:** Basada en mapas de transitabilidad física y semántica.
*   **Seguimiento Humano IA:** Detección y rastreo mediante YOLOv8/v10 optimizado para Edge Computing.
*   **Recuperación Autónoma:** Aterrizaje de precisión (*Precision Landing*) sobre plataforma móvil mediante marcadores ArUco.
*   **Arquitectura Distribuida:** Comunicación en tiempo real mediante ROS 2 Humble y Fast DDS.

---

## 🎮 Simuladores interactivos

### Digital Twin (v3 — fases 0–4)
Gemelo digital jugable en carpeta propia, **sin modificar** los sims legacy:

*   **[HARES Digital Twin](./digital-twin/)** — control HUMAN/UGV/UAV, escenarios (terremoto, ruinas, pantano…), reconstrucción 3D desde el UAV, clasificador de acciones, export JSONL/CSV para estudios.

Ver [digital-twin/README.md](./digital-twin/README.md). Abrir con `npx serve` → `/digital-twin/`.

### Legacy (v1/v2)
Los prototipos de navegador comparten el mismo cerebro (`hares-bt.js`): árbol a 10 Hz, locomoción **ruedas/patas**, umbral de despliegue **dinámico** (`need` vs `gate`) y replan A*.

*   **[Simulador táctico 2D](./simulator.html)** — vista superior, morph llantas→patas, path A*.
*   **[Simulador táctico 3D](./simulator3d.html)** — relieve (colinas, cresta, dunas), pendiente → \(T\), el mismo árbol.

**Controles (legacy):** `WASD` / flechas. En arena o pendiente el rover **frena las llantas y camina**. El dron no despega por un $T$ fijo: solo si `need > gate`. Forzar despegue/rendezvous sigue disponible; $E_{UAV}<20\%$ o $E_{UGV}<15\%$ dispara RTL.

Si el navegador bloquea scripts locales, sirve la carpeta (`npx serve`) y abre `/simulator.html` o `/digital-twin/`.

---

## 🛠️ Arquitectura Técnica (v2 Physical)

El proyecto está diseñado para ser implementado en hardware real utilizando:

| Plataforma | Hardware | Rol |
| :--- | :--- | :--- |
| **UGV (Rover)** | NVIDIA Jetson Orin Nano + Teensy 4.1 | Percepción pesada y control de motores. |
| **UAV (Dron)** | Pixhawk 6C + Raspberry Pi 4 | Vuelo autónomo y visión de precisión. |
| **Sensores** | RealSense D435i + RPLIDAR A3 | Mapeo 3D y SLAM. |
| **Software** | ROS 2 Humble + PX4 + Nav2 | Orquestación robótica modular. |

Para una guía detallada de construcción, consulta la [Guía de Implementación Física](./HARES_V2_PHYSICAL_GUIDE.md).

---

## 🔬 Impacto de la Investigación

### Pregunta Científica
> ¿Cómo puede un sistema robótico heterogéneo determinar dinámicamente cuándo abandonar una estrategia terrestre para desplegar un agente aéreo sin perder la continuidad de la misión?

> ¿Cómo pueden equipos de robots heterogéneos aprender continuamente cuándo desplegar, coordinar, retirar y reemplazar agentes según las condiciones físicas, energéticas y perceptuales del entorno?

### Impactos Esperados:
1.  **Búsqueda y Rescate:** Localización de personas en zonas de desastre inaccesibles para vehículos convencionales.
2.  **Agricultura de Precisión:** Monitoreo aéreo bajo demanda desde bases terrestres móviles.
3.  **Seguridad Industrial:** Patrullaje autónomo de perímetros con inspección aérea de puntos ciegos.

---

## 📂 Estructura del Repositorio
*   `HARES.md`: Documentación académica completa, estado del arte y formulación de hipótesis.
*   `hares-bt.js`: Cerebro compartido (Behavior Tree + A* + vector \(S_t\)).
*   `simulator.html`: Simulador interactivo 2D (HTML5/Canvas) — legacy.
*   `simulator3d.html`: Simulador interactivo 3D (Three.js) — legacy.
*   `digital-twin/`: Gemelo digital jugable (fases 0–4), separado del legacy.
*   `HARES_V2_PHYSICAL_GUIDE.md`: Manual de hardware y arquitectura de software ROS 2.
*   `hares_ws/`: (En desarrollo) Espacio de trabajo de ROS 2 para la implementación física.

---

## 🤝 Contribuir
Este proyecto es una iniciativa de investigación abierta. Si estás interesado en la robótica adaptativa, la IA en el borde o sistemas multiagente, ¡eres bienvenido!
---

**Desarrollado por [Emmanuel Ascendra]** - *Investigación en Sistemas Físicos Inteligentes.*
