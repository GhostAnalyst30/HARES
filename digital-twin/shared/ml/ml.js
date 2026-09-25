/**
 * Clasificador de acciones + red de decisión FOLLOW/WAIT/DEPLOY + entrenamiento SGD.
 */
const HUMAN_ACTIONS = ['IDLE', 'WALK', 'CLIMB', 'ENTER_HAZARD', 'FALLBACK'];
const UGV_ACTIONS = ['FOLLOW_WHEEL', 'FOLLOW_LEG', 'REPLAN', 'WAIT', 'RENDEZVOUS', 'REQUEST_AIR'];
const UAV_ACTIONS = ['DOCKED', 'CHARGING', 'TAKEOFF', 'AERIAL_TRACK', 'SCAN_TERRAIN', 'LAND', 'RTL'];
const DECISION_ACTIONS = ['FOLLOW', 'WAIT', 'DEPLOY'];

const WEIGHTS_KEY = 'hares_dt_decision_weights_v1';

function softmax(logits) {
  const max = Math.max(...logits);
  const exps = logits.map((v) => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

function argmax(arr) {
  let i = 0;
  for (let k = 1; k < arr.length; k++) if (arr[k] > arr[i]) i = k;
  return i;
}

export function extractFeatures(ctx) {
  const {
    speed, T, slope, dPersona, battery, mode, deployNeed, deployGate,
    docked, airborne, uncertainty, playerInput, detour, uavReady, reconCoverage
  } = ctx;
  return [
    Math.min(1, (speed || 0) / 20),
    T || 0,
    Math.min(1, slope || 0),
    Math.min(1, (dPersona || 0) / 80),
    (battery || 0) / 100,
    mode === 'FOLLOW_GROUND' ? 1 : 0,
    mode === 'WAIT_GROUND' ? 1 : 0,
    mode === 'AERIAL_FOLLOW' ? 1 : 0,
    mode === 'DEPLOY_UAV' ? 1 : 0,
    mode === 'EMERGENCY_RTL' ? 1 : 0,
    deployNeed || 0,
    deployGate || 0.4,
    docked ? 1 : 0,
    airborne ? 1 : 0,
    uncertainty || 0,
    playerInput ? 1 : 0,
    Math.min(1, (detour || 0) / 8),
    uavReady ? 1 : 0,
    reconCoverage || 0
  ];
}

function defaultWeights(nIn, nOut) {
  const W = [];
  for (let o = 0; o < nOut; o++) {
    const row = [];
    for (let i = 0; i < nIn; i++) row.push((Math.random() - 0.5) * 0.15);
    W.push(row);
  }
  const b = new Array(nOut).fill(0);
  // inductive bias: FOLLOW from low detour, WAIT from high detour, DEPLOY from need+ready
  W[0][16] = -1.2; // detour → not FOLLOW
  W[1][16] = 1.8; // detour → WAIT
  W[2][10] = 1.5; // deployNeed → DEPLOY
  W[2][17] = 2.0; // uavReady → DEPLOY
  W[1][17] = -0.8;
  W[0][17] = 0.4;
  return { W, b };
}

/**
 * Softmax lineal entrenable: decide FOLLOW | WAIT | DEPLOY.
 */
export class DecisionNet {
  constructor() {
    this.nIn = 19;
    this.nOut = 3;
    this.lr = 0.08;
    this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(WEIGHTS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.W && parsed.b && parsed.W.length === this.nOut) {
          this.W = parsed.W;
          this.b = parsed.b;
          this.trainedSamples = parsed.trainedSamples || 0;
          return;
        }
      }
    } catch (_) {}
    const init = defaultWeights(this.nIn, this.nOut);
    this.W = init.W;
    this.b = init.b;
    this.trainedSamples = 0;
  }

  save() {
    try {
      localStorage.setItem(
        WEIGHTS_KEY,
        JSON.stringify({ W: this.W, b: this.b, trainedSamples: this.trainedSamples })
      );
    } catch (_) {}
  }

  logits(x) {
    const out = [];
    for (let o = 0; o < this.nOut; o++) {
      let s = this.b[o];
      for (let i = 0; i < this.nIn; i++) s += this.W[o][i] * (x[i] || 0);
      out.push(s);
    }
    return out;
  }

  predict(features) {
    const p = softmax(this.logits(features));
    const i = argmax(p);
    return { label: DECISION_ACTIONS[i], confidence: +p[i].toFixed(3), probs: p, index: i };
  }

  /** Un paso SGD con etiqueta débil o ground-truth. */
  trainOne(features, labelIndex) {
    const p = softmax(this.logits(features));
    for (let o = 0; o < this.nOut; o++) {
      const err = p[o] - (o === labelIndex ? 1 : 0);
      this.b[o] -= this.lr * err;
      for (let i = 0; i < this.nIn; i++) {
        this.W[o][i] -= this.lr * err * (features[i] || 0);
      }
    }
    this.trainedSamples += 1;
  }

  /**
   * Etiqueta débil desde variables naturales/temporales/espaciales (para bootstrap).
   */
  weakLabel(ctx) {
    const detour = ctx.detour || 0;
    const need = ctx.deployNeed || 0;
    const gate = ctx.deployGate || 0.4;
    const ready = !!ctx.uavReady;
    if (ready && need > gate) return 2; // DEPLOY
    if (detour > 3.2 || !ctx.hasRoute) return 1; // WAIT
    return 0; // FOLLOW
  }

  /** Entrena desde samples del MissionRecorder (JSONL-like objects). */
  trainFromSamples(samples, epochs = 2) {
    if (!samples || !samples.length) return { n: 0 };
    let n = 0;
    for (let e = 0; e < epochs; e++) {
      for (const s of samples) {
        const feats = extractFeatures({
          speed: 0,
          T: s.T_terreno,
          slope: 0,
          dPersona: s.d_persona,
          battery: s.uavBattery,
          mode: s.btMode,
          deployNeed: s.deploy_need,
          deployGate: s.deploy_gate,
          docked: s.btMode === 'FOLLOW_GROUND' || s.btMode === 'WAIT_GROUND',
          airborne: s.btMode === 'AERIAL_FOLLOW' || s.btMode === 'DEPLOY_UAV',
          uncertainty: s.U_incertidumbre,
          playerInput: false,
          detour: s.detour,
          uavReady: s.uav_ready,
          reconCoverage: s.reconCoverage
        });
        let yi = DECISION_ACTIONS.indexOf(s.decisionLabel);
        if (yi < 0) {
          yi = this.weakLabel({
            detour: s.detour,
            deployNeed: s.deploy_need,
            deployGate: s.deploy_gate,
            uavReady: s.uav_ready,
            hasRoute: s.detour < 90
          });
        }
        this.trainOne(feats, yi);
        n += 1;
      }
    }
    this.save();
    return { n, trainedSamples: this.trainedSamples };
  }
}

export class ActionClassifier {
  constructor(decisionNet) {
    this.decisionNet = decisionNet || new DecisionNet();
    this.last = {
      human: { label: 'IDLE', confidence: 1 },
      ugv: { label: 'FOLLOW_WHEEL', confidence: 1 },
      uav: { label: 'DOCKED', confidence: 1 },
      decision: { label: 'FOLLOW', confidence: 1 }
    };
  }

  classifyHuman(extras) {
    const logits = [0, 0, 0, 0, 0];
    if (extras.speed < 0.4) logits[0] += 2.5;
    else logits[1] += 2.2;
    if (extras.slope > 0.35 && extras.speed > 0.5) logits[2] += 2.4;
    if (extras.T < 0.35) logits[3] += 2.6;
    if (extras.dPersona > 50 && extras.controlMode !== 'HUMAN') logits[4] += 1.5;
    if (extras.playerInput) logits[1] += 0.8;
    const p = softmax(logits);
    const i = argmax(p);
    return { label: HUMAN_ACTIONS[i], confidence: +p[i].toFixed(3), probs: p };
  }

  classifyUgv(extras) {
    const logits = [0, 0, 0, 0, 0, 0];
    const act = extras.ugvAction || '';
    if (act === 'WAIT' || extras.mode === 'WAIT_GROUND') logits[3] += 3;
    else if (act === 'REQUEST_AIR') logits[5] += 3;
    else if (act === 'RENDEZVOUS' || extras.mode === 'RENDEZVOUS' || extras.mode === 'LAND_DOCK') logits[4] += 2.6;
    else if (extras.locomotion === 'LEG') logits[1] += 2.5;
    else logits[0] += 2.2;
    if (extras.replan) logits[2] += 1.5;
    const p = softmax(logits);
    const i = argmax(p);
    return { label: UGV_ACTIONS[i], confidence: +p[i].toFixed(3), probs: p };
  }

  classifyUav(extras) {
    const logits = [0, 0, 0, 0, 0, 0, 0];
    if (extras.charging) logits[1] += 3;
    else if (extras.docked) logits[0] += 3;
    if (extras.mode === 'DEPLOY_UAV') logits[2] += 2.8;
    if (extras.mode === 'AERIAL_FOLLOW') logits[3] += 2.5;
    if (extras.scanning) logits[4] += 2.2;
    if (extras.mode === 'LAND_DOCK' || extras.mode === 'RENDEZVOUS') logits[5] += 2.6;
    if (extras.mode === 'EMERGENCY_RTL') logits[6] += 3;
    const p = softmax(logits);
    const i = argmax(p);
    return { label: UAV_ACTIONS[i], confidence: +p[i].toFixed(3), probs: p };
  }

  update(bundle) {
    this.last.human = this.classifyHuman(bundle.human);
    this.last.ugv = this.classifyUgv(bundle.ugv);
    this.last.uav = this.classifyUav(bundle.uav);
    const feats = bundle.features || extractFeatures(bundle.human);
    this.last.decision = this.decisionNet.predict(feats);
    // online weak supervision each tick (slow lr effect via occasional train)
    if (bundle.trainOnline && Math.random() < 0.05) {
      const yi = this.decisionNet.weakLabel(bundle.decisionCtx || {});
      this.decisionNet.trainOne(feats, yi);
    }
    return this.last;
  }
}

export class FollowPolicy {
  constructor(decisionNet) {
    this.deployGateBias = 0;
    this.ugvSpeed = 1;
    this.uavSpeed = 1;
    this._emaLost = 0;
    this.decisionNet = decisionNet || null;
    this.lastDecision = 'FOLLOW';
  }

  step(brain, ctx) {
    const lost = ctx.dPersona > 35 ? 1 : 0;
    this._emaLost = this._emaLost * 0.95 + lost * 0.05;

    if (ctx.controlMode === 'HUMAN') {
      if (this._emaLost > 0.25) this.deployGateBias = Math.max(-0.12, this.deployGateBias - 0.01);
      else this.deployGateBias = Math.min(0.08, this.deployGateBias + 0.004);
      this.ugvSpeed = 1 + Math.min(0.25, this._emaLost * 0.4);
      this.uavSpeed = 1 + Math.min(0.3, this._emaLost * 0.5);
    } else {
      this.deployGateBias *= 0.98;
      this.ugvSpeed = 1;
      this.uavSpeed = 1;
    }

    let mlPrefer = null;
    if (this.decisionNet && ctx.features) {
      const pred = this.decisionNet.predict(ctx.features);
      this.lastDecision = pred.label;
      if (pred.confidence > 0.45) mlPrefer = pred.label;
    }

    if (brain && brain.cfg) {
      brain.cfg.deployGateBias = this.deployGateBias;
      brain.cfg.mlPrefer = mlPrefer;
    }

    return {
      ugvSpeed: this.ugvSpeed,
      uavSpeed: this.uavSpeed,
      deployGateBias: this.deployGateBias,
      emaLost: this._emaLost,
      mlPrefer: mlPrefer || '—'
    };
  }
}

export { HUMAN_ACTIONS, UGV_ACTIONS, UAV_ACTIONS, DECISION_ACTIONS };
