import { useCallback, useRef, useState } from "react";

export function useAudioQueue(onSentenceStart) {
  const queueRef = useRef([]);
  const playingRef = useRef(false);
  const audioElRef = useRef(null);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const playNext = useCallback(() => {
    const next = queueRef.current.shift();
    if (!next) {
      playingRef.current = false;
      setIsSpeaking(false);
      return;
    }
    playingRef.current = true;
    setIsSpeaking(true);
    onSentenceStart?.(next.text);
    const url = URL.createObjectURL(next.blob);
    const audio = new Audio(url);
    audioElRef.current = audio;
    audio.onended = () => {
      URL.revokeObjectURL(url);
      playNext();
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      playNext();
    };
    audio.play().catch(() => playNext());
  }, [onSentenceStart]);

  const enqueue = useCallback(
    (item) => {
      queueRef.current.push(item);
      if (!playingRef.current) playNext();
    },
    [playNext]
  );

  const reset = useCallback(() => {
    queueRef.current = [];
    audioElRef.current?.pause();
    playingRef.current = false;
    setIsSpeaking(false);
  }, []);

  return { enqueue, reset, isSpeaking };
}