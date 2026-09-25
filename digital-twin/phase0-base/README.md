# Fase 0 — Base jugable

**Estado:** integrado en `../index.html` vía `../shared/`.

## Alcance

- Scaffold `digital-twin/` separado del legacy
- `controlMode`: HUMAN / UGV / UAV
- Escenarios estáticos: pendiente, ruinas, pantano, noche (+ terremoto base)
- `MissionRecorder` (JSONL / CSV / IndexedDB)
- Behavior Tree desde `../vendor/hares-bt.js`

## Módulos

- `../shared/agents/agents.js`
- `../shared/world/World.js` + `scenarios.js`
- `../shared/data/recorder.js`
- `../shared/app/main.js`
