# Fase 1 — Realismo y desastre

**Estado:** integrado en el runtime compartido.

## Alcance

- Atmósfera por escenario (fog, sky, dust)
- `DustSystem` de partículas
- Terremoto: shake de cámara, colapso de muros, escombros que mutan \(T\)
- Eventos `comms_drop` / `dust_storm`
- FPV UAV (`WebGLRenderTarget` → canvas)
- Botón **Sismo manual**

## Módulos

- `../shared/world/dust.js`
- Eventos en `../shared/world/scenarios.js` + `World.update`
- FPV en `../shared/app/main.js`
