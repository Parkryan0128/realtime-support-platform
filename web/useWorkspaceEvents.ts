import { useCallback, useEffect, useState } from "react";
import { io } from "socket.io-client";
import type { TicketChange } from "../server/contracts.js";

export function useWorkspaceEvents(workspaceId: string, csrfToken: string) {
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((value) => value + 1), []);
  const [live, setLive] = useState(false);
  useEffect(() => {
    const socket = io({
      transports: ["websocket"],
      auth: { csrfToken },
    });
    let active = true;
    socket.on("connect", async () => {
      try {
        const ack = await socket
          .timeout(5000)
          .emitWithAck("workspace:watch", { workspaceId });
        if (active) {
          setLive(ack.ok);
          refresh();
        }
      } catch {
        if (active) setLive(false);
      }
    });
    socket.on("disconnect", () => setLive(false));
    socket.on("connect_error", () => setLive(false));
    socket.on("ticket:changed", (change: TicketChange) => {
      if (change.workspaceId === workspaceId) refresh();
    });
    const timer = setInterval(refresh, 15000);
    return () => {
      active = false;
      clearInterval(timer);
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [csrfToken, workspaceId, refresh]);
  return { tick, refresh, live };
}
