import { useCallback, useEffect, useRef, useState } from "react";
import type { WSEventType } from "../types";

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
];

export type VoiceCallStatus = "idle" | "calling" | "incoming" | "connected";

interface UseVoiceCallOptions {
  myEmail: string;
  wsSend: (type: string, payload: unknown) => void;
  wsOn: (type: WSEventType, fn: (payload: unknown) => void) => () => void;
}

export interface VoiceCallState {
  status: VoiceCallStatus;
  peerEmail: string | null;
  peerName: string | null;
  onlineUsers: string[];
  callDuration: number;
  isMuted: boolean;
}

export interface VoiceCallActions {
  startCall: (targetEmail: string) => void;
  acceptCall: () => void;
  rejectCall: () => void;
  endCall: () => void;
  toggleMute: () => void;
  refreshOnlineUsers: () => void;
}

export function useVoiceCall({ myEmail, wsSend, wsOn }: UseVoiceCallOptions): VoiceCallState & VoiceCallActions {
  const [status, setStatus] = useState<VoiceCallStatus>("idle");
  const [peerEmail, setPeerEmail] = useState<string | null>(null);
  const [peerName, setPeerName] = useState<string | null>(null);
  const [onlineUsers, setOnlineUsers] = useState<string[]>([]);
  const [callDuration, setCallDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const statusRef = useRef(status);
  statusRef.current = status;

  // Create and cache audio element for remote stream
  const getRemoteAudio = useCallback(() => {
    if (!remoteAudioRef.current) {
      remoteAudioRef.current = new Audio();
      remoteAudioRef.current.autoplay = true;
    }
    return remoteAudioRef.current;
  }, []);

  const cleanup = useCallback(() => {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }
    setStatus("idle");
    setPeerEmail(null);
    setPeerName(null);
    setCallDuration(0);
    setIsMuted(false);
  }, []);

  const createPeerConnection = useCallback(
    (targetEmail: string) => {
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      pcRef.current = pc;

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          wsSend("voice_ice_candidate", { targetEmail, candidate: e.candidate.toJSON() });
        }
      };

      pc.ontrack = (e) => {
        const audio = getRemoteAudio();
        audio.srcObject = e.streams[0] || new MediaStream([e.track]);
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
          cleanup();
        }
      };

      return pc;
    },
    [wsSend, getRemoteAudio, cleanup],
  );

  const acquireAudio = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    localStreamRef.current = stream;
    return stream;
  }, []);

  const startCall = useCallback(
    async (targetEmail: string) => {
      if (statusRef.current !== "idle") return;
      setStatus("calling");
      setPeerEmail(targetEmail);
      wsSend("voice_call_request", { targetEmail });
    },
    [wsSend],
  );

  const acceptCall = useCallback(async () => {
    if (statusRef.current !== "incoming" || !peerEmail) return;
    wsSend("voice_call_accept", { targetEmail: peerEmail });
    // The caller will send the offer after receiving acceptance
  }, [wsSend, peerEmail]);

  const rejectCall = useCallback(() => {
    if (statusRef.current !== "incoming" || !peerEmail) return;
    wsSend("voice_call_reject", { targetEmail: peerEmail });
    cleanup();
  }, [wsSend, peerEmail, cleanup]);

  const endCall = useCallback(() => {
    if (peerEmail) {
      wsSend("voice_call_end", { targetEmail: peerEmail });
    }
    cleanup();
  }, [wsSend, peerEmail, cleanup]);

  const toggleMute = useCallback(() => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  }, []);

  const refreshOnlineUsers = useCallback(() => {
    wsSend("voice_get_online_users", {});
  }, [wsSend]);

  // Start duration timer when connected
  useEffect(() => {
    if (status === "connected") {
      setCallDuration(0);
      durationTimerRef.current = setInterval(() => {
        setCallDuration((d) => d + 1);
      }, 1000);
    } else if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }
  }, [status]);

  // WS event listeners
  useEffect(() => {
    const unsubs: Array<() => void> = [];

    // Incoming call
    unsubs.push(
      wsOn("voice_call_incoming" as WSEventType, (payload: unknown) => {
        const p = payload as { fromEmail: string; fromName: string };
        if (statusRef.current !== "idle") {
          // Already in a call, auto-reject
          wsSend("voice_call_reject", { targetEmail: p.fromEmail });
          return;
        }
        setStatus("incoming");
        setPeerEmail(p.fromEmail);
        setPeerName(p.fromName);
      }),
    );

    // Call accepted — caller creates offer
    unsubs.push(
      wsOn("voice_call_accepted" as WSEventType, async (payload: unknown) => {
        const p = payload as { fromEmail: string; fromName: string };
        if (statusRef.current !== "calling") return;
        setPeerName(p.fromName);
        try {
          const stream = await acquireAudio();
          const pc = createPeerConnection(p.fromEmail);
          stream.getTracks().forEach((t) => pc.addTrack(t, stream));
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          wsSend("voice_offer", { targetEmail: p.fromEmail, sdp: offer });
        } catch (err) {
          console.error("[VoiceCall] Failed to create offer:", err);
          cleanup();
        }
      }),
    );

    // Received offer — callee creates answer
    unsubs.push(
      wsOn("voice_offer" as WSEventType, async (payload: unknown) => {
        const p = payload as { fromEmail: string; sdp: RTCSessionDescriptionInit };
        try {
          const stream = await acquireAudio();
          const pc = createPeerConnection(p.fromEmail);
          stream.getTracks().forEach((t) => pc.addTrack(t, stream));
          await pc.setRemoteDescription(new RTCSessionDescription(p.sdp));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          wsSend("voice_answer", { targetEmail: p.fromEmail, sdp: answer });
          setStatus("connected");
          // Start duration timer is handled by the effect
        } catch (err) {
          console.error("[VoiceCall] Failed to handle offer:", err);
          cleanup();
        }
      }),
    );

    // Received answer
    unsubs.push(
      wsOn("voice_answer" as WSEventType, async (payload: unknown) => {
        const p = payload as { fromEmail: string; sdp: RTCSessionDescriptionInit };
        const pc = pcRef.current;
        if (!pc) return;
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(p.sdp));
          setStatus("connected");
        } catch (err) {
          console.error("[VoiceCall] Failed to handle answer:", err);
          cleanup();
        }
      }),
    );

    // ICE candidate
    unsubs.push(
      wsOn("voice_ice_candidate" as WSEventType, async (payload: unknown) => {
        const p = payload as { fromEmail: string; candidate: RTCIceCandidateInit };
        const pc = pcRef.current;
        if (!pc) return;
        try {
          await pc.addIceCandidate(new RTCIceCandidate(p.candidate));
        } catch (err) {
          console.error("[VoiceCall] Failed to add ICE candidate:", err);
        }
      }),
    );

    // Call rejected
    unsubs.push(
      wsOn("voice_call_rejected" as WSEventType, () => {
        if (statusRef.current === "calling") {
          cleanup();
        }
      }),
    );

    // Call ended by peer
    unsubs.push(
      wsOn("voice_call_ended" as WSEventType, () => {
        cleanup();
      }),
    );

    // Peer unavailable (offline)
    unsubs.push(
      wsOn("voice_call_unavailable" as WSEventType, () => {
        if (statusRef.current === "calling") {
          cleanup();
        }
      }),
    );

    // Online users list
    unsubs.push(
      wsOn("voice_online_users" as WSEventType, (payload: unknown) => {
        const p = payload as { users: string[] };
        setOnlineUsers(p.users);
      }),
    );

    return () => unsubs.forEach((fn) => fn());
  }, [wsOn, wsSend, acquireAudio, createPeerConnection, cleanup]);

  // Cleanup on unmount
  useEffect(() => {
    return () => cleanup();
  }, [cleanup]);

  return {
    status,
    peerEmail,
    peerName,
    onlineUsers,
    callDuration,
    isMuted,
    startCall,
    acceptCall,
    rejectCall,
    endCall,
    toggleMute,
    refreshOnlineUsers,
  };
}
