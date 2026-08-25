/**
 * ============================================================================
 * DỰ ÁN: Pilot Bridge — Trạm Mặt Đất & Cầu Nối Video FPV Cho Drone
 * FILE: src/bridge/TelemetryModel.h
 * MÔ TẢ: Định nghĩa struct TelemetryData chứa toàn bộ snapshot trạng thái
 *       bay tức thời của Drone (GPS, Độ cao, Vận tốc, Pin, Động cơ, Chế độ
 * bay).
 * ============================================================================
 */

#pragma once

#include <QString>
#include <cstdint>

struct TelemetryData {
  QString deviceId;
  uint8_t systemId = 1;
  uint8_t componentId = 1;

  // GPS & Động học bay
  double latitude = 0.0;
  double longitude = 0.0;
  float altitudeMsl = 0.0f;
  float altitudeRel = 0.0f;
  float speedMs = 0.0f;
  float headingDeg = 0.0f;
  float rollRad = 0.0f;
  float pitchRad = 0.0f;
  float yawRad = 0.0f;

  // Nguồn điện & Trạng thái hệ thống
  uint8_t batteryPct = 100;
  uint16_t batteryVoltageMv = 0;
  int16_t batteryCurrentCa = 0;
  uint8_t satellites = 0;
  bool isArmed = false;
  uint32_t flightMode = 0;
  QString flightModeName = "DISARMED";

  uint64_t totalPacketsSent = 0;
};
