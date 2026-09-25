/**
 * Schema de telemetría alineado a topics ROS 2 futuros (Fase 4).
 * El Digital Twin exporta el mismo shape conceptual que hares_ws publicará.
 */
export const TELEMETRY_SCHEMA_VERSION = 'hares.dt.v1';

export const ROS_TOPIC_MAP = {
  '/hares/state_vector': {
    type: 'hares_msgs/msg/StateVector',
    fields: ['d_persona', 'T_terreno', 'T_fwd', 'E_bateria', 'R_riesgo', 'C_comunicacion', 'U_incertidumbre', 'deploy_need', 'deploy_gate']
  },
  '/hares/bt/mode': {
    type: 'std_msgs/msg/String',
    fields: ['btMode']
  },
  '/hares/ugv/battery': {
    type: 'sensor_msgs/msg/BatteryState',
    fields: ['ugvBattery']
  },
  '/hares/uav/battery': {
    type: 'sensor_msgs/msg/BatteryState',
    fields: ['uavBattery']
  },
  '/hares/actions/labels': {
    type: 'hares_msgs/msg/ActionLabels',
    fields: ['actionLabel', 'predLabel', 'confidence']
  },
  '/hares/events': {
    type: 'hares_msgs/msg/MissionEvent',
    fields: ['event', 't', 'scenario']
  },
  '/hares/perception/coverage': {
    type: 'std_msgs/msg/Float32',
    fields: ['reconCoverage']
  }
};

export function sampleToRosBag(sample) {
  return {
    header: {
      stamp: { sec: Math.floor(sample.t / 1000), nanosec: (sample.t % 1000) * 1e6 },
      frame_id: 'hares_map'
    },
    schema: TELEMETRY_SCHEMA_VERSION,
    control_mode: sample.controlMode,
    scenario: sample.scenario,
    state: {
      d_persona: sample.d_persona,
      T_terreno: sample.T_terreno,
      T_fwd: sample.T_fwd,
      E_bateria: sample.E_bateria,
      R_riesgo: sample.R_riesgo,
      C_comunicacion: sample.C_comunicacion,
      U_incertidumbre: sample.U_incertidumbre,
      deploy_need: sample.deploy_need,
      deploy_gate: sample.deploy_gate
    },
    bt_mode: sample.btMode,
    locomotion: sample.locomotion,
    batteries: { ugv: sample.ugvBattery, uav: sample.uavBattery },
    actions: {
      ground_truth: sample.actionLabel,
      predicted: sample.predLabel,
      confidence: sample.confidence
    },
    event: sample.event || '',
    comms_ok: sample.commsOk,
    recon_coverage: sample.reconCoverage
  };
}
