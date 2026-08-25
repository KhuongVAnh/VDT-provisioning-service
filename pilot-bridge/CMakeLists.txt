cmake_minimum_required(VERSION 3.16)
project(PilotBridge VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)
set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)
set(CMAKE_AUTOUIC ON)

find_package(Qt6 REQUIRED COMPONENTS Core Gui Widgets Network WebSockets)
find_package(OpenSSL REQUIRED)

set(NO_MEDIA OFF CACHE BOOL "" FORCE)
set(USE_SYSTEM_OPENSSL ON CACHE BOOL "" FORCE)
set(USE_GNUTLS OFF CACHE BOOL "" FORCE)
set(NO_WEBSOCKET ON CACHE BOOL "" FORCE)
set(NO_TESTS ON CACHE BOOL "" FORCE)
set(NO_EXAMPLES ON CACHE BOOL "" FORCE)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)

if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/3rdparty/libdatachannel/CMakeLists.txt")
    add_subdirectory(3rdparty/libdatachannel)
endif()

include_directories(
    ${CMAKE_CURRENT_SOURCE_DIR}/src
    ${CMAKE_CURRENT_SOURCE_DIR}/3rdparty/mavlink
    ${CMAKE_CURRENT_SOURCE_DIR}/3rdparty/mavlink/common
    ${CMAKE_CURRENT_SOURCE_DIR}/3rdparty/mavlink/ardupilotmega
    ${CMAKE_CURRENT_SOURCE_DIR}/3rdparty/libdatachannel/include
)

set(SOURCES
    src/main.cpp
    src/api/AuthService.h
    src/api/AuthService.cpp
    src/video/VideoRelayBridge.h
    src/video/VideoRelayBridge.cpp
    src/bridge/TelemetryModel.h
    src/bridge/LocalGcsServer.h
    src/bridge/LocalGcsServer.cpp
    src/bridge/WebSocketClient.h
    src/bridge/WebSocketClient.cpp
    src/bridge/DroneBridgeCore.h
    src/bridge/DroneBridgeCore.cpp
    src/ui/StyleHelper.h
    src/ui/StyleHelper.cpp
    src/ui/TelemetryWidget.h
    src/ui/TelemetryWidget.cpp
    src/ui/LoginWidget.h
    src/ui/LoginWidget.cpp
    src/ui/ControlWidget.h
    src/ui/ControlWidget.cpp
    src/ui/MainWindow.h
    src/ui/MainWindow.cpp
)

add_executable(pilot_bridge ${SOURCES})

target_link_libraries(pilot_bridge PRIVATE
    Qt6::Core
    Qt6::Gui
    Qt6::Widgets
    Qt6::Network
    Qt6::WebSockets
    datachannel
    OpenSSL::SSL
    OpenSSL::Crypto
)

# Compiler options & definitions
target_compile_options(pilot_bridge PRIVATE -Wno-address-of-packed-member -Wno-unused-parameter)
target_compile_definitions(pilot_bridge PRIVATE
    MAVLINK_USE_MESSAGE_INFO
    MAVLINK_COMM_NUM_BUFFERS=4
)

# Test target
add_executable(test_bridge_core
    tests/test_bridge_core.cpp
    src/bridge/TelemetryModel.h
    src/bridge/LocalGcsServer.h
    src/bridge/LocalGcsServer.cpp
    src/bridge/WebSocketClient.h
    src/bridge/WebSocketClient.cpp
    src/bridge/DroneBridgeCore.h
    src/bridge/DroneBridgeCore.cpp
    src/video/VideoRelayBridge.h
    src/video/VideoRelayBridge.cpp
)
target_link_libraries(test_bridge_core PRIVATE
    Qt6::Core
    Qt6::Network
    Qt6::WebSockets
    datachannel
    OpenSSL::SSL
    OpenSSL::Crypto
)
target_compile_options(test_bridge_core PRIVATE -Wno-address-of-packed-member -Wno-unused-parameter)
target_compile_definitions(test_bridge_core PRIVATE
    MAVLINK_USE_MESSAGE_INFO
    MAVLINK_COMM_NUM_BUFFERS=4
)
