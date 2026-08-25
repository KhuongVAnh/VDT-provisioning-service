#include <QCoreApplication>
#include <QFile>
#include <QTextStream>
#include <QRegularExpression>
#include <QHostAddress>
#include <arpa/inet.h>
#include <iostream>

int main(int argc, char *argv[]) {
    QCoreApplication app(argc, argv);
    QFile routeFile("/proc/net/route");
    if (routeFile.open(QIODevice::ReadOnly | QIODevice::Text)) {
        QTextStream in(&routeFile);
        while (!in.atEnd()) {
            QString line = in.readLine().trimmed();
            QStringList parts = line.split(QRegularExpression("\\s+"), Qt::SkipEmptyParts);
            if (parts.size() >= 3 && parts[1] == "00000000") {
                bool ok = false;
                uint32_t gwHex = parts[2].toUInt(&ok, 16);
                if (ok && gwHex != 0) {
                    struct in_addr addr;
                    addr.s_addr = gwHex;
                    char ipBuf[INET_ADDRSTRLEN];
                    if (inet_ntop(AF_INET, &addr, ipBuf, sizeof(ipBuf))) {
                        std::cout << "FOUND GATEWAY: " << ipBuf << std::endl;
                        return 0;
                    }
                }
            }
        }
    }
    std::cout << "NOT FOUND!" << std::endl;
    return 1;
}
