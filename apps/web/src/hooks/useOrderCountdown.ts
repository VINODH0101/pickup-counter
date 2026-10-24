import { useEffect, useRef, useState } from "react";

/**
 * A monotonic countdown hook using performance.now().
 *
 * Implements the critical timing rule:
 * - The browser's system clock may be several minutes fast or slow, or change due to NTP updates.
 * - performance.now() provides a strictly monotonic clock independent of wall-clock time.
 * - Measures elapsed milliseconds since the server-authoritative remaining duration was received.
 * - Does NOT authorize payment or pickup based on this client countdown; the server remains authoritative.
 */
export function useOrderCountdown(
  serverExpiresInSeconds: number,
  onExpire?: () => void,
) {
  const [secondsRemaining, setSecondsRemaining] = useState<number>(() =>
    Math.max(0, Math.floor(serverExpiresInSeconds)),
  );

  // Store the reference point in monotonic time
  const startPerfRef = useRef<number>(performance.now());
  const initialDurationRef = useRef<number>(serverExpiresInSeconds);
  const onExpireCalledRef = useRef<boolean>(false);

  // Re-synchronize whenever the server returns a new expiresInSeconds (e.g. from polling GET /orders/:id)
  useEffect(() => {
    startPerfRef.current = performance.now();
    initialDurationRef.current = Math.max(0, serverExpiresInSeconds);
    setSecondsRemaining(Math.max(0, Math.floor(serverExpiresInSeconds)));
    onExpireCalledRef.current = false;
  }, [serverExpiresInSeconds]);

  useEffect(() => {
    if (initialDurationRef.current <= 0) {
      setSecondsRemaining(0);
      return;
    }

    const interval = setInterval(() => {
      const elapsedSeconds = (performance.now() - startPerfRef.current) / 1000;
      const remaining = Math.max(
        0,
        Math.ceil(initialDurationRef.current - elapsedSeconds),
      );

      setSecondsRemaining(remaining);

      if (remaining === 0) {
        clearInterval(interval);
        if (!onExpireCalledRef.current) {
          onExpireCalledRef.current = true;
          onExpire?.();
        }
      }
    }, 250);

    return () => clearInterval(interval);
  }, [onExpire]);

  return secondsRemaining;
}
