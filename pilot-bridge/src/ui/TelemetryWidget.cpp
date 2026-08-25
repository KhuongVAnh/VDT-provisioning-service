#include "TelemetryWidget.h"
#include "StyleHelper.h"
#include <QGridLayout>
#include <QHBoxLayout>
#include <QVBoxLayout>
#include <QGroupBox>
#include <cmath>

TelemetryWidget::TelemetryWidget(QWidget *parent)
    : QWidget(parent)
{
    setupUi();
}

void TelemetryWidget::setupUi() {
    auto *mainLayout = new QGridLayout(this);
    mainLayout->setContentsMargins(0, 0, 0, 0);
    mainLayout->setSpacing(12);

    // 1. Flight Status Box
    auto *boxStatus = new QGroupBox("TRẠNG THÁI BAY (FLIGHT STATUS)", this);
    auto *layoutStatus = new QGridLayout(boxStatus);

    m_lblMode = new QLabel("GUIDED", this);
    m_lblMode->setStyleSheet("font-size: 16px; font-weight: bold; color: #38bdf8;");
    m_lblArmed = new QLabel("ARMED", this);
    m_lblArmed->setStyleSheet(StyleHelper::getStatusBadgeStyle(true, "green"));

    layoutStatus->addWidget(new QLabel("Flight Mode:", this), 0, 0);
    layoutStatus->addWidget(m_lblMode, 0, 1);
    layoutStatus->addWidget(new QLabel("Arming State:", this), 1, 0);
    layoutStatus->addWidget(m_lblArmed, 1, 1);

    // 2. Navigation & GPS Box
    auto *boxNav = new QGroupBox("VỊ TRÍ & CAO ĐỘ (GPS & NAVIGATION)", this);
    auto *layoutNav = new QGridLayout(boxNav);

    m_lblLat = new QLabel("21.005512° N", this);
    m_lblLon = new QLabel("105.843120° E", this);
    m_lblAlt = new QLabel("Rel: 65.0 m (MSL: 75.0 m)", this);
    m_lblSatellites = new QLabel("18 🛰️ (3D Fix)", this);

    m_lblLat->setStyleSheet("font-family: monospace; font-weight: bold; color: #f8fafc;");
    m_lblLon->setStyleSheet("font-family: monospace; font-weight: bold; color: #f8fafc;");
    m_lblAlt->setStyleSheet("font-family: monospace; font-weight: bold; color: #38bdf8;");

    layoutNav->addWidget(new QLabel("Latitude:", this), 0, 0);
    layoutNav->addWidget(m_lblLat, 0, 1);
    layoutNav->addWidget(new QLabel("Longitude:", this), 1, 0);
    layoutNav->addWidget(m_lblLon, 1, 1);
    layoutNav->addWidget(new QLabel("Altitude:", this), 2, 0);
    layoutNav->addWidget(m_lblAlt, 2, 1);
    layoutNav->addWidget(new QLabel("GPS Quality:", this), 3, 0);
    layoutNav->addWidget(m_lblSatellites, 3, 1);

    // 3. Motion & Attitude Box
    auto *boxMotion = new QGroupBox("VẬN TỐC & GÓC NGHIÊNG (MOTION & ATTITUDE)", this);
    auto *layoutMotion = new QGridLayout(boxMotion);

    m_lblSpeed = new QLabel("10.5 m/s (37.8 km/h)", this);
    m_lblHeading = new QLabel("045° (NE)", this);
    m_lblAttitude = new QLabel("Roll: -12.0° | Pitch: -2.8°", this);

    m_lblSpeed->setStyleSheet("font-family: monospace; font-weight: bold; color: #34d399;");
    m_lblHeading->setStyleSheet("font-family: monospace; font-weight: bold; color: #fbbf24;");
    m_lblAttitude->setStyleSheet("font-family: monospace; font-weight: bold; color: #f8fafc;");

    layoutMotion->addWidget(new QLabel("Ground Speed:", this), 0, 0);
    layoutMotion->addWidget(m_lblSpeed, 0, 1);
    layoutMotion->addWidget(new QLabel("Heading:", this), 1, 0);
    layoutMotion->addWidget(m_lblHeading, 1, 1);
    layoutMotion->addWidget(new QLabel("Attitude:", this), 2, 0);
    layoutMotion->addWidget(m_lblAttitude, 2, 1);

    // 4. Power & Link Box
    auto *boxPower = new QGroupBox("NGUỒN ĐIỆN & KẾT NỐI QGC", this);
    auto *layoutPower = new QGridLayout(boxPower);

    m_lblBatteryVal = new QLabel("98% (15.4V - 12.5A)", this);
    m_lblBatteryVal->setStyleSheet("font-weight: bold; color: #34d399;");
    m_barBattery = new QProgressBar(this);
    m_barBattery->setRange(0, 100);
    m_barBattery->setValue(98);
    m_barBattery->setFixedHeight(16);

    m_lblGcsStatus = new QLabel("Đang chờ QGroundControl kết nối...", this);
    m_lblGcsStatus->setStyleSheet(StyleHelper::getStatusBadgeStyle(false));
    m_lblThroughput = new QLabel("TX: 0.0 kbps | RX: 0.0 kbps", this);
    m_lblThroughput->setStyleSheet("font-family: monospace; color: #94a3b8;");

    layoutPower->addWidget(new QLabel("Battery:", this), 0, 0);
    layoutPower->addWidget(m_lblBatteryVal, 0, 1);
    layoutPower->addWidget(m_barBattery, 1, 0, 1, 2);
    layoutPower->addWidget(new QLabel("QGC Link:", this), 2, 0);
    layoutPower->addWidget(m_lblGcsStatus, 2, 1);
    layoutPower->addWidget(new QLabel("Bitrate:", this), 3, 0);
    layoutPower->addWidget(m_lblThroughput, 3, 1);

    // Thêm vào grid 2x2
    mainLayout->addWidget(boxStatus, 0, 0);
    mainLayout->addWidget(boxNav, 0, 1);
    mainLayout->addWidget(boxMotion, 1, 0);
    mainLayout->addWidget(boxPower, 1, 1);
}

void TelemetryWidget::updateTelemetry(const TelemetryData &data) {
    m_lblMode->setText(data.flightModeName);
    m_lblArmed->setText(data.isArmed ? "ARMED" : "DISARMED");
    m_lblArmed->setStyleSheet(StyleHelper::getStatusBadgeStyle(data.isArmed, "green"));

    m_lblLat->setText(QString::number(data.latitude, 'f', 6) + "°");
    m_lblLon->setText(QString::number(data.longitude, 'f', 6) + "°");
    m_lblAlt->setText(QString("Rel: %1 m (MSL: %2 m)").arg(data.altitudeRel, 0, 'f', 1).arg(data.altitudeMsl, 0, 'f', 1));
    m_lblSatellites->setText(QString("%1 🛰️ (3D Fix)").arg(data.satellites));

    m_lblSpeed->setText(QString("%1 m/s (%2 km/h)").arg(data.speedMs, 0, 'f', 1).arg(data.speedMs * 3.6, 0, 'f', 1));
    m_lblHeading->setText(QString("%1°").arg(data.headingDeg, 0, 'f', 1));

    float rollDeg = data.rollRad * (180.0f / 3.14159265f);
    float pitchDeg = data.pitchRad * (180.0f / 3.14159265f);
    m_lblAttitude->setText(QString("Roll: %1° | Pitch: %2°").arg(rollDeg, 0, 'f', 1).arg(pitchDeg, 0, 'f', 1));

    m_barBattery->setValue(data.batteryPct);
    m_lblBatteryVal->setText(QString("%1% (%2V - %3A)")
                             .arg(data.batteryPct)
                             .arg(data.batteryVoltageMv / 1000.0, 0, 'f', 1)
                             .arg(data.batteryCurrentCa / 100.0, 0, 'f', 1));

    if (data.batteryPct < 20) {
        m_lblBatteryVal->setStyleSheet("font-weight: bold; color: #ef4444;");
    } else if (data.batteryPct < 50) {
        m_lblBatteryVal->setStyleSheet("font-weight: bold; color: #f59e0b;");
    } else {
        m_lblBatteryVal->setStyleSheet("font-weight: bold; color: #34d399;");
    }
}

void TelemetryWidget::updateGcsStatus(int clientCount, quint16 port) {
    if (clientCount > 0) {
        m_lblGcsStatus->setText(QString("🟢 QGC ĐÃ KẾT NỐI (%1 clients trên port %2)").arg(clientCount).arg(port));
        m_lblGcsStatus->setStyleSheet(StyleHelper::getStatusBadgeStyle(true, "cyan"));
    } else {
        m_lblGcsStatus->setText(QString("🟡 Đang chờ QGC (TCP: 0.0.0.0:%1)...").arg(port));
        m_lblGcsStatus->setStyleSheet(StyleHelper::getStatusBadgeStyle(false));
    }
}

void TelemetryWidget::updateThroughput(double txKbps, double rxKbps, uint64_t totalTx, uint64_t totalRx) {
    Q_UNUSED(totalTx);
    Q_UNUSED(totalRx);
    m_lblThroughput->setText(QString("TX: %1 kbps | RX: %2 kbps").arg(txKbps, 0, 'f', 1).arg(rxKbps, 0, 'f', 1));
}
