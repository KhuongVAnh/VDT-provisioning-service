/**
 * ==============================================================================
 * MODULE CORE 1: GLOBAL STATE & DOM CACHE (state.js)
 * ==============================================================================
 * Mục đích:
 *  - Quản lý toàn bộ biến trạng thái toàn cục (State) của Dashboard.
 *  - Lưu trữ tham chiếu (Cache) các phần tử DOM quan trọng để truy cập nhanh.
 * ==============================================================================
 */

// --- 1. BIẾN TRẠNG THÁI TOÀN CỤC (GLOBAL STATE) ---

/** @type {any} Đối tượng kết nối Socket.IO tới Gateway */
let socket = null;

/** @type {any} Đối tượng bản đồ tác chiến Leaflet */
let map = null;

/** @type {Object.<string, any>} Danh sách Marker vị trí các Drone trên bản đồ (Key: deviceId) */
let droneMarkers = {};

/** @type {Object.<string, any>} Danh sách đường bay (Flight Trails / Polyline) của các Drone */
let droneFlightTrails = {};

/** @type {Array<any>} Danh sách toàn bộ Drone nhận được từ API /telemetry/fleet/states */
let fleetDevices = [];

/** @type {string} Mã Drone đang được chọn để quan sát trên HUD / Bản đồ ('all' hoặc ID cụ thể) */
let activeDroneId = 'all';

/** @type {string|null} Mã Drone đang mở luồng Video FPV */
let activeFpvDroneId = null;

/** @type {string} Chế độ bố cục giao diện tác chiến hiện tại ('mode-map' | 'mode-split' | 'mode-cockpit') */
let currentLayoutMode = 'mode-map';

/** @type {RTCPeerConnection|null} Phiên kết nối WebRTC Peer Connection (WHEP Ultra-Low Latency) */
let fpvPeerConnection = null;

/** @type {any|null} Đối tượng trình phát Hls.js dự phòng khi mạng chặn WebRTC UDP */
let fpvHlsInstance = null;

/** @type {any|null} Bộ đếm thời gian cập nhật thông số độ phân giải / FPS của Video */
let fpvStatsInterval = null;

/** @type {any|null} Đối tượng Terminal dòng lệnh Xterm.js */
let term = null;

/** @type {any|null} Addon tự động co giãn kích thước theo khung của Xterm.js */
let fitAddon = null;


// --- 2. THAM CHIẾU DOM TẬP TRUNG (DOM CACHE) ---

const DOM = {
  // Bộ chọn Drone & Bố cục
  mapSelect: document.getElementById('select-drone-map'),
  viewportGrid: document.getElementById('tactical-grid-viewport'),

  // Phần tử Video FPV & Trạng thái tải
  fpvVideoEl: document.getElementById('fpv-video-el'),
  fpvLoadingState: document.getElementById('fpv-loading-state'),
  fpvLoadingText: document.getElementById('fpv-loading-text'),
  btnVideoLabel: document.getElementById('btn-video-label'),

  // Thẻ chỉ số tổng quan (KPI)
  kpiTotal: document.getElementById('kpi-total-devices'),
  kpiActivePending: document.getElementById('kpi-active-pending'),
  kpiOnline: document.getElementById('kpi-online-count'),
  kpiIpUsage: document.getElementById('kpi-ip-usage'),
  kpiIpCounts: document.getElementById('kpi-ip-counts'),

  // Bảng danh sách & Ma trận IP
  fleetTable: document.getElementById('fleet-table-body'),
  ipMatrix: document.getElementById('ip-matrix-container'),

  // Giao diện Web SSH
  sshSelect: document.getElementById('terminal-select-drone'),
  sshIp: document.getElementById('terminal-input-ip'),
  sshUser: document.getElementById('terminal-input-user'),
  sshPass: document.getElementById('terminal-input-pass'),
  sshStatus: document.getElementById('terminal-status-text'),

  // Lớp hiển thị buồng lái FPV OSD (Over-Screen Display)
  osd: {
    droneName: document.getElementById('hud-osd-drone-name'),
    protocol: document.getElementById('osd-pill-protocol'),
    res: document.getElementById('osd-pill-res'),
    bitrate: document.getElementById('osd-pill-bitrate'),
    sat: document.getElementById('osd-pill-sat'),
    latency: document.getElementById('osd-pill-latency'),
    hdg: document.getElementById('osd-hdg-val'),
    spd: document.getElementById('osd-spd-val'),
    alt: document.getElementById('osd-alt-val'),
    modeText: document.getElementById('osd-mode-text'),
    modePill: document.getElementById('osd-mode-pill'),
    batText: document.getElementById('osd-bat-text'),
    batPill: document.getElementById('osd-bat-pill'),
    pitchLadder: document.getElementById('hud-pitch-ladder'),
  },

  // Sidebar đo đạc Telemetry & Chân trời nhân tạo 3D
  hud: {
    deviceId: document.getElementById('hud-val-device'),
    flightMode: document.getElementById('hud-val-mode'),
    armed: document.getElementById('hud-val-armed'),
    battery: document.getElementById('hud-val-battery'),
    altitude: document.getElementById('hud-val-alt'),
    speed: document.getElementById('hud-val-speed'),
    heading: document.getElementById('hud-val-heading'),
    angles: document.getElementById('hud-val-angles'),
    horizon: document.getElementById('hud-horizon-sphere'),
    lat: document.getElementById('hud-val-lat'),
    lon: document.getElementById('hud-val-lon'),
    sats: document.getElementById('hud-val-sats'),
  }
};
