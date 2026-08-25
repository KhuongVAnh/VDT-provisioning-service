/**
 * ============================================================================
 * DỰ ÁN: Pilot Bridge — Trạm Mặt Đất & Cầu Nối Video FPV Cho Drone
 * FILE: tests/test_bridge_core.cpp
 * MÔ TẢ: Bài kiểm thử tích hợp tự động (Integration Test) kiểm tra luồng
 *       chuyển tiếp MAVLink hai chiều (Downlink & Uplink) qua LocalGcsServer
 * (TCP 5760).
 * ============================================================================
 */

#include "../src/bridge/DroneBridgeCore.h"
#include "../src/bridge/LocalGcsServer.h"
#include <QCoreApplication>
#include <QTcpSocket>
#include <QThread>
#include <QTimer>
#include <cassert>
#include <common/mavlink.h>
#include <iostream>

int main(int argc, char *argv[]) {
  QCoreApplication app(argc, argv);
  std::cout
      << "[TEST] Starting DroneBridgeCore / LocalGcsServer integration test..."
      << std::endl;

  // 1. Khởi động LocalGcsServer trên cổng TCP 5760
  LocalGcsServer gcsServer;
  bool started = gcsServer.startServer(5760, 14550);
  assert(started);
  std::cout << "[TEST] ✅ LocalGcsServer started successfully on TCP port 5760!"
            << std::endl;

  // 2. Giả lập phần mềm trạm mặt đất (QGroundControl) kết nối vào cổng TCP 5760
  QTcpSocket clientSocket;
  clientSocket.connectToHost("127.0.0.1", 5760);

  bool connected = clientSocket.waitForConnected(3000);
  assert(connected);
  std::cout << "[TEST] ✅ Test TCP Client (QGC) connected to 127.0.0.1:5760!"
            << std::endl;

  // 3. Xử lý Event Loop để LocalGcsServer chấp nhận kết nối
  // (onNewTcpConnection)
  for (int k = 0; k < 5; ++k) {
    app.processEvents(QEventLoop::AllEvents, 50);
    QThread::msleep(20);
  }
  assert(gcsServer.activeClientsCount() == 1);

  // 4. [DOWNLINK TEST]: Gửi gói tin MAVLink v2 Heartbeat từ Cloud Gateway sang
  // GCS
  mavlink_message_t hbMsg;
  mavlink_msg_heartbeat_pack(
      1, 1, &hbMsg, MAV_TYPE_QUADROTOR, MAV_AUTOPILOT_ARDUPILOTMEGA,
      MAV_MODE_FLAG_CUSTOM_MODE_ENABLED | MAV_MODE_FLAG_SAFETY_ARMED,
      4, // GUIDED
      MAV_STATE_ACTIVE);
  uint8_t buffer[MAVLINK_MAX_PACKET_LEN];
  uint16_t len = mavlink_msg_to_send_buffer(buffer, &hbMsg);
  QByteArray downlinkPacket(reinterpret_cast<const char *>(buffer),
                            static_cast<int>(len));

  gcsServer.sendDataToGcs(downlinkPacket);

  // 5. Đọc gói tin tại Client QGC
  int totalBytes = 0;
  int mavlinkV2Count = 0;
  for (int i = 0; i < 10; ++i) {
    app.processEvents(QEventLoop::AllEvents, 50);
    if (clientSocket.bytesAvailable() > 0 ||
        clientSocket.waitForReadyRead(50)) {
      QByteArray chunk = clientSocket.readAll();
      totalBytes += chunk.size();
      for (int j = 0; j < chunk.size(); ++j) {
        if (static_cast<uint8_t>(chunk.at(j)) == 0xFD) {
          mavlinkV2Count++;
        }
      }
    }
    QThread::msleep(20);
  }

  std::cout << "[TEST] Downlink received " << totalBytes
            << " bytes from LocalGcsServer." << std::endl;
  assert(totalBytes >= len);
  assert(mavlinkV2Count >= 1);

  // 6. [UPLINK TEST]: Bắn lệnh từ Client QGC lên Server
  bool uplinkReceived = false;
  QObject::connect(&gcsServer, &LocalGcsServer::dataReceivedFromGcs,
                   [&](const QByteArray &data) {
                     if (!data.isEmpty())
                       uplinkReceived = true;
                   });

  clientSocket.write(downlinkPacket);
  clientSocket.flush();

  for (int k = 0; k < 10; ++k) {
    app.processEvents(QEventLoop::AllEvents, 50);
    QThread::msleep(20);
  }

  assert(uplinkReceived);
  std::cout << "[TEST] ✅ Uplink data successfully received from GCS Client!"
            << std::endl;

  clientSocket.disconnectFromHost();
  gcsServer.stopServer();

  std::cout << "[TEST] ✅ ALL INTEGRATION TESTS (DOWNLINK + UPLINK) PASSED "
               "SUCCESSFULLY!"
            << std::endl;
  return 0;
}
