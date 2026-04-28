import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import Dashboard from "./Dashboard.jsx";

const navigate = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigate,
  };
});

vi.mock("../api/client", () => ({
  authFetch: vi.fn(),
  getAccessToken: vi.fn(() => "header.eyJleHAiOjQ3MjM1NTIwMDB9.sig"),
  refreshAccessToken: vi.fn(),
}));

function makeToken(expMs) {
  const payload = btoa(JSON.stringify({ exp: Math.floor(expMs / 1000) }));
  return `header.${payload}.sig`;
}

describe("Dashboard", () => {
  beforeEach(async () => {
    navigate.mockReset();
    const { authFetch, getAccessToken, refreshAccessToken } = await import("../api/client");
    authFetch.mockImplementation(async (path, options = {}) => {
      if (path === "/api/auth/my-rooms") {
        return {
          ok: true,
          json: async () => ({ rooms: [{ roomId: "ABCD2345", role: "admin" }] }),
        };
      }

      if (path === "/api/rooms" && options.method === "POST") {
        return {
          ok: true,
          json: async () => ({ roomId: "ZXCV2345" }),
        };
      }

      return {
        ok: false,
        json: async () => ({ msg: "Unexpected request" }),
      };
    });
    getAccessToken.mockReturnValue(makeToken(Date.now() + 60_000));
    refreshAccessToken.mockResolvedValue("fresh-token");
  });

  it("Dashboard renders without inline style attributes", async () => {
    const { container } = render(<Dashboard username="alice" onLogout={vi.fn()} />);
    await screen.findByText("Recent Rooms");
    expect(container.querySelector("[style]")).toBeNull();
  });

  it("Create Room calls the server and navigates to /editor/:roomId", async () => {
    const { authFetch } = await import("../api/client");
    render(<Dashboard username="alice" onLogout={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /create room/i }));

    await waitFor(() => expect(authFetch).toHaveBeenCalledWith(
      "/api/rooms",
      expect.objectContaining({ method: "POST" })
    ));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/editor/ZXCV2345"));
  });

  it("Join Room with invalid format shows error message instead of browser alert", async () => {
    render(<Dashboard username="alice" onLogout={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("ROOM_ID"), { target: { value: "bad" } });
    fireEvent.click(screen.getByRole("button", { name: /join room/i }));
    expect(await screen.findByText("Invalid room ID")).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("Join Room with empty input shows Enter a room code error", async () => {
    render(<Dashboard username="alice" onLogout={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /join room/i }));
    expect(await screen.findByText(/Enter a room code/i)).toBeInTheDocument();
  });

  it("Recent rooms list fetches from /api/auth/my-rooms and renders room cards", async () => {
    const { authFetch } = await import("../api/client");
    render(<Dashboard username="alice" onLogout={vi.fn()} />);
    expect(await screen.findByText("ABCD2345")).toBeInTheDocument();
    expect(authFetch).toHaveBeenCalledWith("/api/auth/my-rooms");
  });

  it("Rejoin button navigates to correct /editor/:roomId", async () => {
    render(<Dashboard username="alice" onLogout={vi.fn()} />);
    const rejoin = await screen.findByRole("button", { name: /rejoin/i });
    fireEvent.click(rejoin);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/editor/ABCD2345"));
  });

  it("refreshes expired access token before creating a room", async () => {
    const { getAccessToken, refreshAccessToken } = await import("../api/client");
    getAccessToken.mockReturnValue(makeToken(Date.now() - 60_000));
    refreshAccessToken.mockResolvedValue("fresh-token");

    render(<Dashboard username="alice" onLogout={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /create room/i }));

    await waitFor(() => expect(refreshAccessToken).toHaveBeenCalled());
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/editor/ZXCV2345"));
  });
});
