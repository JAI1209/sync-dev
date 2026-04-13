import { useEffect, useRef, useState, useCallback } from "react";

const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

export function useWebRTC({ socketRef, roomId, joined }) {
  const localStreamRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRefs = useRef({});
  const pcsRef = useRef({});

  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [remoteStreams, setRemoteStreams] = useState({});
  const [mediaError, setMediaError] = useState(null);
  const [mutedPeers, setMutedPeers] = useState(new Set());

  // WebRTC signaling via socket
  useEffect(() => {
    const socket = socketRef?.current;
    if (!socket) return;

    const handleOffer = async ({ from, offer }) => {
      const pc = createPeerConnection(from);
      await pc.setRemoteDescription(offer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("webrtc-answer", { to: from, answer });
    };

    const handleAnswer = async ({ from, answer }) => {
      const pc = pcsRef.current[from];
      if (pc) await pc.setRemoteDescription(answer);
    };

    const handleIce = async ({ from, candidate }) => {
      const pc = pcsRef.current[from];
      if (pc) await pc.addIceCandidate(candidate);
    };

    socket.on("webrtc-offer", handleOffer);
    socket.on("webrtc-answer", handleAnswer);
    socket.on("webrtc-ice-candidate", handleIce);

    return () => {
      socket.off("webrtc-offer", handleOffer);
      socket.off("webrtc-answer", handleAnswer);
      socket.off("webrtc-ice-candidate", handleIce);
    };
  }, [joined]);

  const createPeerConnection = (peerId) => {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    pcsRef.current[peerId] = pc;

    pc.onicecandidate = (e) => {
      if (e.candidate && socketRef.current) {
        socketRef.current.emit("webrtc-ice-candidate", {
          to: peerId,
          candidate: e.candidate,
        });
      }
    };

    pc.ontrack = (e) => {
      const stream = e.streams[0];
      setRemoteStreams((prev) => ({ ...prev, [peerId]: stream }));

      const videoEl = remoteVideoRefs.current[peerId];
      if (videoEl) {
        videoEl.srcObject = stream;
        videoEl.autoplay = true;
        videoEl.playsInline = true;
      }
    };

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current);
      });
    }

    return pc;
  };

  const attachStreamToVideo = useCallback((videoEl, stream) => {
    if (!videoEl) return;
    videoEl.srcObject = null;
    if (stream && stream.getTracks().length > 0) {
      videoEl.srcObject = stream;
      videoEl.muted = true;
      const playPromise = videoEl.play();
      if (playPromise) playPromise.catch(() => {});
    }
  }, []);

  const replaceTrackInAll = async (kind, newTrack) => {
    await Promise.all(
      Object.values(pcsRef.current).map(async (pc) => {
        const sender = pc.getSenders().find((s) => s.track?.kind === kind);
        if (sender) {
          await sender.replaceTrack(newTrack);
        } else if (newTrack && localStreamRef.current) {
          pc.addTrack(newTrack, localStreamRef.current);
        }
      })
    );
  };

  const addTrackToAll = async (track, stream) => {
    Object.values(pcsRef.current).forEach((pc) => {
      const existing = pc.getSenders().find((s) => s.track?.id === track.id);
      if (!existing) pc.addTrack(track, stream);
    });
  };

  const toggleMic = async () => {
    setMediaError(null);
    if (micOn) {
      const track = localStreamRef.current?.getAudioTracks()[0];
      if (track) {
        track.stop();
        localStreamRef.current.removeTrack(track);
        await replaceTrackInAll("audio", null);
      }
      setMicOn(false);
    } else {
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
        setMediaError(
          err.name === "NotAllowedError"
            ? "Microphone blocked — allow it in your browser settings."
            : `Microphone error: ${err.message}`
        );
      }
    }
  };

  const toggleCam = async () => {
    setMediaError(null);
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
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
        const track = stream.getVideoTracks()[0];

        if (!localStreamRef.current) localStreamRef.current = new MediaStream();
        const existing = localStreamRef.current.getVideoTracks()[0];
        if (existing) {
          existing.stop();
          localStreamRef.current.removeTrack(existing);
        }
        localStreamRef.current.addTrack(track);
        await replaceTrackInAll("video", track);

        const freshStream = new MediaStream([track]);
        attachStreamToVideo(localVideoRef.current, freshStream);

        setCamOn(true);
      } catch (err) {
        setMediaError(
          err.name === "NotAllowedError"
            ? "Camera blocked — allow it in your browser settings."
            : `Camera error: ${err.message}`
        );
      }
    }
  };

  const endCall = () => {
    Object.values(pcsRef.current).forEach((pc) => pc.close());
    pcsRef.current = {};
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    setMicOn(false);
    setCamOn(false);
    setRemoteStreams({});
  };

  return {
    micOn,
    camOn,
    remoteStreams,
    localVideoRef,
    remoteVideoRefs,
    toggleMic,
    toggleCam,
    endCall,
    mediaError,
    mutedPeers,
    setMutedPeers,
  };
}
