import { useCallback, useEffect, useRef, useState } from "react";

const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

export function useWebRTC({ socketRef, joined, usersRef, showVideo }) {
  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [remoteStreams, setRemoteStreams] = useState({});
  const [mutedPeers, setMutedPeers] = useState(new Set());

  const localStreamRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRefs = useRef({});
  const pcsRef = useRef({});
  const iceBufRef = useRef({});
  const makingOfferRef = useRef({});
  const callEndedRef = useRef(false);

  const removePeer = useCallback((peerId) => {
    setRemoteStreams((prev) => {
      if (!prev[peerId]) return prev;
      const next = { ...prev };
      delete next[peerId];
      return next;
    });

    const pc = pcsRef.current[peerId];
    if (pc) {
      pc.close();
      delete pcsRef.current[peerId];
    }

    delete iceBufRef.current[peerId];
    delete remoteVideoRefs.current[peerId];
  }, []);

  const drainIce = useCallback(async (id) => {
    const pc = pcsRef.current[id];
    if (!pc?.remoteDescription) return;

    for (const candidate of iceBufRef.current[id] || []) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        console.warn("[ICE] drain error", error);
      }
    }

    delete iceBufRef.current[id];
  }, []);

  const createPC = useCallback((remoteId) => {
    if (pcsRef.current[remoteId]) return pcsRef.current[remoteId];

    const pc = new RTCPeerConnection(RTC_CONFIG);
    pcsRef.current[remoteId] = pc;

    pc.onicecandidate = ({ candidate }) => {
      if (candidate && socketRef.current?.connected) {
        socketRef.current.emit("webrtc-ice-candidate", { to: remoteId, candidate });
      }
    };

    pc.ontrack = ({ streams }) => {
      const stream = streams[0];
      const user = usersRef?.current?.find((entry) => entry.id === remoteId);
      setRemoteStreams((prev) => ({
        ...prev,
        [remoteId]: { stream, username: user?.username || "Peer" },
      }));
    };

    pc.onconnectionstatechange = () => {
      if (["disconnected", "failed", "closed"].includes(pc.connectionState)) {
        removePeer(remoteId);
      }
    };

    return pc;
  }, [removePeer, socketRef, usersRef]);

  const sendOffer = useCallback(async (remoteId) => {
    if (callEndedRef.current) return;
    const pc = pcsRef.current[remoteId];
    if (!pc || makingOfferRef.current[remoteId]) return;

    makingOfferRef.current[remoteId] = true;
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (socketRef.current?.connected) {
        socketRef.current.emit("webrtc-offer", { to: remoteId, offer: pc.localDescription });
      }
    } catch (error) {
      console.error("[RTC] sendOffer error", error);
    } finally {
      makingOfferRef.current[remoteId] = false;
    }
  }, [socketRef]);

  const addTrackToAll = useCallback(async (track, stream) => {
    for (const [peerId, pc] of Object.entries(pcsRef.current)) {
      if (pc.getSenders().some((sender) => sender.track === track)) continue;
      pc.addTrack(track, stream);
      await sendOffer(peerId);
    }
  }, [sendOffer]);

  const connectToExistingPeers = useCallback(async () => {
    if (callEndedRef.current) return;
    const socket = socketRef.current;
    if (!socket?.connected) return;

    const peerIds = (usersRef?.current || [])
      .map((entry) => entry.id)
      .filter((id) => id && id !== socket.id);

    for (const peerId of peerIds) {
      const pc = createPC(peerId);
      localStreamRef.current?.getTracks().forEach((track) => {
        if (!pc.getSenders().some((sender) => sender.track === track)) {
          pc.addTrack(track, localStreamRef.current);
        }
      });
      await sendOffer(peerId);
    }
  }, [createPC, sendOffer, socketRef, usersRef]);

  const replaceTrackInAll = useCallback(async (kind, newTrack) => {
    for (const [peerId, pc] of Object.entries(pcsRef.current)) {
      const sender = pc.getSenders().find((entry) => entry.track?.kind === kind);

      if (sender && newTrack) {
        await sender.replaceTrack(newTrack);
        continue;
      }

      if (sender && !newTrack) {
        pc.removeTrack(sender);
        await sendOffer(peerId);
        continue;
      }

      if (!sender && newTrack && localStreamRef.current) {
        pc.addTrack(newTrack, localStreamRef.current);
        await sendOffer(peerId);
      }
    }
  }, [sendOffer]);

  const attachStreamToVideo = useCallback((videoEl, stream) => {
    if (!videoEl || !stream) return;
    if (videoEl.srcObject === stream) return;

    videoEl.srcObject = stream;
    videoEl.play().catch((error) => {
      if (error.name !== "AbortError") {
        console.warn("[Video] play()", error);
      }
    });
  }, []);

  useEffect(() => {
    if (!camOn || !showVideo) return;
    attachStreamToVideo(localVideoRef.current, localStreamRef.current);
  }, [camOn, showVideo, attachStreamToVideo]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !joined) return undefined;

    const handlePeerJoined = ({ socketId }) => {
      if (callEndedRef.current) return;
      const pc = createPC(socketId);
      localStreamRef.current?.getTracks().forEach((track) => {
        if (!pc.getSenders().some((sender) => sender.track === track)) {
          pc.addTrack(track, localStreamRef.current);
        }
      });
      sendOffer(socketId);
    };

    const handlePeerLeft = ({ socketId }) => {
      if (!socketId) return;
      removePeer(socketId);
    };

    const handleOffer = async ({ from, offer }) => {
      if (callEndedRef.current) return;
      const pc = createPC(from);

      localStreamRef.current?.getTracks().forEach((track) => {
        if (!pc.getSenders().some((sender) => sender.track === track)) {
          pc.addTrack(track, localStreamRef.current);
        }
      });

      try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        await drainIce(from);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit("webrtc-answer", { to: from, answer: pc.localDescription });
      } catch (error) {
        console.error("[Signal] offer handler", error);
      }
    };

    const handleAnswer = async ({ from, answer }) => {
      if (callEndedRef.current) return;
      const pc = pcsRef.current[from];
      if (!pc) return;

      try {
        if (pc.signalingState === "have-local-offer") {
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
          await drainIce(from);
        }
      } catch (error) {
        console.error("[Signal] answer handler", error);
      }
    };

    const handleIceCandidate = async ({ from, candidate }) => {
      if (callEndedRef.current) return;
      const pc = pcsRef.current[from];
      if (pc?.remoteDescription) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (error) {
          console.warn("[ICE] addIceCandidate error", error);
        }
        return;
      }

      if (!iceBufRef.current[from]) iceBufRef.current[from] = [];
      iceBufRef.current[from].push(candidate);
    };

    const handleRemoteEndCall = ({ from }) => {
      if (!from) return;
      removePeer(from);
    };

    socket.on("peer-joined", handlePeerJoined);
    socket.on("peer-left", handlePeerLeft);
    socket.on("webrtc-offer", handleOffer);
    socket.on("webrtc-answer", handleAnswer);
    socket.on("webrtc-ice-candidate", handleIceCandidate);
    socket.on("webrtc-end-call", handleRemoteEndCall);

    return () => {
      socket.off("peer-joined", handlePeerJoined);
      socket.off("peer-left", handlePeerLeft);
      socket.off("webrtc-offer", handleOffer);
      socket.off("webrtc-answer", handleAnswer);
      socket.off("webrtc-ice-candidate", handleIceCandidate);
      socket.off("webrtc-end-call", handleRemoteEndCall);

      Object.values(pcsRef.current).forEach((pc) => pc.close());
      pcsRef.current = {};
      iceBufRef.current = {};
      makingOfferRef.current = {};
      callEndedRef.current = false;

      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    };
  }, [joined, socketRef, createPC, sendOffer, drainIce, removePeer]);

  const toggleMic = useCallback(async () => {
    if (micOn) {
      const track = localStreamRef.current?.getAudioTracks()[0];
      if (track) {
        track.stop();
        localStreamRef.current.removeTrack(track);
        await replaceTrackInAll("audio", null);
      }
      setMicOn(false);
      return;
    }

    try {
      callEndedRef.current = false;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      const track = stream.getAudioTracks()[0];
      if (!localStreamRef.current) localStreamRef.current = new MediaStream();

      const existing = localStreamRef.current.getAudioTracks()[0];
      if (existing) {
        existing.stop();
        localStreamRef.current.removeTrack(existing);
        localStreamRef.current.addTrack(track);
        await replaceTrackInAll("audio", track);
      } else {
        localStreamRef.current.addTrack(track);
        await addTrackToAll(track, localStreamRef.current);
      }

      await connectToExistingPeers();
      setMicOn(true);
    } catch (error) {
      console.error("[WebRTC] toggleMic error", error);
    }
  }, [micOn, addTrackToAll, replaceTrackInAll, connectToExistingPeers]);

  const toggleCam = useCallback(async () => {
    if (camOn) {
      const track = localStreamRef.current?.getVideoTracks()[0];
      if (track) {
        track.stop();
        localStreamRef.current.removeTrack(track);
        await replaceTrackInAll("video", null);
      }

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = null;
      }

      setCamOn(false);
      return;
    }

    try {
      callEndedRef.current = false;
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      const track = stream.getVideoTracks()[0];

      if (!localStreamRef.current || localStreamRef.current.active === false) {
        localStreamRef.current = new MediaStream();
      }

      const existing = localStreamRef.current.getVideoTracks()[0];
      if (existing) {
        existing.stop();
        localStreamRef.current.removeTrack(existing);
        localStreamRef.current.addTrack(track);
        await replaceTrackInAll("video", track);
      } else {
        localStreamRef.current.addTrack(track);
        await addTrackToAll(track, localStreamRef.current);
      }

      await connectToExistingPeers();
      attachStreamToVideo(localVideoRef.current, localStreamRef.current);
      setCamOn(true);
    } catch (error) {
      console.error("[WebRTC] toggleCam error", error);
    }
  }, [camOn, addTrackToAll, replaceTrackInAll, attachStreamToVideo, connectToExistingPeers]);

  const endCall = useCallback(() => {
    callEndedRef.current = true;
    if (socketRef.current?.connected) {
      socketRef.current.emit("webrtc-end-call");
    }

    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;

    Object.values(pcsRef.current).forEach((pc) => pc.close());
    pcsRef.current = {};
    iceBufRef.current = {};
    makingOfferRef.current = {};

    setMicOn(false);
    setCamOn(false);
    setRemoteStreams({});
    setMutedPeers(new Set());

    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
  }, [socketRef]);

  return {
    micOn,
    camOn,
    remoteStreams,
    localVideoRef,
    remoteVideoRefs,
    toggleMic,
    toggleCam,
    endCall,
    mutedPeers,
    setMutedPeers,
  };
}
