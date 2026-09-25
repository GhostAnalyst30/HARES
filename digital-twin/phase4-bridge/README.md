# Fase 4 — Puente físico / ROS 2

**Estado:** schema y export preview listos.

## Alcance

- Schema de telemetría `hares.dt.v1`
- Mapa conceptual a topics ROS 2 (`/hares/...`)
- Al exportar misión se genera `*_rosbag_preview.json` con un sample en forma de mensaje

## Módulos

- `../shared/data/schema.js`
- Hook de export en `../shared/app/main.js`

## Topics previstos

Ver `ROS_TOPIC_MAP` en `schema.js`. Cuando exista `hares_ws/`, publicar el mismo shape desde nodos C++/Python.
