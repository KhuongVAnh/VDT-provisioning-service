#pragma once

#include <QWidget>
#include <QLabel>
#include <QProgressBar>
#include "../bridge/TelemetryModel.h"

class TelemetryWidget : public QWidget {
    Q_OBJECT

public:
    explicit TelemetryWidget(QWidget *parent = nullptr);
    ~TelemetryWidget() override = default;

public slots:
    void updateTelemetry(const TelemetryData &data);
    void updateGcsStatus(int clientCount, quint16 port);
    void updateThroughput(double txKbps, double rxKbps, uint64_t totalTx, uint64_t totalRx);

private:
    void setupUi();
    QWidget* createCard(const QString &title, QWidget *contentWidget);

    // Labels
    QLabel *m_lblMode;
    QLabel *m_lblArmed;
    QLabel *m_lblLat;
    QLabel *m_lblLon;
    QLabel *m_lblAlt;
    QLabel *m_lblSpeed;
    QLabel *m_lblHeading;
    QLabel *m_lblAttitude;
    QLabel *m_lblSatellites;
    QLabel *m_lblBatteryVal;
    QProgressBar *m_barBattery;
    QLabel *m_lblGcsStatus;
    QLabel *m_lblThroughput;
};
