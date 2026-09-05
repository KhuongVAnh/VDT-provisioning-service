import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { DroneDevice, DroneTelemetry } from '../../types';
import { useTheme } from '../../context/ThemeContext';
import { isDroneOnline } from '../../hooks/useTelemetry';
import { Satellite, Crosshair, Map as MapIcon } from 'lucide-react';

interface TacticalMapProps {
  devices: DroneDevice[];
  activeDroneId: string;
  onSelectDrone: (id: string) => void;
  telemetrySnapshot: Record<string, DroneTelemetry>;
  getFlightTrail: (deviceId: string) => Array<[number, number]>;
}

export type MapLayerStyle = 'satellite' | 'tactical' | 'osm';

// Custom SVG Drone Icon maker with real-time Heading Rotation
const createDroneIcon = (heading: number = 0, isOnline: boolean = false, isArmed: boolean = false, isSelected: boolean = false) => {
  const color = !isOnline
    ? '#94A3B8'
    : isArmed
      ? '#10B981'
      : '#00E5FF';

  const ringColor = isSelected ? '#00E5FF' : isOnline ? color : '#64748B';
  const pulseRing = isOnline ? `<div class="absolute inset-0 rounded-full border-2 border-[${color}] animate-ping opacity-40"></div>` : '';

  const html = `
    <div class="relative flex items-center justify-center w-10 h-10 select-none">
      ${pulseRing}
      <div class="w-8 h-8 rounded-full bg-slate-900/90 border-2 shadow-lg flex items-center justify-center transition-transform duration-200" 
           style="border-color: ${ringColor}; transform: rotate(${heading}deg);">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="12 2 19 21 12 17 5 21 12 2"></polygon>
        </svg>
      </div>
      ${isSelected ? `<div class="absolute -bottom-1 text-[9px] font-mono font-bold px-1 rounded bg-tactical-cyan text-black leading-tight shadow-sm">ACTIVE</div>` : ''}
    </div>
  `;

  return L.divIcon({
    html,
    className: 'custom-drone-marker',
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });
};

export const TacticalMap: React.FC<TacticalMapProps> = ({
  devices,
  activeDroneId,
  onSelectDrone,
  telemetrySnapshot,
  getFlightTrail,
}) => {
  const { theme } = useTheme();
  const [layerStyle, setLayerStyle] = useState<MapLayerStyle>('tactical');
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Record<string, L.Marker>>({});
  const polylinesRef = useRef<Record<string, L.Polyline>>({});
  const tileLayerRef = useRef<L.TileLayer | null>(null);

  // 1. Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const initialLat = 21.0285; // Mặc định Hà Nội
    const initialLon = 105.8542;

    const map = L.map(mapContainerRef.current, {
      center: [initialLat, initialLon],
      zoom: 15,
      zoomControl: false,
    });

    // Custom Zoom control at bottom right
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // 2. Auto-resize map when viewport/layout container changes
  useEffect(() => {
    if (!mapContainerRef.current || !mapRef.current) return;
    const observer = new ResizeObserver(() => {
      mapRef.current?.invalidateSize();
    });
    observer.observe(mapContainerRef.current);
    return () => observer.disconnect();
  }, []);

  // 3. Update Tile Layer (Free high-definition layers without API key watermarks)
  useEffect(() => {
    if (!mapRef.current) return;

    if (tileLayerRef.current) {
      tileLayerRef.current.remove();
    }

    let tileUrl = '';
    let attribution = '';
    let maxZoom = 19;

    if (layerStyle === 'satellite') {
      // Esri World Imagery (Photorealistic satellite)
      tileUrl = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
      attribution = '&copy; Esri World Imagery';
      maxZoom = 19;
    } else if (layerStyle === 'tactical') {
      // Esri Canvas (Clean Dark / Light Tactical GIS)
      tileUrl = theme === 'dark'
        ? 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'
        : 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}';
      attribution = '&copy; Esri Tactical Canvas';
      maxZoom = 16;
    } else {
      // OpenStreetMap (Standard streets)
      tileUrl = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
      attribution = '&copy; OpenStreetMap contributors';
      maxZoom = 19;
    }

    const newLayer = L.tileLayer(tileUrl, {
      maxZoom,
      attribution,
      subdomains: 'abc',
    }).addTo(mapRef.current);

    tileLayerRef.current = newLayer;
  }, [theme, layerStyle]);

  // 4. Update Markers & Flight Trails
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const validPositions: Array<[number, number]> = [];

    devices.forEach((dev) => {
      const devId = dev.deviceId;
      const t = telemetrySnapshot[devId] || dev.telemetry;
      const online = isDroneOnline(t);
      const lat = t?.gps?.lat ?? t?.lat;
      const lon = t?.gps?.lon ?? t?.lon;
      const heading = t?.attitude?.yawDeg ?? t?.headingDeg ?? t?.gps?.headingDeg ?? t?.attitude?.yaw ?? 0;
      const armed = t?.armed ?? false;
      const isSelected = activeDroneId === devId;

      if (typeof lat === 'number' && typeof lon === 'number' && (lat !== 0 || lon !== 0)) {
        validPositions.push([lat, lon]);

        // Tạo hoặc cập nhật Marker
        const icon = createDroneIcon(heading, online, armed, isSelected);

        if (!markersRef.current[devId]) {
          const marker = L.marker([lat, lon], { icon }).addTo(map);
          marker.on('click', () => {
            onSelectDrone(devId);
          });
          markersRef.current[devId] = marker;
        } else {
          const marker = markersRef.current[devId];
          marker.setLatLng([lat, lon]);
          marker.setIcon(icon);
        }

        const altVal = t?.gps?.altRelativeM ?? t?.altRelativeM ?? t?.gps?.altMslM ?? t?.gps?.relativeAlt ?? t?.gps?.alt ?? 0;
        const spdVal = t?.gps?.groundSpeedMs ?? t?.groundSpeedMs ?? t?.velocity?.groundSpeed ?? 0;
        const batVal = t?.battery?.percentage ?? t?.batteryPct ?? 100;
        const modeVal = (t?.flightMode && t.flightMode !== 'UNKNOWN') ? t.flightMode : (online ? 'ONLINE' : 'LOITER');

        // Tạo hoặc cập nhật Popup thông tin
        const popupContent = `
          <div class="p-1 font-sans text-xs">
            <div class="font-bold font-mono text-sm text-slate-900">${devId}</div>
            <div class="text-slate-600 font-mono text-[11px] mb-1">${dev.vpnIp || '10.13.37.X'}</div>
            <div class="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] font-mono border-t pt-1">
              <div>Độ cao: <b>${altVal.toFixed(1)} m</b></div>
              <div>Vận tốc: <b>${spdVal.toFixed(1)} m/s</b></div>
              <div>Pin: <b>${batVal}%</b></div>
              <div>Chế độ: <b>${modeVal}</b></div>
            </div>
          </div>
        `;
        markersRef.current[devId].bindPopup(popupContent);

        // Cập nhật đường bay (Flight Trail Polyline)
        const trail = getFlightTrail(devId);
        if (trail.length >= 1) {
          if (!polylinesRef.current[devId]) {
            const polyline = L.polyline(trail, {
              color: isSelected ? '#00E5FF' : '#38BDF8',
              weight: isSelected ? 3 : 2,
              opacity: isSelected ? 0.9 : 0.6,
              dashArray: isSelected ? undefined : '4, 6',
            }).addTo(map);
            polylinesRef.current[devId] = polyline;
          } else {
            polylinesRef.current[devId].setLatLngs(trail);
            polylinesRef.current[devId].setStyle({
              color: isSelected ? '#00E5FF' : '#38BDF8',
              weight: isSelected ? 3 : 2,
            });
          }
        }
      }
    });

    // Nếu chọn một drone cụ thể, tự động canh tâm bản đồ vào vị trí drone đó
    if (activeDroneId !== 'all' && markersRef.current[activeDroneId]) {
      const targetLatLng = markersRef.current[activeDroneId].getLatLng();
      map.panTo(targetLatLng, { animate: true, duration: 0.5 });
    }
  }, [devices, telemetrySnapshot, activeDroneId, getFlightTrail, onSelectDrone]);

  return (
    <div className="relative isolate w-full h-full min-h-[350px] rounded-xl overflow-hidden border border-slate-300/80 dark:border-slate-800 shadow-inner">
      <div ref={mapContainerRef} className="w-full h-full" />

      {/* Mini Tactical HUD Grid Overlay */}
      <div className="absolute top-3 left-3 z-[400] pointer-events-none flex items-center gap-2 bg-[#F8FAFC]/90 dark:bg-obsidian-900/90 backdrop-blur-md px-2.5 py-1.5 rounded-lg border border-slate-300/80 dark:border-slate-800 text-[10px] font-mono text-slate-700 dark:text-slate-300 shadow-sm">
        <span className="w-2 h-2 rounded-full bg-tactical-cyan animate-pulse" />
        <span className="font-semibold">TACTICAL GIS GRID: WGS-84</span>
      </div>

      {/* Tactical Layer Switcher (Satellite / Tactical Canvas / Street OSM) */}
      <div className="absolute top-3 right-3 z-[400] flex items-center gap-1 bg-[#F8FAFC]/90 dark:bg-obsidian-900/90 backdrop-blur-md p-1 rounded-xl border border-slate-300/80 dark:border-slate-800 shadow-md">
        <button
          type="button"
          onClick={() => setLayerStyle('tactical')}
          title="Bản đồ Tác chiến (GIS Canvas tối ưu HUD)"
          className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all cursor-pointer ${layerStyle === 'tactical'
            ? 'bg-tactical-blue text-white shadow-sm font-semibold'
            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
        >
          <Crosshair className="w-3.5 h-3.5" />
          <span>Tác chiến</span>
        </button>

        <button
          type="button"
          onClick={() => setLayerStyle('satellite')}
          title="Bản đồ Vệ tinh quang học (Esri World Imagery)"
          className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all cursor-pointer ${layerStyle === 'satellite'
            ? 'bg-tactical-blue text-white shadow-sm font-semibold'
            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
        >
          <Satellite className="w-3.5 h-3.5" />
          <span>Vệ tinh</span>
        </button>

        <button
          type="button"
          onClick={() => setLayerStyle('osm')}
          title="Bản đồ Đường bộ (OpenStreetMap)"
          className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all cursor-pointer ${layerStyle === 'osm'
            ? 'bg-tactical-blue text-white shadow-sm font-semibold'
            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
        >
          <MapIcon className="w-3.5 h-3.5" />
          <span>Đường bộ</span>
        </button>
      </div>
    </div>
  );
};
