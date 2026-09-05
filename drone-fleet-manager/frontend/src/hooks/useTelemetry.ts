import { useState, useRef, useCallback, useEffect } from 'react';
import { DroneTelemetry, DroneDevice } from '../types';

export const isDroneOnline = (t?: DroneTelemetry): boolean => {
  if (!t) return false;
  if (t.connected === false) return false;
  const now = Date.now();
  if (t.lastReceivedAt && now - t.lastReceivedAt < 10000) return true;
  if (t.timestamp && now - t.timestamp < 10000) return true;
  if (t.flightMode && t.flightMode !== 'UNKNOWN') return true;
  return !!t.connected;
};

export const useTelemetry = (devices: DroneDevice[]) => {
  // Bản đồ lưu trữ telemetry mới nhất của từng Drone (Ref để không kích hoạt re-render liên tục)
  const telemetryMapRef = useRef<Record<string, DroneTelemetry>>({});
  // Đường bay lưu vết (Flight trails)
  const flightTrailsRef = useRef<Record<string, Array<[number, number]>>>({});

  // State cập nhật theo chu kỳ (Throttled) cho các thành phần React UI (1-2 lần/giây)
  const [telemetrySnapshot, setTelemetrySnapshot] = useState<Record<string, DroneTelemetry>>({});

  // Cập nhật gói tin khi nhận từ WebSocket
  const handleIncomingTelemetry = useCallback((data: DroneTelemetry) => {
    if (!data || !data.deviceId) return;

    const devId = data.deviceId;
    const prev = telemetryMapRef.current[devId] || {};
    const updated: DroneTelemetry = {
      ...prev,
      ...data,
      lastReceivedAt: Date.now(),
    };

    telemetryMapRef.current[devId] = updated;

    // Cập nhật đường bay nếu có tọa độ GPS hợp lệ
    if (data.gps?.lat && data.gps?.lon && (data.gps.lat !== 0 || data.gps.lon !== 0)) {
      if (!flightTrailsRef.current[devId]) {
        flightTrailsRef.current[devId] = [];
      }
      const trail = flightTrailsRef.current[devId];
      const lastPoint = trail[trail.length - 1];
      // Chỉ lưu nếu vị trí dịch chuyển đáng kể
      if (!lastPoint || Math.abs(lastPoint[0] - data.gps.lat) > 0.00005 || Math.abs(lastPoint[1] - data.gps.lon) > 0.00005) {
        trail.push([data.gps.lat, data.gps.lon]);
        if (trail.length > 500) trail.shift(); // Giới hạn 500 điểm gần nhất
      }
    }
  }, []);

  // Sync định kỳ 500ms một lần cho React State để cập nhật bảng và KPI
  useEffect(() => {
    const interval = setInterval(() => {
      setTelemetrySnapshot({ ...telemetryMapRef.current });
    }, 500);

    return () => clearInterval(interval);
  }, []);

  // Lấy telemetry tức thì (Dành cho HUD render loop 60 FPS)
  const getLatestTelemetry = useCallback((deviceId: string): DroneTelemetry | undefined => {
    return telemetryMapRef.current[deviceId];
  }, []);

  // Lấy đường bay của Drone
  const getFlightTrail = useCallback((deviceId: string): Array<[number, number]> => {
    return flightTrailsRef.current[deviceId] || [];
  }, []);

  return {
    handleIncomingTelemetry,
    telemetrySnapshot,
    getLatestTelemetry,
    getFlightTrail,
    telemetryMapRef,
  };
};

