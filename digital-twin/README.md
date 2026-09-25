# HARES Digital Twin

Gemelo digital jugable (fases 0–4), **separado** de los simuladores legacy en la raíz del repo.

## Abrir

Sirve la carpeta del repo (los módulos ES no cargan bien desde `file://` en algunos navegadores):

```bash
npx serve .
```

Luego abre: `/digital-twin/` o `/digital-twin/index.html`

## Controles

| Tecla | Acción |
|-------|--------|
| `1` / select | Control **HUMAN** — libre en pendientes/escombros; UGV+UAV autónomos |
| `2` | Control **UGV** |
| `3` | Control **UAV** (WASD + `Q`/`E` altura) |
| WASD | Movimiento del agente controlado |
| Cámara | Cicla ORBIT → THIRD_PERSON → FPV |
| Entrenar ML | SGD sobre samples grabados → DecisionNet FOLLOW/WAIT/DEPLOY |
| Export datos | JSONL + CSV + preview ROS + IndexedDB |

## Decisiones realistas (v3.1)

- UAV solo redespliega con **carga ≥ 98%** + **cooldown 10 s** tras aterrizar.
- UGV entra en **WAIT_GROUND** si no hay ruta o el desvío semántico es excesivo.
- A* usa costos del **mapa semántico** del UAV (`FLAT/SLOPE/RUBBLE/CLIFF…`).
- Modelos procedurales mejorados + carga opcional `assets/*.glb`.
- `DecisionNet` sugiere FOLLOW/WAIT/DEPLOY al Behavior Tree.


## Fases

| Carpeta | Contenido |
|---------|-----------|
| [phase0-base](phase0-base/) | Control multiagente, escenarios, MissionRecorder |
| [phase1-visual](phase1-visual/) | Polvo, sismo, FPV, atmósfera por escenario |
| [phase2-perception](phase2-perception/) | Reconstrucción heightmap/semántica + minimap |
| [phase3-ml](phase3-ml/) | Clasificador de acciones + política de umbrales |
| [phase4-bridge](phase4-bridge/) | Schema `hares.dt.v1` alineado a ROS 2 |

El código ejecutable vive en `shared/`; cada `phaseN-*` documenta el alcance. El entry único es `index.html`.

## Legacy

No modifica: `../simulator.html`, `../simulator3d.html`, `../hares-bt.js`.  
El cerebro se copia en `vendor/hares-bt.js`.
