/**
 * Bootstrap del Digital Twin — orquesta world, agents, BT, percepción, ML, recorder.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { World } from '../world/World.js';
import { listScenarios } from '../world/scenarios.js';
import { DustSystem } from '../world/dust.js';
import {
  createHuman,
  createUgv,
  createUav,
  AgentController,
  CONTROL_MODES
} from '../agents/agents.js';
import { PerceptionSystem } from '../perception/perception.js';
import { ActionClassifier, FollowPolicy, extractFeatures, DecisionNet } from '../ml/ml.js';
import { MissionRecorder } from '../data/recorder.js';
import { sampleToRosBag, TELEMETRY_SCHEMA_VERSION } from '../data/schema.js';

const HARES_BT = window.HARES_BT;

export async function bootDigitalTwin(rootEl) {
  const viewport = rootEl.querySelector('#viewport');
  const hud = {
    log: (msg, type = 'info') => {
      const log = rootEl.querySelector('#consoleLog');
      if (!log) return;
      const entry = document.createElement('div');
      entry.className = 'log-entry ' + type;
      entry.textContent = '[' + new Date().toLocaleTimeString() + '] ' + msg;
      log.prepend(entry);
      while (log.children.length > 50) log.removeChild(log.lastChild);
    },
    set: (id, text, className) => {
      const el = rootEl.querySelector('#' + id);
      if (!el) return;
      el.textContent = text;
      if (className != null) el.className = className;
    }
  };

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 1200);
  camera.position.set(85, 72, 110);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  viewport.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 6, 8);

  scene.add(new THREE.HemisphereLight(0x9aa0a6, 0x1a120c, 0.62));
  const sun = new THREE.DirectionalLight(0xf2efe6, 0.95);
  sun.position.set(90, 140, 50);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 400;
  sun.shadow.camera.left = -120;
  sun.shadow.camera.right = 120;
  sun.shadow.camera.top = 120;
  sun.shadow.camera.bottom = -120;
  scene.add(sun);

  // FPV camera for UAV
  const fpvCamera = new THREE.PerspectiveCamera(75, 320 / 180, 0.1, 400);
  const fpvTarget = new THREE.WebGLRenderTarget(320, 180);
  const fpvCanvas = rootEl.querySelector('#fpvCanvas');
  const fpvCtx = fpvCanvas ? fpvCanvas.getContext('2d') : null;
  const fpvRead = new Uint8Array(320 * 180 * 4);
  const fpvImage = fpvCtx ? fpvCtx.createImageData(320, 180) : null;

  const world = new World(scene);
  world.loadScenario('slope');

  hud.log('Cargando modelos (GLB o procedural)…', 'info');
  const human = await createHuman(scene, world);
  const ugv = await createUgv(scene, world);
  const uav = await createUav(scene, world, ugv);
  const agents = new AgentController(world, human, ugv, uav);
  agents.bindKeys();

  const brain = HARES_BT.create({
    lookaheadStep: 7,
    lookaheadSteps: 6,
    hoverAlt: 14,
    landAlt: 2.1,
    rendezvousDist: 3.5,
    followDist: 16,
    waypointSkip: 5,
    pathCols: 36,
    pathRows: 28,
    tickHz: 10,
    batUavFull: 98,
    redeployCooldownSec: 10,
    maxDetour: 3.2
  });

  const perception = new PerceptionSystem(scene, world, uav);
  agents.setPerception(perception);
  perception.setOverlayVisible(true);
  const dust = new DustSystem(scene);
  const decisionNet = new DecisionNet();
  const classifier = new ActionClassifier(decisionNet);
  const policy = new FollowPolicy(decisionNet);
  const recorder = new MissionRecorder();

  let cameraMode = 'ORBIT'; // ORBIT | THIRD_PERSON | FPV
  let pathLine, wpMarker, lookSpheres;
  let clock = new THREE.Clock();
  let lastEventTag = '';

  // path viz
  {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(80 * 3), 3));
    geo.setDrawRange(0, 0);
    pathLine = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({ color: 0x7ad4e8, transparent: true, opacity: 0.7 })
    );
    scene.add(pathLine);
    wpMarker = new THREE.Mesh(
      new THREE.RingGeometry(0.7, 1.05, 20),
      new THREE.MeshBasicMaterial({
        color: 0x7ad4e8,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.85
      })
    );
    wpMarker.rotation.x = -Math.PI / 2;
    wpMarker.visible = false;
    scene.add(wpMarker);
    lookSpheres = [];
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Mesh(
        new THREE.SphereGeometry(0.45, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xeaeaea })
      );
      s.visible = false;
      scene.add(s);
      lookSpheres.push(s);
    }
  }

  function updatePathViz(decision) {
    const pos = pathLine.geometry.attributes.position;
    const path = decision.path || [];
    const n = Math.min(path.length, 80);
    for (let i = 0; i < n; i++) {
      pos.setXYZ(i, path[i].x, world.heightAt(path[i].x, path[i].y) + 0.55, path[i].y);
    }
    pathLine.geometry.setDrawRange(0, n);
    pos.needsUpdate = true;
    const wp = decision.intent.ugvWaypoint;
    if (wp && !decision.intent.holdUgv && path.length > 1) {
      wpMarker.visible = true;
      wpMarker.position.set(wp.x, world.heightAt(wp.x, wp.y) + 0.4, wp.y);
    } else wpMarker.visible = false;
    const samples = decision.lookahead || [];
    lookSpheres.forEach((s, i) => {
      if (samples[i]) {
        s.visible = true;
        s.position.set(samples[i].x, world.heightAt(samples[i].x, samples[i].y) + 0.7, samples[i].y);
        const T = samples[i].T;
        s.material.color.set(T < 0.4 ? 0xe61919 : T < 0.8 ? 0xd4a017 : 0xeaeaea);
      } else s.visible = false;
    });
  }

  function syncBt(tree) {
    const map = {
      emergency: 'bt-emergency',
      assess: 'bt-assess',
      ground: 'bt-ground',
      wait: 'bt-wait',
      aerial: 'bt-aerial',
      rendezvous: 'bt-rendezvous',
      land: 'bt-land'
    };
    tree.forEach((n) => {
      const el = rootEl.querySelector('#' + map[n.id]);
      if (!el) return;
      const st = n.status.toLowerCase();
      el.className = 'bt-node' + (st === 'idle' ? '' : ' ' + st);
    });
  }

  function riskClass(T) {
    if (T < 0.4) return 'tel-val red';
    if (T < 0.8) return 'tel-val amber';
    return 'tel-val';
  }

  function startMission() {
    recorder.start({
      scenario: world.scenarioId,
      controlMode: agents.controlMode,
      schema: TELEMETRY_SCHEMA_VERSION,
      phase: '0-3'
    });
    hud.log('Grabación de misión iniciada.', 'success');
  }

  function populateScenarioSelect() {
    const sel = rootEl.querySelector('#scenarioSelect');
    if (!sel) return;
    sel.innerHTML = '';
    listScenarios().forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.name;
      sel.appendChild(opt);
    });
    sel.value = world.scenarioId;
  }

  function wireUi() {
    populateScenarioSelect();
    rootEl.querySelector('#scenarioSelect')?.addEventListener('change', (e) => {
      world.loadScenario(e.target.value);
      agents.reset(world);
      brain.reset();
      perception.reset();
      hud.log('Escenario → ' + world.scenario.name, 'warn');
      if (recorder.active) {
        recorder.stop();
        startMission();
      }
    });
    rootEl.querySelector('#controlSelect')?.addEventListener('change', (e) => {
      agents.setControlMode(e.target.value);
      hud.log('Control → ' + agents.controlMode, 'info');
    });
    CONTROL_MODES.forEach((m) => {
      /* keep select in sync via animate */
    });
    rootEl.querySelector('#btn-deploy')?.addEventListener('click', () => {
      const r = brain.requestDeploy(agents.makeWorldState());
      hud.log('[ANULACION] ' + r.reason, r.ok ? 'warn' : 'error');
    });
    rootEl.querySelector('#btn-recall')?.addEventListener('click', () => {
      const r = brain.requestRecall();
      hud.log('[ANULACION] ' + r.reason, r.ok ? 'warn' : 'error');
    });
    rootEl.querySelector('#btn-cam')?.addEventListener('click', () => {
      if (cameraMode === 'ORBIT') cameraMode = 'THIRD_PERSON';
      else if (cameraMode === 'THIRD_PERSON') cameraMode = 'FPV';
      else cameraMode = 'ORBIT';
      controls.enabled = cameraMode === 'ORBIT';
      hud.log('Cámara: ' + cameraMode, 'info');
    });
    rootEl.querySelector('#btn-overlay')?.addEventListener('click', () => {
      perception.setOverlayVisible(!perception.overlayMesh.visible);
    });
    rootEl.querySelector('#btn-reset')?.addEventListener('click', () => {
      world.loadScenario(world.scenarioId);
      agents.reset(world);
      brain.reset();
      perception.reset();
      hud.log('MISIÓN REINICIADA.', 'warn');
    });
    rootEl.querySelector('#btn-record')?.addEventListener('click', () => {
      if (recorder.active) {
        recorder.stop();
        hud.log('Grabación detenida. Samples: ' + recorder.samples.length, 'warn');
      } else startMission();
    });
    rootEl.querySelector('#btn-export')?.addEventListener('click', async () => {
      if (!recorder.samples.length) {
        hud.log('Sin muestras para exportar.', 'error');
        return;
      }
      recorder.stop();
      recorder.exportAll();
      const last = recorder.samples[recorder.samples.length - 1];
      recorder.download(
        recorder.meta.id + '_rosbag_preview.json',
        JSON.stringify(sampleToRosBag(last), null, 2),
        'application/json'
      );
      try {
        await recorder.saveLocal();
        hud.log('Export JSONL/CSV + preview ROS + IndexedDB OK.', 'success');
      } catch (err) {
        hud.log('Export archivos OK (IndexedDB falló en este contexto).', 'warn');
      }
    });
    rootEl.querySelector('#btn-train')?.addEventListener('click', () => {
      const r = decisionNet.trainFromSamples(recorder.samples, 3);
      decisionNet.save();
      hud.log(
        'DecisionNet entrenado: ' + r.n + ' pasos · acumulado ' + decisionNet.trainedSamples,
        'success'
      );
    });
    rootEl.querySelector('#btn-quake')?.addEventListener('click', () => {
      world.shakeIntensity = 1;
      world.spawnRubble(human.position.x, human.position.z, 12);
      world.eventLog.push({ t: world.missionTime, type: 'manual_quake' });
      hud.log('Sismo manual: escombros cerca de la persona.', 'error');
    });
  }

  function updateUI(decision, gains, labels) {
    const bb = decision.blackboard;
    const intent = decision.intent;
    hud.set(
      'tel-mode',
      decision.mode,
      'tel-val ' +
        (decision.mode === 'EMERGENCY_RTL'
          ? 'red'
          : decision.mode === 'AERIAL_FOLLOW'
            ? 'blue'
            : decision.mode === 'FOLLOW_GROUND'
              ? ''
              : 'amber')
    );
    hud.set('tel-dock', intent.docked ? 'BLOQUEADO' : 'DESACOPLADO', 'tel-val ' + (intent.docked ? 'ok' : 'red'));
    hud.set(
      'tel-trans',
      bb.T_terreno.toFixed(2) + ' / ' + bb.T_fwd.toFixed(2),
      riskClass(Math.min(bb.T_terreno, bb.T_fwd))
    );
    hud.set('tel-bat-ugv', agents.batteries.ugv.toFixed(0) + '%');
    hud.set(
      'tel-bat-uav',
      agents.batteries.uav.toFixed(0) + '%',
      'tel-val ' + (agents.batteries.uav < 20 ? 'red' : agents.batteries.uav < 50 ? 'amber' : '')
    );
    hud.set('tel-cam', cameraMode);
    hud.set('tel-control', agents.controlMode);
    hud.set('tel-scenario', world.scenario.name);
    hud.set('tel-comms', world.commsOk ? 'OK' : 'PERDIDO', 'tel-val ' + (world.commsOk ? 'ok' : 'red'));
    hud.set('tel-recon', (perception.coverage() * 100).toFixed(0) + '%');
    const ready = bb.uav_ready;
    const charging = bb.uav_charging;
    hud.set(
      'tel-uavready',
      ready
        ? 'READY'
        : charging
          ? 'CHARGING ' + agents.batteries.uav.toFixed(0) + '%'
          : 'COOL ' + (bb.cooldown_s || 0).toFixed(1) + 's',
      'tel-val ' + (ready ? 'ok' : 'amber')
    );
    hud.set('tel-ugvact', bb.ugv_action || intent.ugvAction || '—');
    hud.set('tel-detour', (bb.detour != null ? Number(bb.detour).toFixed(1) : '—') + '×');
    hud.set('bb-d', bb.d_persona.toFixed(1) + ' m');
    hud.set('bb-t', bb.T_terreno.toFixed(2));
    hud.set('bb-e', bb.E_bateria.toFixed(2));
    hud.set('bb-r', bb.R_riesgo.toFixed(2));
    hud.set('bb-c', bb.C_comunicacion.toFixed(2));
    hud.set('bb-u', (bb.U_incertidumbre + world.uncertaintyBias()).toFixed(2));
    hud.set('decision-text', intent.reason);
    const loco = intent.locomotion || 'WHEEL';
    hud.set('tel-loco', loco === 'LEG' ? 'PATAS' : 'RUEDAS', 'tel-val ' + (loco === 'LEG' ? 'amber' : ''));
    const need = bb.deploy_need != null ? bb.deploy_need : 0;
    const gate = bb.deploy_gate != null ? bb.deploy_gate : 0.4;
    hud.set('tel-airscore', need.toFixed(2) + ' / ' + gate.toFixed(2), 'tel-val ' + (need > gate ? 'amber' : ''));
    hud.set('tel-policy', 'gateΔ ' + gains.deployGateBias.toFixed(2) + ' | ML ' + (gains.mlPrefer || '—'));
    hud.set(
      'tel-ml',
      labels.decision.label + ' · ' + labels.human.label + ' / ' + labels.ugv.label + ' / ' + labels.uav.label
    );
    hud.set('tel-ml-conf', labels.decision.confidence.toFixed(2));
    hud.set('tel-train', String(decisionNet.trainedSamples));
    const sum = recorder.summary();
    hud.set('tel-rec', recorder.active ? 'REC ' + recorder.samples.length : 'IDLE');
    hud.set('tel-tlost', sum.T_lost + ' s');
    hud.set('tel-dmax', sum.D_max + ' m');
    syncBt(decision.tree);

    const sel = rootEl.querySelector('#controlSelect');
    if (sel && sel.value !== agents.controlMode) sel.value = agents.controlMode;
  }

  function renderFpv() {
    if (!fpvCtx || !fpvImage) return;
    const look = new THREE.Vector3(
      uav.position.x,
      world.heightAt(uav.position.x, uav.position.z),
      uav.position.z + 8
    );
    fpvCamera.position.set(uav.position.x, uav.position.y - 0.15, uav.position.z);
    fpvCamera.lookAt(look);
    renderer.setRenderTarget(fpvTarget);
    renderer.render(scene, fpvCamera);
    renderer.readRenderTargetPixels(fpvTarget, 0, 0, 320, 180, fpvRead);
    renderer.setRenderTarget(null);
    // flip Y
    for (let y = 0; y < 180; y++) {
      for (let x = 0; x < 320; x++) {
        const src = ((179 - y) * 320 + x) * 4;
        const dst = (y * 320 + x) * 4;
        fpvImage.data[dst] = fpvRead[src];
        fpvImage.data[dst + 1] = fpvRead[src + 1];
        fpvImage.data[dst + 2] = fpvRead[src + 2];
        fpvImage.data[dst + 3] = 255;
      }
    }
    fpvCtx.putImageData(fpvImage, 0, 0);
  }

  function animate() {
    requestAnimationFrame(animate);
    const delta = Math.min(clock.getDelta(), 0.05);
    world.update(delta);

    agents.updateHuman(delta, agents.controlMode !== 'HUMAN');

    const hx0 = human.position.x;
    const hz0 = human.position.z;
    const humanSpeed0 =
      agents.controlMode === 'HUMAN' &&
      (agents.keys.KeyW || agents.keys.KeyA || agents.keys.KeyS || agents.keys.KeyD)
        ? 12
        : agents.controlMode !== 'HUMAN'
          ? 6
          : 0;
    const prev = agents.lastDecision;
    const prevBb = prev ? prev.blackboard : {};
    const features = extractFeatures({
      speed: humanSpeed0,
      T: world.getT(hx0, hz0),
      slope: world.slopeAt(hx0, hz0),
      dPersona: prevBb.d_persona || 0,
      battery: agents.batteries.uav,
      mode: prev ? prev.mode : 'FOLLOW_GROUND',
      deployNeed: prevBb.deploy_need || 0,
      deployGate: prevBb.deploy_gate || 0.4,
      docked: prev ? prev.intent.docked : true,
      airborne: prev ? !prev.intent.docked : false,
      uncertainty: prevBb.U_incertidumbre || 0,
      playerInput: humanSpeed0 > 0,
      detour: prevBb.detour || 0,
      uavReady: !!prevBb.uav_ready,
      reconCoverage: perception.coverage()
    });

    const gains = policy.step(brain, {
      dPersona: prevBb.d_persona || 0,
      controlMode: agents.controlMode,
      features
    });

    const decision = brain.tick(agents.makeWorldState());
    // inflate U with scenario bias for display/logging (BT already used raw world)
    if (decision.blackboard) {
      decision.blackboard.U_incertidumbre = Math.min(
        1,
        decision.blackboard.U_incertidumbre + world.uncertaintyBias() * 0.5
      );
    }
    agents.lastDecision = decision;
    if (decision.modeChanged) {
      const reason = '[HARES_BT] ' + decision.intent.reason;
      const type =
        decision.mode === 'EMERGENCY_RTL'
          ? 'error'
          : decision.mode === 'DEPLOY_UAV' || decision.mode === 'RENDEZVOUS' || decision.mode === 'WAIT_GROUND'
            ? 'warn'
            : 'info';
      hud.log(reason, type);
    }
    if (decision.intent.locomotion && decision.intent.locomotion !== agents.lastLoco) {
      agents.lastLoco = decision.intent.locomotion;
      hud.log(
        '[HARES_BT] Locomoción → ' + (agents.lastLoco === 'LEG' ? 'PATAS' : 'RUEDAS'),
        'warn'
      );
    }
    updatePathViz(decision);
    agents.applyBtMotion(decision, delta, gains);

    const airborne = !decision.intent.docked;
    perception.scan(delta, airborne);
    perception.drawMinimap(rootEl.querySelector('#minimap'), {
      human: { x: human.position.x, z: human.position.z },
      ugv: { x: ugv.position.x, z: ugv.position.z },
      uav: { x: uav.position.x, z: uav.position.z }
    });

    dust.update(
      delta,
      world.scenario.dust + world.dustBoost + world.shakeIntensity * 0.5,
      { x: human.position.x, z: human.position.z }
    );

    const hx = human.position.x;
    const hz = human.position.z;
    const humanSpeed = humanSpeed0;
    const featsNow = extractFeatures({
      speed: humanSpeed,
      T: world.getT(hx, hz),
      slope: world.slopeAt(hx, hz),
      dPersona: decision.blackboard.d_persona,
      battery: agents.batteries.uav,
      mode: decision.mode,
      deployNeed: decision.blackboard.deploy_need,
      deployGate: decision.blackboard.deploy_gate,
      docked: decision.intent.docked,
      airborne,
      uncertainty: decision.blackboard.U_incertidumbre,
      playerInput: agents.controlMode === 'HUMAN' && humanSpeed > 0,
      detour: decision.blackboard.detour,
      uavReady: decision.blackboard.uav_ready,
      reconCoverage: perception.coverage()
    });
    const labels = classifier.update({
      features: featsNow,
      trainOnline: true,
      decisionCtx: {
        detour: decision.blackboard.detour,
        deployNeed: decision.blackboard.deploy_need,
        deployGate: decision.blackboard.deploy_gate,
        uavReady: decision.blackboard.uav_ready,
        hasRoute: decision.blackboard.detour < 90
      },
      human: {
        speed: humanSpeed,
        T: world.getT(hx, hz),
        slope: world.slopeAt(hx, hz),
        dPersona: decision.blackboard.d_persona,
        controlMode: agents.controlMode,
        playerInput: humanSpeed > 0
      },
      ugv: {
        locomotion: decision.intent.locomotion,
        mode: decision.mode,
        ugvAction: decision.intent.ugvAction || decision.blackboard.ugv_action,
        replan: (decision.path || []).length > 2,
        holdUgv: decision.intent.holdUgv
      },
      uav: {
        docked: decision.intent.docked,
        charging: decision.blackboard.uav_charging,
        mode: decision.mode,
        scanning: airborne
      }
    });

    // event tag from world
    const ev = world.eventLog[world.eventLog.length - 1];
    let eventTag = '';
    if (ev && Math.abs(ev.t - world.missionTime) < 0.5) {
      eventTag = ev.type;
      if (eventTag !== lastEventTag) {
        hud.log('Evento escenario: ' + eventTag, 'error');
        lastEventTag = eventTag;
      }
    }

    const actionLabel = [
      labels.decision.label,
      labels.human.label,
      labels.ugv.label,
      labels.uav.label
    ].join('|');

    recorder.push(
      {
        t: performance.now(),
        scenario: world.scenarioId,
        controlMode: agents.controlMode,
        btMode: decision.mode,
        d_persona: decision.blackboard.d_persona,
        T_terreno: decision.blackboard.T_terreno,
        T_fwd: decision.blackboard.T_fwd,
        E_bateria: decision.blackboard.E_bateria,
        R_riesgo: decision.blackboard.R_riesgo,
        C_comunicacion: decision.blackboard.C_comunicacion,
        U_incertidumbre: decision.blackboard.U_incertidumbre,
        deploy_need: decision.blackboard.deploy_need,
        deploy_gate: decision.blackboard.deploy_gate,
        locomotion: decision.intent.locomotion,
        ugvBattery: agents.batteries.ugv,
        uavBattery: agents.batteries.uav,
        actionLabel,
        predLabel: labels.decision.label,
        confidence: labels.decision.confidence,
        decisionLabel: labels.decision.label,
        detour: decision.blackboard.detour,
        uav_ready: decision.blackboard.uav_ready,
        event: eventTag,
        commsOk: world.commsOk,
        reconCoverage: +perception.coverage().toFixed(3)
      },
      delta
    );

    updateUI(decision, gains, labels);

    // cameras
    const shake = world.getShakeOffset();
    if (cameraMode === 'THIRD_PERSON') {
      camera.position.set(
        human.position.x + shake.x,
        human.position.y + 14 + shake.y,
        human.position.z + 22
      );
      camera.lookAt(human.position.x, human.position.y + 1.4, human.position.z);
    } else if (cameraMode === 'FPV') {
      camera.position.set(uav.position.x + shake.x * 0.3, uav.position.y - 0.1, uav.position.z);
      camera.lookAt(
        uav.position.x,
        world.heightAt(uav.position.x, uav.position.z),
        uav.position.z + 10
      );
    } else {
      controls.target.x += shake.x * 0.15;
      controls.target.y += shake.y * 0.1;
    }
    controls.update();
    renderer.render(scene, camera);
    if (airborne || cameraMode === 'FPV') renderFpv();
  }

  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener('resize', onResize);

  wireUi();
  startMission();
  animate();

  // loader
  const bar = rootEl.querySelector('#loading-bar');
  const loader = rootEl.querySelector('#loader');
  if (bar && loader) {
    let w = 0;
    const boot = setInterval(() => {
      w += 14;
      bar.style.width = Math.min(w, 100) + '%';
      if (w >= 100) {
        clearInterval(boot);
        loader.style.display = 'none';
        hud.log('HARES Digital Twin READY — fases 0–4 activas.', 'success');
        hud.log('Controles: 1 HUMAN · 2 UGV · 3 UAV · WASD · Q/E altura UAV · Cámara cicla ORBIT/3P/FPV', 'info');
      }
    }, 70);
  }

  return { world, agents, brain, perception, recorder, classifier, policy };
}
