/**
 * WebSocket Hook for real-time game updates
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import type { WSMessage, WSEventType } from '../types';

interface UseWebSocketOptions {
  url: string;
  onMessage?: (message: WSMessage) => void;
  reconnectInterval?: number;
  reconnectAttempts?: number;
}

interface UseWebSocketReturn {
  isConnected: boolean;
  lastMessage: WSMessage | null;
  error: string | null;
  subscribe: (events: WSEventType[]) => void;
  unsubscribe: (events: WSEventType[]) => void;
}

export function useWebSocket(options: UseWebSocketOptions): UseWebSocketReturn {
  const { url, onMessage, reconnectInterval = 3000, reconnectAttempts = 5 } = options;
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectCountRef = useRef(0);
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WSMessage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(() => {
    try {
      const ws = new WebSocket(url);

      ws.onopen = () => {
        console.log('[WebSocket] Connected');
        setIsConnected(true);
        setError(null);
        reconnectCountRef.current = 0;
      };

      ws.onclose = () => {
        console.log('[WebSocket] Disconnected');
        setIsConnected(false);

        // Attempt reconnect if under limit
        if (reconnectCountRef.current < reconnectAttempts) {
          reconnectCountRef.current++;
          reconnectTimeoutRef.current = setTimeout(() => {
            console.log(`[WebSocket] Attempting reconnect (${reconnectCountRef.current}/${reconnectAttempts})...`);
            connect();
          }, reconnectInterval);
        } else {
          setError('Failed to connect to server after multiple attempts');
        }
      };

      ws.onerror = () => {
        console.error('[WebSocket] Connection error');
        setError('WebSocket connection error');
      };

      ws.onmessage = (event) => {
        try {
          const message: WSMessage = JSON.parse(event.data);
          setLastMessage(message);
          onMessage?.(message);
        } catch (err) {
          console.error('[WebSocket] Failed to parse message:', err);
        }
      };

      wsRef.current = ws;
    } catch (err) {
      console.error('[WebSocket] Failed to connect:', err);
      setError('Failed to create WebSocket connection');
    }
  }, [url, onMessage, reconnectInterval, reconnectAttempts]);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  const subscribe = useCallback((events: WSEventType[]) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'subscribe', events }));
    }
  }, []);

  const unsubscribe = useCallback((events: WSEventType[]) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'unsubscribe', events }));
    }
  }, []);

  return { isConnected, lastMessage, error, subscribe, unsubscribe };
}

/**
 * Hook for specific WebSocket events with typed data
 */
export function useWSEvent<T>(
  lastMessage: WSMessage | null,
  eventType: WSEventType
): T | null {
  const [data, setData] = useState<T | null>(null);

  useEffect(() => {
    if (lastMessage?.type === eventType) {
      setData(lastMessage.data as T);
    }
  }, [lastMessage, eventType]);

  return data;
}

export default useWebSocket;
