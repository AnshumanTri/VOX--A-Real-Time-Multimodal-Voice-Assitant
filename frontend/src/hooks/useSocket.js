import { useEffect, useRef, useState, useCallback } from "react";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:8000/ws";

export function useSocket(onMessage, onAudio) {
  const wsRef = useRef(null);
  const [status, setStatus] = useState("connecting"); // connecting | open | closed

  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    ws.binaryType = "blob";
    wsRef.current = ws;

    ws.onopen = () => setStatus("open");
    ws.onclose = () => setStatus("closed");
    ws.onerror = () => setStatus("closed");
    ws.onmessage = (event) => {
      if (event.data instanceof Blob) {
        onAudio?.(event.data);
        return;
      }
      try {
        onMessage?.(JSON.parse(event.data));
      } catch {
        onMessage?.({ type: "raw", text: event.data });
      }
    };

    return () => ws.close();
  }, []);

  const sendText = useCallback((text) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(text);
    }
  }, []);

  const sendBinary = useCallback((blob) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(blob);
    }
  }, []);

  return { status, sendText, sendBinary };
}