import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { DroneTelemetry } from '../types';
import { getStoredToken } from '../services/api';

export const useSocket = (
  onTelemetry?: (data: DroneTelemetry) => void,
  onSshData?: (data: string) => void,
  onSshStatus?: (status: string) => void
) => {
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [latencyMs, setLatencyMs] = useState(0);

  useEffect(() => {
    const token = getStoredToken() || '';
    const socket = io({
      auth: { token },
      query: { token },
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setIsConnected(true);
      socket.emit('subscribe:all');
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
    });

    socket.on('pong', (latency: number) => {
      setLatencyMs(latency);
    });

    if (onTelemetry) {
      socket.on('telemetry:update', (data: DroneTelemetry) => {
        onTelemetry(data);
      });
    }

    if (onSshData) {
      socket.on('ssh:data', (payload: any) => {
        const text = typeof payload === 'string' ? payload : payload?.data || '';
        onSshData(text);
      });
    }

    if (onSshStatus) {
      socket.on('ssh:status', (payload: any) => {
        onSshStatus(payload?.message || payload?.status || '');
      });
    }

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  const emitSshInput = (data: string) => {
    socketRef.current?.emit('ssh:input', { data });
  };

  const emitSshConnect = (params: {
    deviceId: string;
    username: string;
    password?: string;
    cols?: number;
    rows?: number;
  }) => {
    const token = getStoredToken() || '';
    socketRef.current?.emit('ssh:connect', { ...params, token });
  };

  const emitSshDisconnect = () => {
    socketRef.current?.emit('ssh:disconnect');
  };

  const emitSshResize = (cols: number, rows: number) => {
    socketRef.current?.emit('ssh:resize', { cols, rows });
  };

  return {
    socket: socketRef.current,
    isConnected,
    latencyMs,
    emitSshInput,
    emitSshConnect,
    emitSshDisconnect,
    emitSshResize,
  };
};

