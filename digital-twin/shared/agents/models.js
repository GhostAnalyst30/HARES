/**
 * Modelos procedurales mejorados + carga opcional GLB vía GLTFLoader.
 * Si existen assets/*.glb se usan; si no, fallback detallado.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();

async function tryLoadGlb(url) {
  try {
    const gltf = await loader.loadAsync(url);
    const root = gltf.scene;
    root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    return root;
  } catch (_) {
    return null;
  }
}

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness != null ? opts.roughness : 0.65,
    metalness: opts.metalness != null ? opts.metalness : 0.15,
    emissive: opts.emissive || 0x000000,
    emissiveIntensity: opts.emissiveIntensity || 0
  });
}

/** Persona humanoid low-poly (cabeza, torso, brazos, piernas). */
export function buildHumanProcedural() {
  const g = new THREE.Group();
  const skin = mat(0xc4a882, { roughness: 0.85, metalness: 0.02 });
  const suit = mat(0x2a3d2e, { roughness: 0.7 });
  const accent = mat(0x4af626, { emissive: 0x0d3a0d, emissiveIntensity: 0.35, roughness: 0.5 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.75, 0.32), suit);
  torso.position.y = 1.35;
  torso.castShadow = true;

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), skin);
  head.position.y = 1.95;
  head.castShadow = true;

  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.45, 0.18), accent);
  pack.position.set(0, 1.4, -0.22);

  const armL = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.45, 4, 6), suit);
  armL.position.set(-0.42, 1.25, 0);
  const armR = armL.clone();
  armR.position.x = 0.42;

  const legL = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.55, 4, 6), suit);
  legL.position.set(-0.16, 0.55, 0);
  const legR = legL.clone();
  legR.position.x = 0.16;

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.85, 0.03, 8, 28),
    new THREE.MeshBasicMaterial({ color: 0x4af626, transparent: true, opacity: 0.4 })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.05;

  const light = new THREE.PointLight(0x4af626, 0.45, 14);
  light.position.y = 2.1;

  g.add(torso, head, pack, armL, armR, legL, legR, ring, light);
  g.userData.ring = ring;
  g.userData.limbs = { armL, armR, legL, legR };
  return g;
}

/** Rover Madre detallado: chasis, pad ArUco, antenas, módulos rueda/pata. */
export function buildUgvProcedural() {
  var rover = new THREE.Group();
  const bodyM = mat(0x1c2a2e, { roughness: 0.5, metalness: 0.35 });
  const accentM = mat(0x7ad4e8, { emissive: 0x12343a, emissiveIntensity: 0.35, metalness: 0.4 });
  const darkM = mat(0x111111, { roughness: 0.9 });

  const chassis = new THREE.Mesh(new THREE.BoxGeometry(3.8, 1.0, 5.6), bodyM);
  chassis.position.y = 1.1;
  chassis.castShadow = true;

  const nose = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.55, 1.2), bodyM);
  nose.position.set(0, 1.15, 2.6);

  const stripe = new THREE.Mesh(new THREE.BoxGeometry(3.82, 0.1, 5.62), accentM);
  stripe.position.y = 1.62;

  const pad = new THREE.Mesh(
    new THREE.CircleGeometry(1.2, 32),
    new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.4, metalness: 0.1, side: THREE.DoubleSide })
  );
  pad.rotation.x = -Math.PI / 2;
  pad.position.y = 1.72;

  const aruco = new THREE.Group();
  const base = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  base.rotation.x = -Math.PI / 2;
  base.position.y = 1.73;
  const ink = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.55), new THREE.MeshBasicMaterial({ color: 0x111111 }));
  ink.rotation.x = -Math.PI / 2;
  ink.position.y = 1.74;
  aruco.add(base, ink);

  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.4, 8), darkM);
  mast.position.set(-1.2, 2.2, -1.8);
  const dish = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), accentM);
  dish.position.set(-1.2, 2.9, -1.8);
  dish.rotation.x = Math.PI;

  const cam = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.22, 0.28), darkM);
  cam.position.set(0, 1.55, 3.1);

  const wheelG = new THREE.CylinderGeometry(0.48, 0.48, 0.42, 14);
  const wheelM = mat(0x1a1a1a, { roughness: 0.95, metalness: 0.05 });
  const legM = mat(0xd4a017, { emissive: 0x3a2808, emissiveIntensity: 0.3, metalness: 0.25 });
  const modules = [];
  const corners = [
    { x: -1.7, z: 1.85, ph: 0 },
    { x: 1.7, z: 1.85, ph: 1.7 },
    { x: -1.7, z: -1.85, ph: 3.2 },
    { x: 1.7, z: -1.85, ph: 4.8 }
  ];
  corners.forEach((c) => {
    const mod = new THREE.Group();
    mod.position.set(c.x, 0.48, c.z);
    const wh = new THREE.Mesh(wheelG, wheelM);
    wh.rotation.z = Math.PI / 2;
    wh.castShadow = true;
    const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.2, 0.18), legM);
    thigh.position.y = -0.15;
    thigh.visible = false;
    const shin = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.05, 0.14), legM);
    shin.position.y = -1.05;
    shin.visible = false;
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.1, 0.5), legM);
    foot.position.y = -1.55;
    foot.visible = false;
    mod.add(wh, thigh, shin, foot);
    rover.add(mod);
    modules.push({ group: mod, wheel: wh, thigh, shin, foot, phase: c.ph });
  });

  rover.add(chassis, nose, stripe, pad, aruco, mast, dish, cam);
  rover.userData.modules = modules;
  return rover;
}

/** Quadrotor con gimbal, luces nav y patas. */
export function buildUavProcedural() {
  const drone = new THREE.Group();
  const hubM = mat(0x1e1e1e, { metalness: 0.55, roughness: 0.35 });
  const armM = mat(0xd4a017, { metalness: 0.4, roughness: 0.4 });
  const tipRed = mat(0xe61919, { emissive: 0x880000, emissiveIntensity: 0.6 });
  const tipGrn = mat(0x4af626, { emissive: 0x0a3a0a, emissiveIntensity: 0.6 });

  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.22, 10), hubM);
  drone.add(hub);
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.5), hubM);
  top.position.y = 0.14;
  drone.add(top);

  const rotors = [];
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.07, 0.1), armM);
    arm.rotation.y = a;
    drone.add(arm);
    const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.1, 8), hubM);
    motor.position.set(Math.cos(a) * 1.2, 0.08, Math.sin(a) * 1.2);
    drone.add(motor);
    const rotor = new THREE.Mesh(
      new THREE.CylinderGeometry(0.58, 0.58, 0.03, 20),
      new THREE.MeshBasicMaterial({ color: 0xdddddd, transparent: true, opacity: 0.32 })
    );
    rotor.position.set(Math.cos(a) * 1.2, 0.14, Math.sin(a) * 1.2);
    drone.add(rotor);
    rotors.push(rotor);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), i % 2 === 0 ? tipRed : tipGrn);
    tip.position.set(Math.cos(a) * 1.35, 0.05, Math.sin(a) * 1.35);
    drone.add(tip);
  }

  const cam = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.28), hubM);
  cam.position.set(0, -0.22, 0.2);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.08, 10), mat(0x111122, { metalness: 0.8 }));
  lens.rotation.x = Math.PI / 2;
  lens.position.set(0, -0.22, 0.38);
  drone.add(cam, lens);

  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.35, 6), armM);
    leg.position.set(Math.cos(a) * 0.35, -0.28, Math.sin(a) * 0.35);
    leg.rotation.z = Math.cos(a) * 0.35;
    leg.rotation.x = Math.sin(a) * 0.35;
    drone.add(leg);
  }

  drone.userData.rotors = rotors;
  drone.userData.camNode = cam;
  return drone;
}

export async function createHuman(scene, world) {
  let g = await tryLoadGlb('./assets/human.glb');
  if (g) {
    g.scale.setScalar(1);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.9, 0.03, 8, 24),
      new THREE.MeshBasicMaterial({ color: 0x4af626, transparent: true, opacity: 0.35 })
    );
    ring.rotation.x = Math.PI / 2;
    g.add(ring);
    g.userData.ring = ring;
  } else {
    g = buildHumanProcedural();
  }
  g.position.set(0, world.heightAt(0, -42), -42);
  scene.add(g);
  return g;
}

export async function createUgv(scene, world) {
  let rover = await tryLoadGlb('./assets/ugv.glb');
  if (rover) {
    // ensure modules stub for leg morph
    if (!rover.userData.modules) rover.userData.modules = [];
  } else {
    rover = buildUgvProcedural();
  }
  rover.position.set(10, world.heightAt(10, 52), 52);
  scene.add(rover);
  return rover;
}

export async function createUav(scene, world, ugv) {
  let drone = await tryLoadGlb('./assets/uav.glb');
  if (!drone) drone = buildUavProcedural();
  if (!drone.userData.rotors) drone.userData.rotors = [];
  drone.position.copy(ugv.position);
  drone.position.y = world.heightAt(ugv.position.x, ugv.position.z) + 1.75;
  scene.add(drone);
  return drone;
}
