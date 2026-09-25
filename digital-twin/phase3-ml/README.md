# Fase 3 — ML y clasificación de acciones

**Estado:** DecisionNet FOLLOW/WAIT/DEPLOY + clasificadores + SGD on-device.

## Alcance

- `DecisionNet` (softmax lineal) sugiere acción al BT vía `cfg.mlPrefer`
- Entrenamiento débil online + botón **Entrenar ML** sobre samples del recorder
- Pesos en `localStorage` (`hares_dt_decision_weights_v1`)
- Labels persona / UGV / UAV ampliados (WAIT, CHARGING, REQUEST_AIR)

## Módulos

- `../shared/ml/ml.js`
