/**
 * Agentes: control + movimiento. Geometría en models.js.
 */
import * as THREE from 'three';
import { createHuman, createUgv, createUav } from './models.js';

export { createHuman, createUgv, createUav };
export const CONTROL_MODES = ['HUMAN', 'UGV', 'UAV'];

export class AgentController {
  constructor(world, human, ugv, uav) {
    this.world = world;
    this.human = human;
    this.ugv = ugv;
    this.uav = uav;
    this.keys = {};
    this.controlMode = 'HUMAN';
    this.ugvHeading = Math.atan2(-42 - 52, 0 - 10);
    this.legMorph = 0;
    this.lastLoco = 'WHEEL';
    this.ugvMoving = false;
    this.batteries = { ugv: 100, uav: 100 };
    this.lastDecision = null;
    this.manualUavAlt = 14;
    this.perception = null;
  }

  setPerception(perception) {
    this.perception = perception;
  }

  setControlMode(mode) {
    if (CONTROL_MODES.includes(mode)) this.controlMode = mode;
  }

  bindKeys() {
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (e.code === 'Digit1') this.setControlMode('HUMAN');
      if (e.code === 'Digit2') this.setControlMode('UGV');
      if (e.code === 'Digit3') this.setControlMode('UAV');
    });
    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });
  }

  moveOnXZ(obj, tx, tz, speed, delta, radius, stayOnSafe) {
    const dx = tx - obj.position.x;
    const dz = tz - obj.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.15) return false;
    const step = Math.min(speed * delta, d);
    const nx = obj.position.x + (dx / d) * step;
    const nz = obj.position.z + (dz / d) * step;
    if (this.world.isSolidXZ(nx, nz, radius)) return false;
    const nextT = this.world.getT(nx, nz);
    const curT = this.world.getT(obj.position.x, obj.position.z);
    if (stayOnSafe && nextT < 0.16 && nextT <= curT) return false;
    obj.position.x = nx;
    obj.position.z = nz;
    obj.lookAt(obj.position.x + dx, obj.position.y, obj.position.z + dz);
    obj.position.y = this.world.heightAt(obj.position.x, obj.position.z);
    return true;
  }

  applyManualXZ(obj, speed, delta, radius, stayOnSafe, humanClimb) {
    const move = new THREE.Vector3();
    if (this.keys.KeyW || this.keys.ArrowUp) move.z -= 1;
    if (this.keys.KeyS || this.keys.ArrowDown) move.z += 1;
    if (this.keys.KeyA || this.keys.ArrowLeft) move.x -= 1;
    if (this.keys.KeyD || this.keys.ArrowRight) move.x += 1;
    if (move.length() === 0) return false;
    move.normalize().multiplyScalar(speed * delta);
    const tryAxis = (nx, nz) => {
      // humano: puede pasar cerca de sólidos con radio menor y subir pendientes
      const pad = humanClimb ? Math.max(0.4, radius * 0.55) : radius;
      if (this.world.isSolidXZ(nx, nz, pad)) {
        if (!humanClimb) return false;
        // humano trepa: solo bloquea CLIFF extremo (T=0 y slope alta)
        if (this.world.isCliff(nx, nz) && this.world.slopeAt(nx, nz) > 1.5) return false;
        // paredes: bloquea
        for (const s of this.world.solids) {
          if (s.collapsed) continue;
          if (this.world.xzIn(nx, nz, s, 0.2)) return false;
        }
      }
      if (stayOnSafe) {
        const nextT = this.world.getT(nx, nz);
        const curT = this.world.getT(obj.position.x, obj.position.z);
        if (nextT < 0.16 && nextT <= curT) return false;
      }
      return true;
    };
    let moved = false;
    const nx = obj.position.x + move.x;
    const nz = obj.position.z + move.z;
    if (tryAxis(nx, obj.position.z)) {
      obj.position.x = THREE.MathUtils.clamp(nx, -130, 130);
      moved = true;
    }
    if (tryAxis(obj.position.x, nz)) {
      obj.position.z = THREE.MathUtils.clamp(nz, -130, 130);
      moved = true;
    }
    obj.position.y = this.world.heightAt(obj.position.x, obj.position.z);
    return moved;
  }

  updateHuman(delta, autonomousWander) {
    if (this.controlMode === 'HUMAN') {
      // humano libre en terrenos difíciles (sin stayOnSafe)
      this.applyManualXZ(this.human, 15, delta, 1.0, false, true);
    } else if (autonomousWander) {
      const t = performance.now() / 3000;
      const tx = Math.sin(t) * 40;
      const tz = -20 + Math.cos(t * 0.7) * 30;
      this.moveOnXZ(this.human, tx, tz, 6, delta, 0.8, false);
    }
    this.human.position.y = this.world.heightAt(this.human.position.x, this.human.position.z);
    const ring = this.human.userData.ring;
    if (ring) {
      const s = 1 + Math.sin(performance.now() / 180) * 0.12;
      ring.scale.set(s, s, s);
    }
    const limbs = this.human.userData.limbs;
    if (limbs && this.controlMode === 'HUMAN') {
      const moving =
        this.keys.KeyW || this.keys.KeyA || this.keys.KeyS || this.keys.KeyD;
      if (moving) {
        const g = Math.sin(performance.now() / 120);
        limbs.legL.rotation.x = g * 0.45;
        limbs.legR.rotation.x = -g * 0.45;
        limbs.armL.rotation.x = -g * 0.35;
        limbs.armR.rotation.x = g * 0.35;
      }
    }
  }

  animateUgvLegs(delta, moving, locomotion) {
    const want = locomotion === 'LEG' ? 1 : 0;
    this.legMorph += (want - this.legMorph) * Math.min(1, 6 * delta);
    const modules = this.ugv.userData.modules || [];
    const t = performance.now() / 140;
    modules.forEach((m) => {
      const gait = Math.sin(t + m.phase) * this.legMorph;
      if (m.wheel) m.wheel.visible = this.legMorph < 0.82;
      if (m.thigh) m.thigh.visible = this.legMorph > 0.22;
      if (m.shin) m.shin.visible = this.legMorph > 0.22;
      if (m.foot) m.foot.visible = this.legMorph > 0.22;
      if (locomotion !== 'LEG' && moving && m.wheel) m.wheel.rotation.x += delta * 10;
      if (m.thigh) m.thigh.rotation.z = gait * 0.55;
      if (m.shin) m.shin.rotation.z = -gait * 0.35;
      if (m.group) m.group.position.y = 0.48 + Math.max(0, gait) * 0.28;
    });
  }

  makeWorldState() {
    const docked = !!(this.lastDecision && this.lastDecision.intent.docked);
    const perception = this.perception;
    return {
      getT: (x, y) => this.world.getT(x, y),
      isSolid: (x, y) => this.world.isSolidXZ(x, y, 2.2),
      getPathCost: (x, y, base, T) =>
        perception ? perception.getPathCost(x, y, base, T) : base,
      bounds: { minX: -140, minY: -140, maxX: 140, maxY: 140 },
      human: { x: this.human.position.x, y: this.human.position.z },
      ugv: {
        x: this.ugv.position.x,
        y: this.ugv.position.z,
        heading: this.ugvHeading,
        battery: this.batteries.ugv
      },
      uav: {
        x: this.uav.position.x,
        y: this.uav.position.z,
        alt: this.uav.position.y - this.world.heightAt(this.uav.position.x, this.uav.position.z),
        battery: this.batteries.uav,
        docked
      },
      commsOk: this.world.commsOk
    };
  }

  applyBtMotion(decision, delta, policyGains) {
    const intent = decision.intent;
    const ugvSpeed = 10 * (intent.ugvSpeedScale || 1) * (policyGains.ugvSpeed || 1);
    const uavSpeed = 25 * (policyGains.uavSpeed || 1);
    this.ugvMoving = false;

    const ugvGround = this.world.heightAt(this.ugv.position.x, this.ugv.position.z);
    this.ugv.position.y = ugvGround;

    if (this.controlMode === 'UGV') {
      const moved = this.applyManualXZ(this.ugv, ugvSpeed, delta, 2.2, true, false);
      if (moved) {
        this.ugvMoving = true;
        const dz = (this.keys.KeyW ? -1 : 0) + (this.keys.KeyS ? 1 : 0);
        const dx = (this.keys.KeyD ? 1 : 0) + (this.keys.KeyA ? -1 : 0);
        if (dx !== 0 || dz !== 0) this.ugvHeading = Math.atan2(dz, dx);
      }
    } else if (!intent.holdUgv && intent.ugvWaypoint) {
      const wp = intent.ugvWaypoint;
      if (Math.hypot(wp.x - this.ugv.position.x, wp.y - this.ugv.position.z) > 1.2) {
        const moved = this.moveOnXZ(this.ugv, wp.x, wp.y, ugvSpeed, delta, 2.2, true);
        if (moved) {
          this.ugvMoving = true;
          this.ugvHeading = Math.atan2(wp.y - this.ugv.position.z, wp.x - this.ugv.position.x);
        }
      }
    }

    this.ugv.position.y = this.world.heightAt(this.ugv.position.x, this.ugv.position.z);
    this.animateUgvLegs(delta, this.ugvMoving, intent.locomotion || 'WHEEL');
    if (this.ugvMoving) {
      this.batteries.ugv = Math.max(
        0,
        this.batteries.ugv - (intent.locomotion === 'LEG' ? 0.7 : 0.35) * delta
      );
    }

    if (this.controlMode === 'UAV') {
      this.applyManualXZ(this.uav, uavSpeed, delta, 0.8, false, false);
      if (this.keys.KeyQ) this.manualUavAlt = Math.max(2, this.manualUavAlt - 12 * delta);
      if (this.keys.KeyE) this.manualUavAlt = Math.min(40, this.manualUavAlt + 12 * delta);
      const ground = this.world.heightAt(this.uav.position.x, this.uav.position.z);
      this.uav.position.y = ground + this.manualUavAlt;
      this.batteries.uav = Math.max(0, this.batteries.uav - 2.4 * delta);
      (this.uav.userData.rotors || []).forEach((r) => {
        r.rotation.y += delta * 18;
      });
      return;
    }

    if (intent.docked) {
      this.uav.position.x = this.ugv.position.x;
      this.uav.position.z = this.ugv.position.z;
      this.uav.position.y = ugvGround + 1.75;
      // carga más lenta y realista (~8%/s → ~12s de 0 a 100)
      this.batteries.uav = Math.min(100, this.batteries.uav + 8 * delta);
    } else {
      const tgt = intent.uavTarget;
      const agl = this.uav.position.y - this.world.heightAt(this.uav.position.x, this.uav.position.z);
      const landing =
        decision.mode === 'LAND_DOCK' || (decision.mode === 'EMERGENCY_RTL' && agl < 5);
      if (landing) {
        this.uav.position.x += (this.ugv.position.x - this.uav.position.x) * Math.min(1, 6 * delta);
        this.uav.position.z += (this.ugv.position.z - this.uav.position.z) * Math.min(1, 6 * delta);
        const padY = this.world.heightAt(this.ugv.position.x, this.ugv.position.z) + 1.75;
        this.uav.position.y = Math.max(padY, this.uav.position.y - 8 * delta);
      } else {
        const dx = tgt.x - this.uav.position.x;
        const dz = tgt.y - this.uav.position.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.15) {
          const step = Math.min(uavSpeed * delta, d);
          this.uav.position.x += (dx / d) * step;
          this.uav.position.z += (dz / d) * step;
        }
        const wantY = this.world.heightAt(this.uav.position.x, this.uav.position.z) + tgt.alt;
        if (this.uav.position.y < wantY) this.uav.position.y = Math.min(wantY, this.uav.position.y + 10 * delta);
        else this.uav.position.y = Math.max(wantY, this.uav.position.y - 6 * delta);
      }
      this.batteries.uav = Math.max(0, this.batteries.uav - 2.4 * delta);
      (this.uav.userData.rotors || []).forEach((r) => {
        r.rotation.y += delta * 18;
      });
    }
  }

  reset(world) {
    this.human.position.set(0, world.heightAt(0, -42), -42);
    this.ugv.position.set(10, world.heightAt(10, 52), 52);
    this.uav.position.set(10, world.heightAt(10, 52) + 1.75, 52);
    this.batteries = { ugv: 100, uav: 100 };
    this.ugvHeading = Math.atan2(-42 - 52, 0 - 10);
    this.legMorph = 0;
    this.lastLoco = 'WHEEL';
    this.lastDecision = null;
    this.manualUavAlt = 14;
  }
}
