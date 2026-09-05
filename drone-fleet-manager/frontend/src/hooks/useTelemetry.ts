import { useState, useRef, useCallback, useEffect } from 'react';
import { DroneTelemetry, DroneDevice } from '../types';

export const isDroneOnline = (t?: DroneTelemetry): boolean => {
  if (!t) return false;
  if (t.connected === false) return false;
  if (t.connected === true) return true;
  if (t.flightMode && t.flightMode !== 'UNKNOWN') return true;
  const now = Date.now();
  if (t.lastReceivedAt && Math.abs(now - t.lastReceivedAt) < 15000) return true;
  if (t.timestamp && Math.abs(now - t.timestamp) < 15000) return true;
  return true;
};

export const useTelemetry = (devices: DroneDevice[]) => {
  // Bản đồ lưu trữ telemetry mới nhất của từng Drone (Ref để không kích hoạt re-render liên tục)
  const telemetryMapRef = useRef<Record<string, DroneTelemetry>>({});
  // Đường bay lưu vết (Flight trails)
  const flightTrailsRef = useRef<Record<string, Array<[number, number]>>>({});

  // State cập nhật theo chu kỳ (Throttled) cho các thành phần React UI (1-2 lần/giây)
  const [telemetrySnapshot, setTelemetrySnapshot] = useState<Record<string, DroneTelemetry>>({});

  // Khởi tạo điểm đầu tiên cho các drone đã có tọa độ từ API ban đầu
  useEffect(() => {
    if (!devices || devices.length === 0) return;
    devices.forEach((dev) => {
      const devId = dev.deviceId;
      const t = dev.telemetry;
      const lat = t?.gps?.lat ?? t?.lat;
      const lon = t?.gps?.lon ?? t?.lon;
      if (typeof lat === 'number' && typeof lon === 'number' && (lat !== 0 || lon !== 0)) {
        if (!flightTrailsRef.current[devId] || flightTrailsRef.current[devId].length === 0) {
          flightTrailsRef.current[devId] = [[lat, lon]];
        }
      }
    });
  }, [devices]);

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

    // Cập nhật đường bay nếu có tọa độ GPS hợp lệ (Backend Go DeadbandFilter đã lọc sẵn Delta >= 0.2m)
    const lat = data.gps?.lat ?? data.lat;
    const lon = data.gps?.lon ?? data.lon;
    if (typeof lat === 'number' && typeof lon === 'number' && (lat !== 0 || lon !== 0)) {
      if (!flightTrailsRef.current[devId]) {
        flightTrailsRef.current[devId] = [];
      }
      const trail = flightTrailsRef.current[devId];
      const lastPoint = trail[trail.length - 1];
      // Chỉ cần khác điểm gần nhất là ghi nhận ngay (tránh trùng điểm khi đứng yên gửi heartbeat 2s)
      if (!lastPoint || lastPoint[0] !== lat || lastPoint[1] !== lon) {
        trail.push([lat, lon]);
        if (trail.length > 1000) trail.shift(); // Giới hạn 1000 điểm gần nhất
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

