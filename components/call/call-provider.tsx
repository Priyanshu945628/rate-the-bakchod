"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { limits } from "@/lib/config";
import type { CallKindName, ClientCallPeer, RealtimeEvent } from "@/lib/types";
import { useRealtime } from "../realtime-provider";
import { CallWindow } from "./call-window";
import { IncomingCall } from "./incoming-call";
import { RINGBACK, useCallTone } from "./tones";

/**
 * The one call this tab can be in.
 *
 * WebRTC inside a React tree is mostly an argument about where the mutable things
 * live. The `RTCPeerConnection`, both `MediaStream`s and the queue of early ICE
 * candidates are refs; state holds only what gets drawn — who is on the other end,
 * whether it is voice or video, and which phase it is in. The same object is mirrored
 * into a ref so the event handlers below can read the current call without every
 * callback depending on it.
 *
 * Who offers is settled by the invitation rather than negotiated: the caller creates
 * the offer, and only once `accept` has come back. Neither side calls
 * `setLocalDescription` before that, so a call nobody picks up gathers no ICE
 * candidates and hands over no addresses at all.
 *
 * Candidates that arrive before the description they belong to are queued rather than
 * added — `addIceCandidate` rejects until there is a remote description, and browsers
 * really do deliver an answer's candidates ahead of the answer.
 */

/**
 * The phases a call is drawn in.
 *
 * `calling` and `ringing` are the same state of the world and two different truths
 * about it: the invitation is out either way, but only `ringing` means a browser was
 * there to receive it. Telling them apart is the difference between forty-five
 * seconds of hope and knowing straight away that nobody is home.
 *
 * `reconnecting` exists because `RTCPeerConnection` genuinely recovers from
 * `disconnected` — a phone changing cell, a laptop moving to another access point —
 * and tearing the call down on the first blip would end calls that were about to
 * carry on.
 */
export type CallStatus =
  | "incoming"
  | "calling"
  | "ringing"
  | "connecting"
  | "live"
  | "reconnecting";

export interface ActiveCall {
  callId: string;
  conversationId: string;
  kind: CallKindName;
  status: CallStatus;
  peer: ClientCallPeer;
  /** True when this tab placed the call. Decides who offers, and the wording. */
  outgoing: boolean;
  muted: boolean;
  cameraOff: boolean;
}

interface CallApi {
  call: ActiveCall | null;
  local: MediaStream | null;
  remote: MediaStream | null;
  /** Returns null on success, or the message to show beside the button. */
  start: (conversationId: string, kind: CallKindName) => Promise<string | null>;
  accept: () => void;
  hangUp: () => void;
  toggleMute: () => void;
  toggleCamera: () => void;
  /**
   * Front camera to back and back again. Only ever offered when the device
   * actually has a second one — see `cameras`.
   */
  switchCamera: () => void;
  /** Video inputs this device has. 0 until permission makes the list readable. */
  cameras: number;
}

const CallContext = createContext<CallApi>({
  call: null,
  local: null,
  remote: null,
  start: async () => "Calling is not available here.",
  accept: () => {},
  hangUp: () => {},
  toggleMute: () => {},
  toggleCamera: () => {},
  switchCamera: () => {},
  cameras: 0,
});

export function useCall(): CallApi {
  return useContext(CallContext);
}

/** Last-resort STUN, used only if `/api/calls/ice` cannot be reached. */
const FALLBACK_ICE: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

/** The capture size asked for, as long edge and short edge — 720p either way up. */
const CAPTURE_LONG = 1280;
const CAPTURE_SHORT = 720;

/**
 * What to ask the camera for, in the shape the device is being held.
 *
 * Asking for `1280×720` whatever the device is doing is what makes a call from a phone
 * arrive sideways: the constraint itself is landscape, so the phone hands over a
 * landscape frame however it is held, and the far end — a portrait screen — can only
 * fill itself by cropping a strip out of the middle of somebody's face.
 *
 * Portrait is asked for only where the screen is upright *and* the pointer is coarse, so
 * a webcam over a tall desktop window keeps the landscape frame it actually has. Both
 * numbers stay `ideal`: a camera that can do neither shape should open with what it has
 * rather than fail the whole call with `OverconstrainedError`.
 */
function videoConstraints(facingMode: "user" | "environment"): MediaTrackConstraints {
  const portrait =
    window.matchMedia("(orientation: portrait)").matches &&
    window.matchMedia("(pointer: coarse)").matches;
  return {
    facingMode,
    width: { ideal: portrait ? CAPTURE_SHORT : CAPTURE_LONG },
    height: { ideal: portrait ? CAPTURE_LONG : CAPTURE_SHORT },
  };
}

function post(body: Record<string, unknown>): Promise<Response> {
  return fetch("/api/calls", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

interface SignalPayload {
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

export function CallProvider({ children }: { children: React.ReactNode }) {
  const [call, setCall] = useState<ActiveCall | null>(null);
  const [local, setLocal] = useState<MediaStream | null>(null);
  const [remote, setRemote] = useState<MediaStream | null>(null);
  const [cameras, setCameras] = useState(0);

  const active = useRef<ActiveCall | null>(null);
  const pc = useRef<RTCPeerConnection | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const early = useRef<RTCIceCandidateInit[]>([]);
  const ice = useRef<RTCIceServer[] | null>(null);
  const ringTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Held between pressing call and the server answering, so a double-tap rings once. */
  const claiming = useRef(false);
  /** Which way the camera is pointing, so switching has something to flip from. */
  const facing = useRef<"user" | "environment">("user");

  /** State and its mirror move together, or a handler reads a call that has ended. */
  const apply = useCallback((next: ActiveCall | null) => {
    active.current = next;
    setCall(next);
  }, []);

  const patch = useCallback(
    (changes: Partial<ActiveCall>) => {
      if (active.current) apply({ ...active.current, ...changes });
    },
    [apply],
  );

  const teardown = useCallback(() => {
    if (ringTimer.current) clearTimeout(ringTimer.current);
    ringTimer.current = null;
    pc.current?.close();
    pc.current = null;
    for (const track of stream.current?.getTracks() ?? []) track.stop();
    stream.current = null;
    early.current = [];
    claiming.current = false;
    facing.current = "user";
    setLocal(null);
    setRemote(null);
    apply(null);
  }, [apply]);

  /**
   * The ICE servers, fetched once per tab.
   *
   * From an authenticated route rather than a `NEXT_PUBLIC_` variable: a TURN
   * credential in the client bundle is a relay anyone can bill traffic to.
   */
  const loadIce = useCallback(async (): Promise<RTCIceServer[]> => {
    if (ice.current) return ice.current;
    try {
      const res = await fetch("/api/calls/ice");
      if (res.ok) {
        const data = (await res.json()) as { iceServers?: RTCIceServer[] };
        if (data.iceServers && data.iceServers.length > 0) {
          ice.current = data.iceServers;
          return data.iceServers;
        }
      }
    } catch {
      // Offline or a 500 — a direct connection may still work, so try anyway.
    }
    return FALLBACK_ICE;
  }, []);

  /**
   * Camera and microphone. Taken before anybody's phone rings, so a browser that
   * refuses permission has not already made someone else's device buzz.
   *
   * The device list is counted afterwards rather than before: labels and even the
   * number of entries are withheld until a permission has been granted, so asking
   * first reports one camera on a phone that has three.
   */
  const getMedia = useCallback(async (kind: CallKindName): Promise<MediaStream> => {
    const media = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: kind === "VIDEO" ? videoConstraints(facing.current) : false,
    });
    stream.current = media;
    setLocal(media);

    if (kind === "VIDEO") {
      void navigator.mediaDevices
        .enumerateDevices()
        .then((devices) => setCameras(devices.filter((d) => d.kind === "videoinput").length))
        .catch(() => {});
    }
    return media;
  }, []);

  const buildPeer = useCallback(
    async (callId: string, media: MediaStream): Promise<void> => {
      const conn = new RTCPeerConnection({ iceServers: await loadIce() });
      for (const track of media.getTracks()) conn.addTrack(track, media);

      // Their media, as the connection reports it. `event.streams[0]` is the stream
      // the far end grouped its tracks into — the same object for their microphone and
      // their camera, so in practice this is one state change per call and React bails
      // out of the second.
      //
      // Deliberately not an empty `new MediaStream()` published up front and filled in
      // as tracks arrive. That object reaches state with nothing in it, and a browser
      // handed a trackless stream has no picture to decode: some never repaint when
      // tracks turn up afterwards, which is a black rectangle for the whole call.
      const fallback = new MediaStream();
      conn.addEventListener("track", (event) => {
        const [inbound] = event.streams;
        if (inbound) {
          setRemote(inbound);
          return;
        }
        // No stream reported — legal, and then the tracks are ours to group. A fresh
        // object each time, so the element re-attaches instead of keeping a stale one.
        fallback.addTrack(event.track);
        setRemote(new MediaStream(fallback.getTracks()));
      });

      conn.addEventListener("icecandidate", (event) => {
        if (!event.candidate) return;
        void post({ phase: "signal", callId, signal: { candidate: event.candidate.toJSON() } });
      });

      conn.addEventListener("connectionstatechange", () => {
        // `disconnected` is recoverable and routinely is — a phone stepping between
        // cells reaches it and comes back. Only `failed` is terminal, so only
        // `failed` ends the call.
        if (conn.connectionState === "connected") {
          patch({ status: "live" });
        } else if (conn.connectionState === "disconnected") {
          patch({ status: "reconnecting" });
        } else if (conn.connectionState === "failed") {
          void post({ phase: "end", callId });
          teardown();
        }
      });

      pc.current = conn;
    },
    [loadIce, patch, teardown],
  );

  /** The caller's cue to make an offer: someone is actually there to hear it. */
  const onAccepted = useCallback(async () => {
    const conn = pc.current;
    const current = active.current;
    if (!conn || !current) return;

    if (ringTimer.current) clearTimeout(ringTimer.current);
    ringTimer.current = null;
    patch({ status: "connecting" });

    try {
      await conn.setLocalDescription(await conn.createOffer());
      void post({
        phase: "signal",
        callId: current.callId,
        signal: { description: conn.localDescription?.toJSON() },
      });
    } catch {
      void post({ phase: "end", callId: current.callId });
      teardown();
    }
  }, [patch, teardown]);

  const onSignal = useCallback(async (raw: unknown) => {
    const conn = pc.current;
    const current = active.current;
    if (!conn || !current) return;
    const payload = (raw ?? {}) as SignalPayload;

    try {
      if (payload.description) {
        await conn.setRemoteDescription(payload.description);
        // Whatever came in early can go in now, and only now.
        for (const candidate of early.current.splice(0)) {
          await conn.addIceCandidate(candidate).catch(() => {});
        }
        if (payload.description.type === "offer") {
          await conn.setLocalDescription(await conn.createAnswer());
          void post({
            phase: "signal",
            callId: current.callId,
            signal: { description: conn.localDescription?.toJSON() },
          });
        }
        return;
      }

      if (payload.candidate) {
        if (!conn.remoteDescription) {
          early.current.push(payload.candidate);
          return;
        }
        await conn.addIceCandidate(payload.candidate).catch(() => {});
      }
    } catch {
      void post({ phase: "end", callId: current.callId });
      teardown();
    }
  }, [teardown]);

  useRealtime(
    useCallback(
      (event: RealtimeEvent) => {
        if (event.type !== "call") return;

        if (event.phase === "invite") {
          // Already busy. One `RTCPeerConnection` cannot take a second call, and a
          // second ring behind the first is worse than an honest refusal.
          if (claiming.current || active.current) {
            void post({ phase: "decline", callId: event.callId });
            return;
          }
          claiming.current = true;
          apply({
            callId: event.callId,
            conversationId: event.conversationId,
            kind: event.kind,
            status: "incoming",
            peer: event.from,
            outgoing: false,
            muted: false,
            cameraOff: false,
          });
          return;
        }

        // Anything else about a call this tab is not in is not this tab's business.
        if (event.callId !== active.current?.callId) return;

        if (event.phase === "accept") void onAccepted();
        else if (event.phase === "signal") void onSignal(event.signal);
        else teardown();
      },
      [apply, onAccepted, onSignal, teardown],
    ),
  );

  const start = useCallback(
    async (conversationId: string, kind: CallKindName): Promise<string | null> => {
      if (claiming.current || active.current) return "You are already on a call.";
      claiming.current = true;

      let media: MediaStream;
      try {
        media = await getMedia(kind);
      } catch {
        claiming.current = false;
        return kind === "VIDEO"
          ? "Camera and microphone access is needed."
          : "Microphone access is needed.";
      }

      try {
        const res = await post({ phase: "invite", conversationId, kind });
        const data = (await res.json().catch(() => ({}))) as {
          callId?: string;
          peer?: ClientCallPeer;
          error?: string;
        };
        if (!res.ok || !data.callId || !data.peer) {
          teardown();
          return data.error ?? "Could not place the call.";
        }

        apply({
          callId: data.callId,
          conversationId,
          kind,
          // `online` is what the server saw when it published the invitation. False
          // means nothing rang, and saying "Ringing…" over that would be a lie the
          // caller only catches when the timeout expires.
          status: data.peer.online === false ? "calling" : "ringing",
          peer: data.peer,
          outgoing: true,
          muted: false,
          cameraOff: false,
        });
        claiming.current = false;
        await buildPeer(data.callId, media);

        // The caller is what normally gives up, on the same number the server sweeps
        // by — so whichever notices first writes the same missed row.
        const callId = data.callId;
        ringTimer.current = setTimeout(() => {
          void post({ phase: "end", callId });
          teardown();
        }, limits.ringTimeoutMs);

        return null;
      } catch {
        teardown();
        return "Could not place the call.";
      }
    },
    [apply, buildPeer, getMedia, teardown],
  );

  /**
   * Pick up. The peer connection is built before the server is told, so the caller's
   * offer never arrives ahead of something able to answer it.
   */
  const accept = useCallback(() => {
    const current = active.current;
    if (!current || current.status !== "incoming") return;
    patch({ status: "connecting" });

    void (async () => {
      try {
        await buildPeer(current.callId, await getMedia(current.kind));
      } catch {
        void post({ phase: "decline", callId: current.callId });
        teardown();
        return;
      }
      const res = await post({ phase: "accept", callId: current.callId });
      if (!res.ok) teardown();
    })();
  }, [buildPeer, getMedia, patch, teardown]);

  const hangUp = useCallback(() => {
    const current = active.current;
    if (!current) return;
    void post({ phase: current.status === "incoming" ? "decline" : "end", callId: current.callId });
    teardown();
  }, [teardown]);

  /**
   * Mute and camera work on the track, not on the connection. Disabling a track sends
   * silence or black rather than dropping the stream, which is what stops the other
   * side's layout jumping every time somebody mutes.
   */
  const toggleMute = useCallback(() => {
    if (!active.current) return;
    const muted = !active.current.muted;
    for (const track of stream.current?.getAudioTracks() ?? []) track.enabled = !muted;
    patch({ muted });
  }, [patch]);

  const toggleCamera = useCallback(() => {
    if (!active.current) return;
    const cameraOff = !active.current.cameraOff;
    for (const track of stream.current?.getVideoTracks() ?? []) track.enabled = !cameraOff;
    patch({ cameraOff });
  }, [patch]);

  /**
   * Point the camera the other way.
   *
   * `replaceTrack` rather than a renegotiation: the sender keeps its place in the
   * SDP, so the far end sees the picture change with no offer/answer round trip and
   * no visible reconnect.
   *
   * The new track is swapped *into the existing `MediaStream`* rather than replacing
   * the object. The local `<video>` already has that object as its `srcObject` and
   * follows a track change live — handing it a new stream would restart playback and
   * flash black.
   */
  const switchCamera = useCallback(() => {
    const conn = pc.current;
    const media = stream.current;
    if (!conn || !media || active.current?.kind !== "VIDEO") return;
    const next = facing.current === "user" ? "environment" : "user";

    void (async () => {
      let fresh: MediaStream;
      try {
        fresh = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints(next),
        });
      } catch {
        // One camera after all, or permission withdrawn mid-call. Keep the picture
        // that is already working.
        return;
      }

      const track = fresh.getVideoTracks()[0];
      if (!track) {
        for (const t of fresh.getTracks()) t.stop();
        return;
      }

      const sender = conn.getSenders().find((s) => s.track?.kind === "video");
      await sender?.replaceTrack(track).catch(() => {});

      for (const old of media.getVideoTracks()) {
        media.removeTrack(old);
        old.stop();
      }
      media.addTrack(track);
      track.enabled = !active.current?.cameraOff;
      facing.current = next;
    })();
  }, []);

  useEffect(() => {
    const bye = () => {
      const current = active.current;
      if (!current) return;
      // `keepalive`, because the page is going away mid-request. A tab that closes
      // without saying so leaves a live row that locks both people out of calling
      // each other until the sweep catches up.
      void fetch("/api/calls", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phase: "end", callId: current.callId }),
        keepalive: true,
      });
    };
    window.addEventListener("pagehide", bye);
    return () => {
      window.removeEventListener("pagehide", bye);
      teardown();
    };
  }, [teardown]);

  const api = useMemo<CallApi>(
    () => ({
      call,
      local,
      remote,
      start,
      accept,
      hangUp,
      toggleMute,
      toggleCamera,
      switchCamera,
      cameras,
    }),
    [
      call,
      local,
      remote,
      start,
      accept,
      hangUp,
      toggleMute,
      toggleCamera,
      switchCamera,
      cameras,
    ],
  );

  /**
   * Ringback, for the caller only.
   *
   * Here rather than in `CallWindow` because the sound belongs to the call and not to
   * a panel: keyed off status, it cannot be left playing by a render that returned
   * early. The callee's ring is the other half of this and lives in `IncomingCall`.
   *
   * It stops the moment `accept` arrives, because `onAccepted` moves the call to
   * `connecting` — there is no separate stop to forget.
   */
  useCallTone(
    call?.outgoing && (call.status === "calling" || call.status === "ringing")
      ? RINGBACK
      : null,
  );

  return (
    <CallContext.Provider value={api}>
      {children}
      {call?.status === "incoming" ? <IncomingCall /> : null}
      {call && call.status !== "incoming" ? <CallWindow /> : null}
    </CallContext.Provider>
  );
}
