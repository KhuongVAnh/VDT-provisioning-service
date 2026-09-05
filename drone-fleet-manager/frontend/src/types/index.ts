export type LayoutMode = 'mode-map' | 'mode-split' | 'mode-cockpit';

export type FlightMode =
  | 'STABILIZE'
  | 'ALT_HOLD'
  | 'LOITER'
  | 'GUIDED'
  | 'AUTO'
  | 'RTL'
  | 'LAND'
  | 'MANUAL'
  | 'POSHOLD'
  | 'ACRO'
  | 'UNKNOWN';

export interface DroneTelemetry {
  deviceId: string;
  sysid?: number;
  vpnIp?: string;
  connected?: boolean;
  armed?: boolean;
  flightMode?: FlightMode | string;
  battery?: {
    voltage?: number;
    voltageMv?: number;
    current?: number;
    currentCa?: number;
    percentage?: number;
  };
  batteryPct?: number;
  voltageMv?: number;
  gps?: {
    lat?: number;
    lon?: number;
    alt?: number;
    relativeAlt?: number;
    altRelativeM?: number;
    altMslM?: number;
    groundSpeedMs?: number;
    headingDeg?: number;
    satellites?: number;
    fixType?: number | string;
  };
  lat?: number;
  lon?: number;
  altRelativeM?: number;
  groundSpeedMs?: number;
  headingDeg?: number;
  attitude?: {
    pitch?: number; // degrees
    roll?: number;  // degrees
    yaw?: number;   // heading degrees 0-360
    pitchDeg?: number;
    rollDeg?: number;
    yawDeg?: number;
  };
  pitchDeg?: number;
  rollDeg?: number;
  velocity?: {
    groundSpeed?: number; // m/s
    airSpeed?: number;
    climbRate?: number;   // m/s
  };
  signal?: {
    rssi?: number;
    snr?: number;
    pingMs?: number;
  };
  timestamp?: number;
  lastReceivedAt?: number;
}

export interface DroneDevice {
  id?: string;
  deviceId: string;
  vpnIp?: string;
  hardwareModel?: string;
  status?: 'ACTIVE' | 'PENDING' | 'OFFLINE' | 'SUSPENDED' | 'REVOKED';
  isOnline?: boolean;
  transferRx?: number;
  transferTx?: number;
  latestHandshake?: number;
  createdAt?: string;
  telemetry?: DroneTelemetry;
}

export interface DashboardStats {
  devices?: {
    total?: number;
    active?: number;
    pending?: number;
    offline?: number;
  };
  ipPool?: {
    totalCapacity?: number;
    usedCount?: number;
    utilizationPercentage?: number;
  };
}

export interface UserProfile {
  id: string;
  email: string;
  fullName?: string;
  role: 'ADMIN' | 'PILOT' | 'OBSERVER';
}

