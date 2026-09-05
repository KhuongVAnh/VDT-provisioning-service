import { DroneTelemetry } from '../types';

export interface ExtractedTelemetry {
  pitch: number;
  roll: number;
  yaw: number;
  heading: number;
  altitude: number;
  groundSpeed: number;
  climbRate: number;
  batteryPct: number;
  batteryVoltage?: number;
  batteryVoltageStr?: string;
  flightMode: string;
  armed: boolean;
  lat: number;
  lon: number;
  sats: number;
  online: boolean;
  hasGps: boolean;
}

/**
 * Trích xuất và chuẩn hóa dữ liệu đo xa Telemetry từ mọi định dạng (Full / Lite / REST API).
 * Tương thích ngược với cả tên trường cũ và mới, chống crash và chống giá trị undefined.
 */
export const extractTelemetryMetrics = (telemetry?: DroneTelemetry, isOnline = true): ExtractedTelemetry => {
  const pitch = telemetry?.attitude?.pitchDeg ?? telemetry?.pitchDeg ?? telemetry?.attitude?.pitch ?? 0;
  const roll = telemetry?.attitude?.rollDeg ?? telemetry?.rollDeg ?? telemetry?.attitude?.roll ?? 0;
  const heading = Math.round(telemetry?.attitude?.yawDeg ?? telemetry?.headingDeg ?? telemetry?.gps?.headingDeg ?? telemetry?.attitude?.yaw ?? 0);
  const yaw = telemetry?.attitude?.yawDeg ?? telemetry?.headingDeg ?? telemetry?.gps?.headingDeg ?? telemetry?.attitude?.yaw ?? 0;

  const altitude = telemetry?.gps?.altRelativeM ?? telemetry?.altRelativeM ?? telemetry?.gps?.altMslM ?? telemetry?.gps?.relativeAlt ?? telemetry?.gps?.alt ?? 0;
  const groundSpeed = telemetry?.gps?.groundSpeedMs ?? telemetry?.groundSpeedMs ?? telemetry?.velocity?.groundSpeed ?? 0;
  const climbRate = telemetry?.velocity?.climbRate ?? 0;

  const rawBatPct = telemetry?.battery?.percentage ?? telemetry?.batteryPct;
  const batteryPct = Math.min(100, Math.max(0, Math.round(rawBatPct ?? (isOnline ? 100 : 0))));

  const voltageMv = telemetry?.battery?.voltageMv ?? telemetry?.voltageMv;
  const voltageVal = voltageMv ? (voltageMv / 1000) : telemetry?.battery?.voltage;
  const batteryVoltage = voltageVal;
  const batteryVoltageStr = voltageVal ? voltageVal.toFixed(1) : undefined;

  const flightMode = (telemetry?.flightMode && telemetry.flightMode !== 'UNKNOWN')
    ? telemetry.flightMode
    : (isOnline ? 'ONLINE' : '--');

  const armed = !!telemetry?.armed;
  const lat = telemetry?.gps?.lat ?? telemetry?.lat ?? 0;
  const lon = telemetry?.gps?.lon ?? telemetry?.lon ?? 0;
  const sats = telemetry?.gps?.satellites ?? 0;
  const hasGps = typeof lat === 'number' && typeof lon === 'number' && (lat !== 0 || lon !== 0);

  return {
    pitch,
    roll,
    yaw,
    heading,
    altitude,
    groundSpeed,
    climbRate,
    batteryPct,
    batteryVoltage,
    batteryVoltageStr,
    flightMode,
    armed,
    lat,
    lon,
    sats,
    online: isOnline,
    hasGps,
  };
};

/**
 * Định dạng khoảng thời gian trôi qua (Elapsed time) sang ngôn ngữ tự nhiên tiếng Việt dễ hiểu cho người vận hành.
 * Ví dụ: 12s -> "12 giây trước", 150s -> "2 phút trước", 1363887s -> "15 ngày trước"
 */
export const formatTimeAgo = (seconds: number | null | undefined, isShort = false): string => {
  if (seconds === null || seconds === undefined || isNaN(seconds) || seconds < 0) {
    return isShort ? 'OFFLINE' : 'Chưa có tín hiệu';
  }

  if (seconds < 5) {
    return isShort ? 'vừa xong' : 'Vừa cập nhật';
  }

  if (seconds < 60) {
    return isShort ? `${seconds}s` : `${seconds} giây trước`;
  }

  const minutes = Math.floor(seconds / 60);
  if (seconds < 3600) {
    const remSecs = seconds % 60;
    if (isShort) {
      return remSecs > 0 ? `${minutes}p ${remSecs}s` : `${minutes}p`;
    }
    return `${minutes} phút trước`;
  }

  const hours = Math.floor(seconds / 3600);
  const remMinutes = Math.floor((seconds % 3600) / 60);
  if (seconds < 86400) {
    if (isShort) {
      return remMinutes > 0 ? `${hours}h ${remMinutes}p` : `${hours}h`;
    }
    return remMinutes > 0 ? `${hours} giờ ${remMinutes} phút trước` : `${hours} giờ trước`;
  }

  const days = Math.floor(seconds / 86400);
  const remHours = Math.floor((seconds % 86400) / 3600);
  if (days < 30) {
    if (isShort) {
      return `${days} ngày`;
    }
    return remHours > 0 ? `${days} ngày ${remHours} giờ trước` : `${days} ngày trước`;
  }

  const months = Math.floor(days / 30);
  if (isShort) {
    return `${months} tháng`;
  }
  return `${months} tháng trước`;
};

