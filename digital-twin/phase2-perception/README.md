# Fase 2 — Percepción y reconstrucción

**Estado:** integrado en el runtime compartido.

## Alcance

- Escaneo nadir desde el UAV (raycast proxy)
- Heightmap + semántica: `FLAT | SLOPE | CLIFF | RUBBLE | SAND | WATER`
- Overlay 3D de reconstrucción (colormap \(T\))
- Minimap 2D con cobertura y agentes
- Métrica `reconCoverage` en telemetría

## Módulos

- `../shared/perception/perception.js`
