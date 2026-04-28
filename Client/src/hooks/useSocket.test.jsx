import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { io } from "socket.io-client";
import { refreshAccessToken } from "../api/auth";
import { clearAuthTokens, getAccessToken } from "../api/client";
import { useSocket } from "./useSocket";

vi.mock("socket.io-client", () => ({
  io: vi.fn(),
}));

vi.mock("../api/auth", () => ({
  refreshAccessToken: vi.fn(),
}));

vi.mock("../api/client", () => ({
  clearAuthTokens: vi.fn(),
  getAccessToken: vi.fn(),
}));

function makeToken(expMs) {
  const payload = btoa(JSON.stringify({ exp: Math.floor(expMs / 1000) }));
  return `header.${payload}.sig`;
}

function createSocket() {
  const handlers = {};
  const ioHandlers = {};
  const socket = {
    connected: false,
    auth: {},
    io: {
      on: vi.fn((event, handler) => {
        ioHandlers[event] = handler;
      }),
      removeAllListeners: vi.fn(),
      handlers: ioHandlers,
    },
    on: vi.fn((event, handler) => {
      handlers[event] = handler;
    }),
    once: vi.fn((event, handler) => {
      handlers[event] = handler;
    }),
    off: vi.fn(),
    emit: vi.fn(),
    connect: vi.fn(() => {
      socket.connected = true;
    }),
    disconnect: vi.fn(() => {
      socket.connected = false;
    }),
    removeAllListeners: vi.fn(),
    handlers,
  };
  return socket;
}

function fsMock() {
  return {
    loadRoomState: vi.fn(),
    setActiveFile: vi.fn(),
    applyFileCreated: vi.fn(),
    applyFolderCreated: vi.fn(),
    applyFileRenamed: vi.fn(),
    applyFolderRenamed: vi.fn(),
    applyFileDeleted: vi.fn(),
    applyFolderDeleted: vi.fn(),
    applyFileUpdated: vi.fn(),
  };
}

function renderSocketHook({
  roomId = "ABCD2345",
  socket = createSocket(),
  navigate = vi.fn(),
  fs = fsMock(),
  setEditorKey = vi.fn(),
  setEditorNotification,
} = {}) {
  io.mockReturnValue(socket);
  const view = renderHook(() =>
    useSocket({ roomId, navigate, fs, setEditorKey, setEditorNotification }),
  );
  return { socket, navigate, fs, setEditorKey, ...view };
}

describe("useSocket auth and room lifecycle", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    getAccessToken.mockReturnValue(makeToken(Date.now() + 60_000));
    refreshAccessToken.mockResolvedValue(true);
    io.mockReturnValue(createSocket());
  });

  it("initializes with fresh token, connects, and emits join-room on connect", async () => {
    const socket = createSocket();
    const fs = fsMock();
    renderSocketHook({ socket, fs });

    await Promise.resolve();
    await Promise.resolve();
    expect(socket.connect).toHaveBeenCalled();
    act(() => socket.handlers.connect());

    expect(socket.auth.token).toBe(getAccessToken.mock.results[0].value);
    expect(socket.emit).toHaveBeenCalledWith("join-room", { roomId: "ABCD2345" });
  });

  it("refreshes token on connect_error with JWT expiry message, then reconnects", async () => {
    const socket = createSocket();
    const fs = fsMock();
    getAccessToken
      .mockReturnValueOnce(makeToken(Date.now() + 60_000))
      .mockReturnValue(makeToken(Date.now() + 120_000));

    renderSocketHook({ socket, fs });

    await waitFor(() => expect(socket.connect).toHaveBeenCalledTimes(1));
    await act(async () => {
      await socket.handlers.connect_error({ message: "jwt expired" });
    });

    expect(refreshAccessToken).toHaveBeenCalled();
    expect(socket.connect).toHaveBeenCalledTimes(2);
  });

  it("navigates to /login if token refresh fails", async () => {
    const socket = createSocket();
    const fs = fsMock();
    const navigate = vi.fn();
    refreshAccessToken.mockResolvedValue(false);

    renderSocketHook({ socket, navigate, fs });

    await Promise.resolve();
    await Promise.resolve();
    expect(socket.connect).toHaveBeenCalled();
    await act(async () => {
      await socket.handlers.connect_error({ message: "jwt expired" });
    });

    expect(clearAuthTokens).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/login");
  });

  it("join-room times out after 10 seconds if room-state is never received", async () => {
    vi.useFakeTimers();
    const socket = createSocket();
    const fs = fsMock();
    const { result } = renderSocketHook({ socket, fs });

    await Promise.resolve();
    await Promise.resolve();
    expect(socket.connect).toHaveBeenCalled();
    act(() => socket.handlers.connect());
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });

    expect(result.current.socketStatus).toBe("error");
    expect(result.current.socketIssue).toContain("Room join timed out");
  });

  it("socket reconnection re-emits join-room with the last roomId", async () => {
    const socket = createSocket();
    const fs = fsMock();
    renderSocketHook({ socket, fs });

    await waitFor(() => expect(socket.connect).toHaveBeenCalled());
    act(() => socket.handlers.connect());
    act(() => socket.handlers.connect());

    expect(socket.emit).toHaveBeenCalledWith("join-room", { roomId: "ABCD2345" });
    expect(socket.emit.mock.calls.filter(([event]) => event === "join-room")).toHaveLength(2);
  });

  it("permission-denied socket event triggers editorNotification state update", async () => {
    const socket = createSocket();
    const fs = fsMock();
    const setEditorNotification = vi.fn();
    renderSocketHook({ socket, fs, setEditorNotification });

    await waitFor(() => expect(socket.connect).toHaveBeenCalled());
    act(() => socket.handlers["permission-denied"]({ permission: "EDIT_FILES", reason: "Requires editor" }));

    expect(setEditorNotification).toHaveBeenCalledWith("Action blocked: Requires editor");
  });

  it("role-changed socket event updates userRole state", async () => {
    const socket = createSocket();
    const fs = fsMock();
    const { result } = renderSocketHook({ socket, fs });

    await waitFor(() => expect(socket.connect).toHaveBeenCalled());
    act(() => socket.handlers["role-changed"]({ roomId: "ABCD2345", oldRole: "viewer", newRole: "editor" }));

    expect(result.current.userRole).toBe("editor");
  });

  it("removed-from-room socket event navigates to dashboard", async () => {
    vi.useFakeTimers();
    const socket = createSocket();
    const fs = fsMock();
    const navigate = vi.fn();
    renderSocketHook({ socket, navigate, fs });

    await Promise.resolve();
    await Promise.resolve();
    expect(socket.connect).toHaveBeenCalled();
    act(() => socket.handlers["removed-from-room"]({ roomId: "ABCD2345", reason: "removed" }));
    await act(async () => {
      vi.advanceTimersByTime(600);
    });

    expect(navigate).toHaveBeenCalledWith("/dashboard");
  });
});
