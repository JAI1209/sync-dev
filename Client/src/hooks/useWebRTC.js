import { useCallback, useEffect, useRef, useState } from "react";

const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

export function useWebRTC({ socketRef, joined, usersRef }) {
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

  const drainIce = useCallback(async (id) => {
    const pc = pcsRef.current[id];
    if (!pc?.remoteDescription) return;
    for (const candidate of iceBufRef.current[id] || []) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.warn("[ICE] drain error", err);
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
      const user = usersRef?.current?.find((u) => u.id === remoteId);
      setRemoteStreams((prev) => ({
        ...prev,
        [remoteId]: { stream, username: user?.username || "Peer" },
      }));
    };

    pc.onconnectionstatechange = () => {
      if (["disconnected", "failed", "closed"].includes(pc.connectionState)) {
        setRemoteStreams((prev) => {
          const next = { ...prev };
          delete next[remoteId];
          return next;
        });
        delete pcsRef.current[remoteId];
      }
    };

    return pc;
  }, [socketRef]);

  const sendOffer = useCallback(async (remoteId) => {
    const pc = pcsRef.current[remoteId];
    if (!pc || makingOfferRef.current[remoteId]) return;
    makingOfferRef.current[remoteId] = true;

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (socketRef.current?.connected) {
        socketRef.current.emit("webrtc-offer", { to: remoteId, offer: pc.localDescription });
      }
    } catch (err) {
      console.error("[RTC] sendOffer error", err);
    } finally {
      makingOfferRef.current[remoteId] = false;
    }
  }, [socketRef]);

  const addTrackToAll = useCallback(async (track, stream) => {
    for (const [peerId, pc] of Object.entries(pcsRef.current)) {
      if (!pc.getSenders().some((sender) => sender.track === track)) {
        pc.addTrack(track, stream);
        await sendOffer(peerId);
      }
    }
  }, [sendOffer]);

  const replaceTrackInAll = useCallback(async (kind, newTrack) => {
    for (const pc of Object.values(pcsRef.current)) {
      const sender = pc.getSenders().find((s) => s.track?.kind === kind);
      if (sender && newTrack) {
        await sender.replaceTrack(newTrack);
      } else if (sender && !newTrack) {
        pc.removeTrack(sender);
        await sendOffer(Object.keys(pcsRef.current).find((id) => pcsRef.current[id] === pc));
      } else if (!sender && newTrack) {
        pc.addTrack(newTrack, localStreamRef.current);
        await sendOffer(Object.keys(pcsRef.current).find((id) => pcsRef.current[id] === pc));
      }
    }
  }, [sendOffer]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !joined) return undefined;

    const handlePeerJoined = ({ socketId }) => {
      const pc = createPC(socketId);
      localStreamRef.current?.getTracks().forEach((track) => {
        if (!pc.getSenders().some((sender) => sender.track === track)) {
          pc.addTrack(track, localStreamRef.current);
        }
      });
      sendOffer(socketId);
    };

    const handleOffer = async ({ from, offer }) => {
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
      } catch (err) {
        console.error("[Signal] offer handler", err);
      }
    };

    const handleAnswer = async ({ from, answer }) => {
      const pc = pcsRef.current[from];
      if (!pc) return;
      try {
        if (pc.signalingState === "have-local-offer") {
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
          await drainIce(from);
        }
      } catch (err) {
        console.error("[Signal] answer handler", err);
      }
    };

    const handleIceCandidate = async ({ from, candidate }) => {
      const pc = pcsRef.current[from];
      if (pc?.remoteDescription) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          console.warn("[ICE] addIceCandidate error", err);
        }
      } else {
        if (!iceBufRef.current[from]) iceBufRef.current[from] = [];
        iceBufRef.current[from].push(candidate);
      }
    };

    socket.on("peer-joined", handlePeerJoined);
    socket.on("webrtc-offer", handleOffer);
    socket.on("webrtc-answer", handleAnswer);
    socket.on("webrtc-ice-candidate", handleIceCandidate);

    return () => {
      socket.off("peer-joined", handlePeerJoined);
      socket.off("webrtc-offer", handleOffer);
      socket.off("webrtc-answer", handleAnswer);
      socket.off("webrtc-ice-candidate", handleIceCandidate);
      Object.values(pcsRef.current).forEach((pc) => pc.close());
      pcsRef.current = {};
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    };
  }, [joined, socketRef, createPC, sendOffer, drainIce]);

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
      setMicOn(true);
    } catch (err) {
      console.error("[WebRTC] toggleMic error", err);
    }
  }, [micOn, addTrackToAll, replaceTrackInAll]);

  const attachStreamToVideo = useCallback((videoEl, stream) => {
    if (!videoEl) return;
    if (videoEl.srcObject === stream) return;
    videoEl.srcObject = null;
    videoEl.load();
    videoEl.srcObject = stream;
    videoEl.play().catch((err) => {
      if (err.name !== "AbortError") console.warn("[Video] play()", err);
    });
  }, []);

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
        localVideoRef.current.load();
      }
      setCamOn(false);
      return;
    }

    try {
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
      attachStreamToVideo(localVideoRef.current, localStreamRef.current);
      setCamOn(true);
    } catch (err) {
      console.error("[WebRTC] toggleCam error", err);
    }
  }, [camOn, addTrackToAll, replaceTrackInAll, attachStreamToVideo]);

  const endCall = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    Object.values(pcsRef.current).forEach((pc) => pc.close());
    pcsRef.current = {};
    setMicOn(false);
    setCamOn(false);
    setRemoteStreams({});
    setMutedPeers(new Set());
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
      localVideoRef.current.load();
    }
  }, []);

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
