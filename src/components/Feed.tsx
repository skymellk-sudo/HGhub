import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "../runtime";
import { api, cover, fmt, fmtTime, isMobile } from "../api";
import type { Detail, Episode, Post, VideoCard } from "../types";
import { useStore } from "../store";
import { Avatar, Img, Sheet } from "./ui";
import VideoSurface, { type VideoHandle } from "./VideoSurface";
import PlayerControls from "./PlayerControls";
import PlaybackLock from "./PlaybackLock";
import { ArticlePanel, CommentsPanel, EpisodesPanel } from "./Panels";
import { setBackHandler } from "../back";
import {
  IBack, IBoltF, IChevR, IChevronDown, IChevronUp, IClose, ICommentF, ICompress, IExpand, IFileText, IHeart, IHeartF,
  ILink, IList, ILockF, IPauseF, IPlayF, ISearch, IStar, IStarF, IVol, IVolMute,
} from "../icons";

type Props = {
  videoIds: number[];
  startIndex?: number;
  title?: string;
  mode: "home" | "context";
  kind?: "video" | "post";
  active: boolean;
  bottomInset: number;
  onBack?: () => void;
  onNearEnd?: () => void;
  /** �ӹۿ���¼��������ʼ���������� */
  startEp?: number;
  startTime?: number;
};

export default function Feed({ videoIds, startIndex = 0, title = "", mode, kind = "video", active, bottomInset, onBack, onNearEnd, startEp, startTime }: Props) {
  const store = useStore();
  const { isLiked, isFav, toggleLikeLocal, toggleFavLocal, toggleFollowLocal, muted, setMuted, volume, setVolume, toast, addHistory, user, setLoginOpen } = store;
  const isDesktop = !isMobile;

  const boxRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<VideoHandle>(null);
  const [index, setIndex] = useState(startIndex);
  const [epMap, setEpMap] = useState<Record<number, number>>(() => (startEp ? { [videoIds[startIndex]]: startEp } : {}));
  const [details, setDetails] = useState<Record<number, Detail>>({});
  const [playUrls, setPlayUrls] = useState<Record<string, string>>({});
  const [cards] = useState<Record<number, VideoCard>>({});
  const [posts, setPosts] = useState<Record<number, Post>>({});

  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [vsize, setVsize] = useState({ w: 0, h: 0 });
  const [buffered, setBuffered] = useState(0);
  const [paused, setPaused] = useState(false);
  const [controlsLocked, setControlsLocked] = useState(false);
  const [rate, setRate] = useState(1);
  const [waiting, setWaiting] = useState(false);
  const [err, setErr] = useState("");
  /* ȡ���ŵ�ַʧ�ܺ��ֶ����ԣ����������´�����ȡ */
  const [playTry, setPlayTry] = useState(0);
  const [panel, setPanel] = useState<"episodes" | "comments" | "article" | "detail" | null>(null);
  const [descOpen, setDescOpen] = useState(false);
  /* �������õ�ʱ������ seek һ�Σ�ֻ�Խ���ʱ��һ����Ч�� */
  const resumeRef = useRef<{ key: string; t: number } | null>(
    startTime && startTime > 1 ? { key: `${videoIds[startIndex]}:${startEp || 1}`, t: startTime } : null,
  );
  /* �ۿ����ȣ�onTime �����д�� store��ж��ʱ�ٶ�һ�� */
  const liveRef = useRef({ id: 0, ep: 1, dur: 0, t: 0 });
  const lastSaveRef = useRef(0);
  const theater = store.theater;
  const setTheater = store.setTheater;
  const fs = store.fs;
  const setFs = store.setFs;
  const clean = store.clean;
  const setClean = store.setClean;

  /* ׷���ֻ��ӿ��Ƿ��Ѵ�������/ϵͳ����״̬��window.innerWidth > window.innerHeight�� */
  const [vpLandscape, setVpLandscape] = useState(
    () => typeof window !== "undefined" && window.innerWidth > window.innerHeight,
  );

  /* �������� vs ˫����ͣ��ʱ�� */
  const lastTapRef = useRef<{ time: number; timer: number | null }>({ time: 0, timer: null });
  const clearTapTimer = () => {
    if (lastTapRef.current.timer) {
      window.clearTimeout(lastTapRef.current.timer);
      lastTapRef.current.timer = null;
    }
  };

  /* ���棺������� 2.8s �Զ����ز����� UI�������� */
  const [idle, setIdle] = useState(false);
  const idleTimer = useRef<number | undefined>(undefined);
  const wake = useCallback(() => {
    setIdle(false);
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setIdle(true), 2800);
  }, []);
  useEffect(() => {
    if (!isDesktop) return undefined;
    wake();
    return () => window.clearTimeout(idleTimer.current);
  }, [isDesktop, wake]);
  useEffect(() => {
    if (paused) { setIdle(false); window.clearTimeout(idleTimer.current); }
  }, [paused]);
  const [fullscreen, setFullscreen] = useState(false);
  const [heartBurst, setHeartBurst] = useState(0);
  /* ���� �ƶ������� & ������Ƭ���� ���� */
  const [holdSpeed, setHoldSpeed] = useState(false);
  const [speedLock, setSpeedLock] = useState(false);
  const [lockArmed, setLockArmed] = useState(false);
  const holdRef = useRef(false);
  const lockArmedRef = useRef(false);
  const [scrub, setScrub] = useState<{ pct: number; target: number } | null>(null);
  const scrubTarget = useRef<number | null>(null);
  /* �����º�����Ƶ��Ӧģʽ + ˫ָ�޼�����/ƽ�� */
  const [portraitFit, setPortraitFit] = useState<"contain" | "cover">("contain");
  const [zoom, setZoom] = useState({ scale: 1, x: 0, y: 0, gesturing: false });
  const pinchRef = useRef<{
    dist0: number; midX0: number; midY0: number; scale0: number; x0: number; y0: number;
  } | null>(null);
  /* �������϶� */
  const barScrub = useRef(false);
  const [barPct, setBarPct] = useState<number | null>(null);
  const gesture = useRef<{
    x: number; y: number; startX: number; startY: number; t: number; timer: number | null;
    mode: "idle" | "hold" | "scrub" | "pan"; base: number; width: number; playing: boolean;
  } | null>(null);

  const curId = videoIds[index];
  const detail = details[curId];
  const curEp = epMap[curId] || 1;
  const playKey = `${curId}:${curEp}`;
  const playUrl = playUrls[playKey] || "";
  useEffect(() => { videoRef.current?.trace("page.active", { active, view: mode, video_id: curId, episode: curEp }); }, [active, mode, curId, curEp]);
  const episodes = detail?.episodes || [];
  const post = posts[curId];

  /* �ۿ����ȣ�onTime ��ÿ 5 ����һ�Σ��϶��������ڼ���Եײ� timeupdate ��ֹ���������� */
  const onTimeTick = (t: number) => {
    liveRef.current = { id: curId, ep: curEp, dur: duration, t };
    if (!barScrub.current && gesture.current?.mode !== "scrub") {
      setTime(t);
    }
    const now = Date.now();
    if (duration > 0 && now - lastSaveRef.current > 5000) {
      lastSaveRef.current = now;
      addHistory(curId, curEp, t, duration);
    }
  };

  /* �õ�ʱ������������ֻ�Խ���ʱ��һ����Ч���Ҳ�����Ƭβ */
  const onDurationTick = (d: number) => {
    setDuration(d);
    liveRef.current = { ...liveRef.current, dur: d };
    const r = resumeRef.current;
    if (r && r.key === playKey && r.t > 1 && (!d || r.t < d - 3)) {
      resumeRef.current = null;
      videoRef.current?.seek(r.t, "history_resume");
      setTime(r.t);
    }
  };

  /** ͳһ��ͼģ�ͣ��̾���Թ����ӹ���ͬһ�ײ��Ž��� */
  const meta = kind === "post"
    ? {
        title: post?.title || "",
        cover: post?.cover || "",
        desc: post?.content || post?.desc || "",
        author: "�ƹ��Թ�",
        authorId: -1,
        tags: post?.tags || [],
        score: 0,
        like: 0,
        comment: 0,
        collect: 0,
        episodes: [] as Episode[],
      }
    : {
        title: detail?.title || cards[curId]?.title || "",
        cover: detail?.cover || cards[curId]?.cover || "",
        desc: detail?.description || "",
        author: detail?.author?.name || "�ƹ��̾�",
        authorId: detail?.author?.id || -1,
        tags: detail?.tags || [],
        score: detail?.score || 0,
        like: detail?.counts?.like ?? cards[curId]?.like_count ?? 0,
        comment: detail?.counts?.comment ?? cards[curId]?.comment_count ?? 0,
        collect: detail?.counts?.collect ?? cards[curId]?.collect_count ?? 0,
        episodes: detail?.episodes || [],
      };

  const posterUrl = cover(meta.cover, 900);
  const hasVideo = kind === "video" || !!post?.video_url;
  const articleHtml = kind === "post" && !hasVideo ? (post?.content || "") : "";

  /* ���������Ʋ������� */
  const shareLink = () => {
    const u = kind === "post" ? (posts[curId]?.video_url || meta.title) : `https://huangguoai.com/video/${curId}/`;
    navigator.clipboard?.writeText(u).then(() => toast("�����Ѹ���", "ok")).catch(() => {});
  };

  /* ���٣����� / ���� �� 2.0x�������û�׼���� */
  const effRate = holdSpeed || speedLock ? 2 : rate;
  /* ��������ʾ�ٷֱȣ��϶�ʱ���϶�ֵ�� */
  const barProgress = barPct ?? (duration ? time / duration : 0);
  /* �Ƿ�Ϊ������Ƶ��16:9 �ȿ����ڸߣ� */
  const isLandscapeVideo = vsize.w > vsize.h && vsize.h > 0;
  /* ������ȫ�� + ������Ƶ + �ֻ�ϵͳ�ӿ���δ����� (!vpLandscape)��ʱ���� CSS ��ת 90�� ���ף�
     һ��ϵͳ��Ļ�Ѿ�������� (vpLandscape === true)�����ٵ��� CSS ��ת�����׽���ֻ����ú���Ƶ��������ȥ�����⣡ */
  const rotated = !isDesktop && fs && isLandscapeVideo && !vpLandscape;

  /* ��� stclock1988/hghub-ios (PlayerView.swift keepPlayingThroughTransition)��
     iOS �ں�����������ת��ȫ����ͼ�㼶�л��ڼ䣬ϵͳ�ײ� AVPlayer / WebKit ��Ƶ����ܱ����ݹ�����ͣ��
     �ڹ��ɴ������ڷ������� play()��ȷ����ת/ȫ���л����жϲ��š� */
  const keepPlayingTimers = useRef<number[]>([]);
  const keepPlayingThroughTransition = useCallback(() => {
    keepPlayingTimers.current.forEach((id) => window.clearTimeout(id));
    keepPlayingTimers.current = [];
    const el = videoRef.current?.el();
    const shouldPlay = el ? !el.paused : !paused;
    if (!shouldPlay) return;
    for (const delay of [50, 150, 300, 500, 800, 1200]) {
      const tid = window.setTimeout(() => {
        const v = videoRef.current?.el();
        if (v && v.paused && !v.ended) {
          videoRef.current?.play();
        }
      }, delay);
      keepPlayingTimers.current.push(tid);
    }
  }, [paused]);

  useEffect(() => () => {
    keepPlayingTimers.current.forEach((id) => window.clearTimeout(id));
  }, []);

  /* �����ֻ���Ļ�������仯�����������ֻ�ʱ�Զ�����ȫ��������ʱ�Զ��˳�ȫ�� */
  useEffect(() => {
    if (isDesktop) return undefined;
    const onViewportChange = () => {
      const isLand = window.innerWidth > window.innerHeight;
      setVpLandscape((prev) => {
        if (prev !== isLand && active) {
          setFs(isLand);
          keepPlayingThroughTransition();
        }
        return isLand;
      });
    };
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("orientationchange", onViewportChange);
    return () => {
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("orientationchange", onViewportChange);
    };
  }, [isDesktop, active, setFs, keepPlayingThroughTransition]);

  /* ���� / �˳�ȫ�����Ժ�����Ƶֱ�ӵ���ԭ����Ļ�����л������ֻ�ϵͳ������������� */
  const enterFs = useCallback(() => {
    keepPlayingThroughTransition();
    setClean(false);
    setFs(true);
    if (isLandscapeVideo) {
      invoke("set_orientation", { landscape: true }).catch(() => {});
      try {
        (screen.orientation as unknown as { lock?: (o: string) => Promise<void> })?.lock?.("landscape")?.catch(() => {});
      } catch { /* ignore */ }
    }
  }, [isLandscapeVideo, setClean, setFs, keepPlayingThroughTransition]);

  const exitFs = useCallback(() => {
    keepPlayingThroughTransition();
    setClean(false);
    setFs(false);
    invoke("set_orientation", { landscape: false }).catch(() => {});
    try { screen.orientation?.unlock?.(); } catch { /* ignore */ }
  }, [setClean, setFs, keepPlayingThroughTransition]);

  /* ȫ��״̬������Ƶ���߸ռ��س�����Ϊ�������Զ�����һ�κ���ָ�� */
  useEffect(() => {
    if (!isDesktop && fs && isLandscapeVideo) {
      invoke("set_orientation", { landscape: true }).catch(() => {});
    }
  }, [isDesktop, fs, isLandscapeVideo]);

  /* ȫ���л����ӿ���ת��У׼�������� scrollTop��
     - ����ȫ��ʱ�ǵ�ǰ�������أ���ǰ��λ�ڶ��� scrollTop = 0��
     - �˳�ȫ���ص������б�ʱ�������� scrollTop ���¶��뵽 index * clientHeight����ֹ��λ��������Ƶ���档 */
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    if (fs) {
      el.scrollTop = 0;
      return undefined;
    }
    const syncScroll = () => {
      const box = boxRef.current;
      if (!box || fs) return;
      box.scrollTop = index * (box.clientHeight || 1);
    };
    syncScroll();
    const raf = requestAnimationFrame(syncScroll);
    const t1 = window.setTimeout(syncScroll, 120);
    const t2 = window.setTimeout(syncScroll, 350);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [fs, vpLandscape, index]);

  /* ������λ��ȫ�������������ڼ��������������������ߴ�仯�󴥷���ҳ�� */
  const onScroll = useCallback(() => {
    if (fs || pinchRef.current) return;
    const el = boxRef.current;
    if (!el) return;
    const h = el.clientHeight || 1;
    const i = Math.max(0, Math.min(videoIds.length - 1, Math.round(el.scrollTop / h)));
    setIndex((prev) => (prev === i ? prev : i));
    if (onNearEnd && i >= videoIds.length - 3) onNearEnd();
  }, [videoIds.length, onNearEnd, fs]);

  const go = useCallback((delta: number) => {
    const el = boxRef.current;
    if (!el) return;
    const next = Math.max(0, Math.min(videoIds.length - 1, index + delta));
    el.scrollTo({ top: next * el.clientHeight, behavior: "smooth" });
  }, [index, videoIds.length]);

  /* ��ʼ��λ */
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const raf = requestAnimationFrame(() => {
      el.scrollTop = startIndex * (el.clientHeight || 1);
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* �����飨��ǰ + �ڽ�Ԥȡ�� */
  useEffect(() => {
    let alive = true;
    const need = [videoIds[index], videoIds[index + 1], videoIds[index - 1]].filter(Boolean);
    need.forEach((id) => {
      if (details[id]) return;
      api.video(id).then((d) => { if (alive) setDetails((m) => ({ ...m, [id]: d })); }).catch(() => {});
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, videoIds]);

  /* �Թ����ӣ�ֱ�����������飨�� video_url�� */
  useEffect(() => {
    if (kind !== "post") return;
    let alive = true;
    [videoIds[index], videoIds[index + 1], videoIds[index - 1]].filter(Boolean).forEach((id) => {
      if (posts[id]) return;
      api.post(id).then((p) => { if (alive) setPosts((m) => ({ ...m, [id]: p })); }).catch(() => {});
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, index, videoIds]);

  /* �����ŵ�ַ */
  useEffect(() => {
    if (!curId) return;
    if (playUrls[playKey]) return;
    let alive = true;
    api.play(curId, curEp)
      .then((info) => {
        if (!alive) return;
        if (!info?.video_url) throw new Error("���޲��ŵ�ַ");
        setPlayUrls((m) => ({ ...m, [playKey]: info.video_url }));
        addHistory(curId, curEp);
      })
      .catch((e) => { if (alive) setErr((e as Error).message || "ȡ���ŵ�ַʧ��"); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curId, curEp, playTry]);

  /* �л���Ŀ/����ʱ���ò���������״̬ */
  useEffect(() => {
    setTime(0); setDuration(0); setBuffered(0); setErr(""); setWaiting(true); setPaused(false); setDescOpen(false);
    setVsize({ w: 0, h: 0 });
    setPortraitFit("contain");
    setZoom({ scale: 1, x: 0, y: 0, gesturing: false });
  }, [playKey]);

  /* ����ȫ��ʱ��λ˫ָ���Ų�У׼������λ�� */
  useEffect(() => {
    setZoom({ scale: 1, x: 0, y: 0, gesturing: false });
    if (!fs && boxRef.current) {
      const el = boxRef.current;
      requestAnimationFrame(() => {
        el.scrollTop = index * (el.clientHeight || 1);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fs]);

  /* ����/����ͬ�� */
  useEffect(() => { videoRef.current?.mute(muted); }, [muted]);
  useEffect(() => { videoRef.current?.volume(volume); }, [volume]);
  /* ����ͬ�������� 2x / ���� 2x / ��׼���٣� */
  useEffect(() => { videoRef.current?.rate(effRate); }, [effRate, playKey]);

  /* �뿪����ҳʱ�����λ�����̲�������ʱ�� */
  useEffect(() => () => {
    clearTapTimer();
    const s = liveRef.current;
    if (s.id && s.dur) addHistory(s.id, s.ep, s.t, s.dur);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ���� */
  useEffect(() => {
    if (!active || controlsLocked) return;
    const fn = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (panel) { if (e.key === "Escape") setPanel(null); return; }
      switch (e.key) {
        case "ArrowDown": e.preventDefault(); go(1); break;
        case "ArrowUp": e.preventDefault(); go(-1); break;
        case " ": e.preventDefault(); videoRef.current?.toggle(); break;
        case "ArrowLeft": e.preventDefault(); videoRef.current?.seek(Math.max(0, time - 5), "keyboard_shortcut"); break;
        case "ArrowRight": e.preventDefault(); videoRef.current?.seek(time + 5, "keyboard_shortcut"); break;
        case "f": case "F": toggleFull(); break;
        case "t": case "T": setTheater((v) => !v); break;
        case "m": case "M": setMuted((v) => !v); break;
        case "l": case "L": onLike(); break;
        case "s": case "S": onFav(); break;
        case "c": case "C": setPanel("comments"); break;
        case "e": case "E": setPanel("episodes"); break;
        default: break;
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, controlsLocked, panel, time, index]);

  /* ��׿���ؼ�������ʱ�ȹ���� */
  useEffect(() => {
    if (!panel) { setBackHandler(null); return undefined; }
    setBackHandler(() => { setPanel(null); return true; });
    return () => setBackHandler(null);
  }, [panel]);

  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const toggleFull = () => {
    const el = boxRef.current?.parentElement;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else el.requestFullscreen().catch(() => {});
  };

  /* ���� ˫ָ������� & ƽ�ƣ�Pinch-to-Zoom & Pan�� ���� */
  const cancelSingleGesture = () => {
    clearTapTimer();
    const g = gesture.current;
    if (g?.timer) window.clearTimeout(g.timer);
    gesture.current = null;
    if (holdRef.current) {
      holdRef.current = false;
      setHoldSpeed(false);
    }
    lockArmedRef.current = false;
    setLockArmed(false);
    setScrub(null);
    scrubTarget.current = null;
  };

  const onTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (isDesktop || controlsLocked) return;
    if (e.touches.length === 2) {
      cancelSingleGesture();
      const t0 = e.touches[0];
      const t1 = e.touches[1];
      const dist0 = Math.max(12, Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY));
      const midX0 = (t0.clientX + t1.clientX) / 2;
      const midY0 = (t0.clientY + t1.clientY) / 2;
      pinchRef.current = {
        dist0,
        midX0,
        midY0,
        scale0: zoom.scale,
        x0: zoom.x,
        y0: zoom.y,
      };
    }
  };

  const onTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (isDesktop || controlsLocked) return;
    if (e.touches.length === 2 && pinchRef.current) {
      const p = pinchRef.current;
      const t0 = e.touches[0];
      const t1 = e.touches[1];
      const dist = Math.max(12, Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY));
      const midX = (t0.clientX + t1.clientX) / 2;
      const midY = (t0.clientY + t1.clientY) / 2;
      const nextScale = Math.max(0.85, Math.min(3.5, p.scale0 * (dist / p.dist0)));
      const rawDx = midX - p.midX0;
      const rawDy = midY - p.midY0;
      const dx = rotated ? rawDy : rawDx;
      const dy = rotated ? -rawDx : rawDy;
      const maxX = Math.max(0, (nextScale - 1) * window.innerWidth * 0.55);
      const maxY = Math.max(0, (nextScale - 1) * window.innerHeight * 0.55);
      const nextX = Math.max(-maxX, Math.min(maxX, p.x0 + dx));
      const nextY = Math.max(-maxY, Math.min(maxY, p.y0 + dy));
      setZoom({ scale: nextScale, x: nextX, y: nextY, gesturing: true });
    }
  };

  const onTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    if (isDesktop) return;
    if (pinchRef.current && e.touches.length < 2) {
      pinchRef.current = null;
      setZoom((prev) =>
        prev.scale < 1.08
          ? { scale: 1, x: 0, y: 0, gesturing: false }
          : { ...prev, gesturing: false },
      );
    }
  };

  /* ���� ���� 2x���ϻ������� / ���϶�λ / �������� / ˫����ͣ ���� */
  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDesktop || controlsLocked || !active || !e.isPrimary || pinchRef.current || gesture.current || e.button !== 0) return;
    const el = e.currentTarget;
    const span = rotated ? (el.clientHeight || window.innerHeight || 1) : (el.clientWidth || 1);
    try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const g = {
      x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY,
      t: Date.now(), base: time, width: span,
      playing: videoRef.current?.el()?.paused === false,
      mode: "idle" as "idle" | "hold" | "scrub" | "pan",
      timer: window.setTimeout(() => {
        const cur = gesture.current;
        if (!cur || cur.mode !== "idle" || pinchRef.current) return;
        clearTapTimer();
        cur.mode = "hold";
        holdRef.current = true;
        setHoldSpeed(true);
        setLockArmed(false);
        lockArmedRef.current = false;
        try { navigator.vibrate?.(25); } catch { /* ignore */ }
      }, 380) as unknown as number,
    };
    gesture.current = g;
  };

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pinchRef.current) {
      cancelSingleGesture();
      return;
    }
    const g = gesture.current;
    if (!g || isDesktop || !e.isPrimary) return;
    const rawDx = e.clientX - g.x;
    const rawDy = e.clientY - g.y;
    const dx = rotated ? rawDy : rawDx;
    const dy = rotated ? -rawDx : rawDy;

    /* �����У��ϻ� 64px ���롸�ɿ��������� */
    if (g.mode === "hold") {
      const upDist = rotated ? (e.clientX - g.startX) : (g.startY - e.clientY);
      const armed = upDist > 64;
      if (armed !== lockArmedRef.current) {
        lockArmedRef.current = armed;
        setLockArmed(armed);
      }
      return;
    }

    if (g.mode === "idle") {
      if (Math.abs(dx) > 16 && Math.abs(dx) > Math.abs(dy) * 1.2) {
        clearTapTimer();
        if (g.timer) window.clearTimeout(g.timer);
        g.mode = "scrub";
      } else if (Math.abs(dy) > 16) {
        clearTapTimer();
        if (g.timer) window.clearTimeout(g.timer);
        g.mode = "pan";
      }
      return;
    }

    if (g.mode === "scrub") {
      const total = duration || 0;
      if (!total) return;
      const target = Math.max(0, Math.min(total - 0.2, g.base + (dx / g.width) * total));
      scrubTarget.current = target;
      setScrub({ pct: (target / total) * 100, target });
    }
  };

  const onUp = (e?: React.PointerEvent<HTMLDivElement>, cancelled = false) => {
    if (pinchRef.current) return;
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (g.timer) window.clearTimeout(g.timer);

    if (g.mode === "hold") {
      holdRef.current = false;
      setHoldSpeed(false);
      if (!cancelled && lockArmedRef.current) {
        setSpeedLock(true);
        toast("������ 2.0x ���� �� �㶥����ǩ���", "info");
      }
      lockArmedRef.current = false;
      setLockArmed(false);
      return;
    }
    if (g.mode === "scrub") {
      const target = scrubTarget.current;
      setScrub(null);
      scrubTarget.current = null;
      if (!cancelled && target != null) {
        setErr("");
        setTime(target);
        videoRef.current?.seek(target, "mobile_gesture");
      }
      if (g.playing && active) videoRef.current?.play();
      return;
    }

    if (cancelled || g.mode !== "idle") return;
    const moveDist = e ? Math.hypot(e.clientX - g.x, e.clientY - g.y) : 0;
    if (Date.now() - g.t < 260 && moveDist < 16) {
      const now = Date.now();
      if (now - lastTapRef.current.time < 280) {
        // ˫����Ļ���л���ͣ / ����
        clearTapTimer();
        lastTapRef.current.time = 0;
        videoRef.current?.toggle();
      } else {
        // ������Ļ���л�����ģʽ��������ָ����н���ؼ���ֻ��ʾ��Ƶ���ݣ�
        lastTapRef.current.time = now;
        clearTapTimer();
        lastTapRef.current.timer = window.setTimeout(() => {
          lastTapRef.current.timer = null;
          setClean((c) => !c);
        }, 250) as unknown as number;
      }
    }
  };

  useEffect(() => {
    if (!active || controlsLocked) onUp(undefined, true);
    // Cancel pending gestures when the page is hidden or controls are locked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, controlsLocked]);

  useEffect(() => () => {
    if (gesture.current?.timer) window.clearTimeout(gesture.current.timer);
    gesture.current = null;
  }, [playKey]);

  const lockControls = () => { setPanel(null); setControlsLocked(true); };

  /* �������� / ˫ָ���� / ȫ���ڼ��ֹ����б�ԭ������ */
  useEffect(() => {
    if (isDesktop) return undefined;
    const el = boxRef.current;
    if (!el) return undefined;
    const fn = (e: TouchEvent) => {
      if (holdRef.current || pinchRef.current || fs || e.touches.length >= 2) {
        e.preventDefault();
      }
    };
    el.addEventListener("touchmove", fn, { passive: false });
    return () => el.removeEventListener("touchmove", fn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDesktop, videoIds.length, fs]);

  /* ���� �������϶���ֱ���õ�ǰ����Ԫ�ص� BoundingRect����ת��̨�°� Y �ỻ�㣩 ���� */
  const barPctAt = (barEl: HTMLElement | null, clientX: number, clientY: number) => {
    const r = barEl?.getBoundingClientRect();
    if (!r) return null;
    const span = rotated ? r.height : r.width;
    if (!span) return null;
    const raw = rotated ? (clientY - r.top) / span : (clientX - r.left) / span;
    return Math.max(0, Math.min(1, raw));
  };
  const barSeekTo = (barEl: HTMLElement | null, clientX: number, clientY: number) => {
    const pct = barPctAt(barEl, clientX, clientY);
    if (pct == null) return null;
    setBarPct(pct);
    return pct;
  };
  const onBarDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    videoRef.current?.trace("seek.input.down", { input: "mobile_bar" });
    barScrub.current = true;
    const el = e.currentTarget as HTMLElement;
    try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    barSeekTo(el, e.clientX, e.clientY);
  };
  const onBarMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!barScrub.current) return;
    e.stopPropagation();
    videoRef.current?.trace("seek.input.move", { input: "mobile_bar" });
    barSeekTo(e.currentTarget as HTMLElement, e.clientX, e.clientY);
  };
  const onBarUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!barScrub.current) return;
    barScrub.current = false;
    e.stopPropagation();
    const pct = barPctAt(e.currentTarget as HTMLElement, e.clientX, e.clientY) ?? barPct;
    setBarPct(null);
    if (pct != null && duration > 0) {
      const target = Math.max(0, Math.min(duration - 0.15, pct * duration));
      setErr("");
      setTime(target);
      videoRef.current?.trace("seek.input.up", { input: "mobile_bar", target });
      videoRef.current?.seek(target, "mobile_bar");
    }
  };

  const togglePip = async () => {
    try {
      const v = videoRef.current?.el();
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else if (v && document.pictureInPictureEnabled) await v.requestPictureInPicture();
      else toast("��ǰ������֧�ֻ��л�", "info");
    } catch { toast("���л�����ʧ��", "info"); }
  };

  const requireLogin = () => { if (!user) { setLoginOpen(true); return false; } return true; };

  const onLike = () => {
    if (!curId) return;
    const on = toggleLikeLocal(curId);
    setHeartBurst((n) => n + 1);
    toast(on ? "�Ѽ���ϲ��" : "��ȡ��ϲ��", on ? "heart" : "info");
    if (requireLogin()) { if (kind === "post") api.postLike(curId, on).catch(() => {}); else api.like(curId, curEp, on).catch(() => {}); }
  };

  const onFav = () => {
    if (!curId) return;
    const on = toggleFavLocal(curId);
    toast(on ? "���ղ�" : "��ȡ���ղ�", on ? "star" : "info");
    if (requireLogin()) { if (kind === "post") api.postCollect(curId, on).catch(() => {}); else api.collect(curId, on).catch(() => {}); }
  };

  const onFollow = () => {
    const uid = meta.authorId > 0 ? meta.authorId : undefined;
    if (!uid) return;
    const on = toggleFollowLocal(uid);
    toast(on ? `�ѹ�ע ${detail?.author?.name}` : "��ȡ����ע", on ? "ok" : "info");
    if (requireLogin()) api.follow(uid, on).catch(() => {});
  };

  const pickEp = (ep: number) => {
    setEpMap((m) => ({ ...m, [curId]: ep }));
    setPanel(null);
  };

  const likeCount = useMemo(() => {
    const base = meta.like;
    return base + (isLiked(curId) ? 1 : 0);
  }, [meta.like, curId, isLiked]);

  if (!videoIds.length) {
    return <div className="absolute inset-0 bg-black flex items-center justify-center"><div className="w-9 h-9 spinner" /></div>;
  }

  const effectiveFit: "contain" | "cover" = isDesktop
    ? "contain"
    : isLandscapeVideo
      ? (fs || vpLandscape ? "contain" : portraitFit)
      : (vpLandscape ? "contain" : "cover");

  return (
    <div
      className={`hg-player-ui absolute inset-0 overflow-hidden bg-black player-root ${controlsLocked ? "is-locked" : ""} ${isDesktop ? "player-surface" : ""} ${theater ? "is-theater" : ""} ${isDesktop && idle ? "is-idle" : ""}`}
      onPointerMove={() => { if (isDesktop) wake(); }}>
      <div className="absolute inset-0" inert={controlsLocked}>
      {/* ��Χ������ȫ��ʱ���أ�����͸�������ͼ�� */}
      {!fs && (
        <div className="absolute inset-0 scale-110 blur-3xl opacity-25 pointer-events-none">
          {posterUrl && <img src={posterUrl} alt="" className="w-full h-full object-cover" />}
        </div>
      )}

      <div ref={boxRef} onScroll={onScroll}
        className={`absolute inset-y-0 left-0 no-bar ${fs ? "overflow-hidden" : "overflow-y-scroll snap-y snap-mandatory overscroll-y-contain"}`}
        style={{ right: isDesktop && panel ? 372 : 0, transition: "right .3s cubic-bezier(.2,0,0,1)" }}>
        {videoIds.map((vid, i) => {
          const isActive = i === index;
          return (
            <section
              key={vid}
              style={!isActive && fs ? { display: "none" } : undefined}
              className={`relative w-full h-full snap-start snap-always ${fs && isActive ? "" : "overflow-hidden"}`}>
              {isActive && playUrl ? (
                <div className={rotated ? "fs-landscape" : (!isDesktop && fs ? "fs-immersive" : "absolute inset-0")}>
                  <div
                    className="absolute inset-0 overflow-hidden"
                    style={{ touchAction: fs || zoom.scale > 1.05 ? "none" : "pan-y" }}
                    onTouchStart={onTouchStart}
                    onTouchMove={onTouchMove}
                    onTouchEnd={onTouchEnd}
                    onTouchCancel={onTouchEnd}
                    onPointerDown={onDown}
                    onPointerMove={onMove}
                    onPointerUp={(e) => onUp(e, false)}
                    onPointerCancel={(e) => onUp(e, true)}
                    onLostPointerCapture={(e) => onUp(e, true)}>
                    <VideoSurface
                      ref={videoRef}
                      src={playUrl}
                      poster={fs ? undefined : posterUrl}
                      autoPlay
                      active={active}
                      diagnosticContext={{ active, view: mode, kind, video_id: curId, episode: curEp }}
                      muted={muted}
                      volume={volume}
                      rate={effRate}
                      fit={effectiveFit}
                      scale={zoom.scale}
                      panX={zoom.x}
                      panY={zoom.y}
                      isGesturing={zoom.gesturing}
                      onClick={() => { if (isDesktop) videoRef.current?.toggle(); }}
                      onTime={onTimeTick}
                      onDuration={onDurationTick}
                      onSize={(w, h) => setVsize({ w, h })}
                      onPlaying={() => { setPaused(false); setWaiting(false); setErr(""); }}
                      onPause={() => setPaused(true)}
                      onWaiting={() => setWaiting(true)}
                      onEnded={() => { const next = episodes.find((e) => e.ep_num === curEp + 1); if (next) pickEp(next.ep_num); }}
                      onError={(m) => setErr(m)}
                    />
                  </div>

                  {/* ���϶�λ���� */}
                  {!isDesktop && scrub && (
                    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center pointer-events-none" style={{ background: "rgba(0,0,0,.25)" }}>
                      <span className="text-[26px] font-bold hg-ink tabular-nums hg-ov-shadow">{fmtTime(scrub.target)}</span>
                      <span className="text-[11px] hg-ink-4 mt-1 tabular-nums">/ {fmtTime(duration)}</span>
                      <div className="mt-4 w-[62%] h-[3px] rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,.25)" }}>
                        <div className="h-full bg-white" style={{ width: `${scrub.pct}%` }} />
                      </div>
                    </div>
                  )}

                  {/* ��ͣ / ���� / �����ָ� */}
                  {paused && !err && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
                      <span className="w-[66px] h-[66px] rounded-full flex items-center justify-center backdrop-blur-md"
                        style={{ background: "rgba(0,0,0,.55)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,.12)" }}>
                        <IPlayF size={28} className="hg-ink ml-0.5" />
                      </span>
                    </div>
                  )}
                  {waiting && !err && !paused && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none"><div className="w-9 h-9 spinner" /></div>
                  )}
                  {err && (
                    <div className="absolute inset-0 z-30 flex items-center justify-center">
                      <div className="rounded-xl p-5 flex flex-col items-center gap-3 text-[13px] hg-ink-2" style={{ background: "rgba(0,0,0,.74)" }}>
                        <span>��Ƶ��ʱ�޷�����</span>
                        <span className="text-[10.5px] hg-ink-4 max-w-[240px] text-center break-all">{err}</span>
                        <button className="px-4 py-1.5 rounded-full hg-chip-strong hg-link text-[12.5px] font-semibold pressable"
                          onClick={() => { setErr(""); setWaiting(true); videoRef.current?.reload(); }}>
                          ���¼���
                        </button>
                      </div>
                    </div>
                  )}

                  {/* �ƶ��ˣ�����״̬ / ������ʾ */}
                  {!isDesktop && (!clean || holdSpeed) && (holdSpeed || speedLock || rate !== 1) && (
                    <button
                      onClick={() => {
                        if (speedLock) { setSpeedLock(false); toast("�ѽ����������", "info"); }
                        else if (rate !== 1 && !holdSpeed) setRate(1);
                      }}
                      className={`absolute left-1/2 -translate-x-1/2 z-30 flex items-center gap-1.5 px-3.5 h-8 rounded-full backdrop-blur-md text-[12px] font-bold elev-2 pressable ${speedLock ? "bg-primary text-on-primary" : "hg-chip hg-gold"}`}
                      style={{ top: rotated || vpLandscape ? 14 : "calc(var(--sat, 0px) + 54px)" }}>
                      <IBoltF size={13} />
                      {effRate}x {speedLock ? "������ �� �㰴���" : holdSpeed ? "������ �� �ɿ��ָ�" : "����"}
                    </button>
                  )}
                  {!isDesktop && holdSpeed && (
                    <div
                      className={`absolute left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 px-4 h-10 rounded-xl backdrop-blur-md elev-2 transition-all duration-200 ${lockArmed ? "bg-primary text-on-primary scale-110" : "hg-chip-strong hg-ink-2"}`}
                      style={{ top: "38%" }}>
                      <ILockF size={16} />
                      <span className="text-[12.5px] font-bold">{lockArmed ? "�ɿ����� 2.0x" : "�ϻ�������������"}</span>
                    </div>
                  )}

                  {/* �ƶ��ˣ�����ȫ�������������� clean ģʽ�����أ�������Ļ�ɺ���/���أ� */}
                  {!isDesktop && fs && !clean && !controlsLocked && (
                    <>
                      <div className="absolute right-4 z-40 flex items-center gap-2"
                        style={{ top: rotated || vpLandscape ? 14 : "calc(var(--sat, 0px) + 8px)" }}>
                        <button onClick={lockControls} aria-label="�������ſ���" title="�������ſ���" aria-pressed={false}
                          className="hg-chip-strong w-9 h-9 rounded-full backdrop-blur-md flex items-center justify-center pressable elev-1">
                          <ILockF size={17} />
                        </button>
                        <button onClick={exitFs} aria-label="�˳�ȫ��"
                          className="hg-chip-strong w-9 h-9 rounded-full backdrop-blur-md flex items-center justify-center pressable elev-1">
                          <ICompress size={18} />
                        </button>
                      </div>
                      {zoom.scale > 1.05 && (
                        <button
                          onClick={() => setZoom({ scale: 1, x: 0, y: 0, gesturing: false })}
                          className="hg-chip-strong absolute left-4 z-40 px-3 h-8 rounded-full backdrop-blur-md text-[11.5px] font-semibold flex items-center gap-1 pressable elev-1"
                          style={{ top: rotated || vpLandscape ? 14 : "calc(var(--sat, 0px) + 8px)" }}>
                          ��ԭ���� ({zoom.scale.toFixed(1)}x)
                        </button>
                      )}
                      <div className="absolute inset-x-0 z-30 px-4" style={{ bottom: rotated || vpLandscape ? 46 : "calc(var(--sab, 0px) + 52px)", height: 26 }}>
                        <div className="relative h-full" style={{ touchAction: "none" }}
                          onPointerDown={onBarDown} onPointerMove={onBarMove} onPointerUp={onBarUp} onPointerCancel={onBarUp}>
                          <div className={`absolute inset-x-0 bottom-[10px] rounded-full transition-all ${barPct !== null ? "h-[5px]" : "h-[3px]"}`}
                            style={{ background: "rgba(255,255,255,.3)" }}>
                            <div className="h-full rounded-full bg-white" style={{ width: `${barProgress * 100}%` }} />
                          </div>
                          {barPct !== null && (
                            <div className="absolute left-1/2 -translate-x-1/2 -top-8 px-2.5 py-1 rounded-md hg-chip-strong backdrop-blur-md text-[12px] font-bold tabular-nums whitespace-nowrap">
                              {fmtTime(barPct * (duration || 0))} / {fmtTime(duration)}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="absolute inset-x-0 z-40 flex items-center gap-3 px-4"
                        style={{ bottom: rotated || vpLandscape ? 10 : "calc(var(--sab, 0px) + 10px)" }}>
                        <button onClick={() => videoRef.current?.toggle()}
                          className="hg-chip shrink-0 w-9 h-9 rounded-full flex items-center justify-center pressable">
                          {paused ? <IPlayF size={18} /> : <IPauseF size={17} />}
                        </button>
                        <span className="shrink-0 text-[11.5px] font-semibold hg-ink-2 tabular-nums">{fmtTime(time)}</span>
                        <button
                          onClick={() => {
                            if (speedLock) { setSpeedLock(false); return; }
                            const seq = [1, 1.25, 1.5, 2];
                            const idx = seq.indexOf(rate);
                            setRate(seq[(idx + 1) % seq.length]);
                          }}
                          className={`ml-auto shrink-0 flex items-center gap-1 px-2.5 h-8 rounded-full text-[12px] font-bold pressable ${effRate !== 1 ? "bg-primary text-on-primary" : "hg-chip hg-ink-2"}`}>
                          <IBoltF size={12} />{effRate}x
                        </button>
                        <span className="shrink-0 text-[11.5px] hg-ink-4 tabular-nums">{fmtTime(duration)}</span>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div className="absolute inset-0">
                  <Img src={cards[vid]?.cover || posts[vid]?.cover || details[vid]?.cover || (isActive ? detail?.cover : "") || ""} eager={Math.abs(i - index) <= 1} />
                  <div className="absolute inset-0" style={{ background: "rgba(0,0,0,.25)" }} />
                </div>
              )}

              {/* ȡ�������ŵ�ַʱ���������ᴴ����������ʾҪ���ڲ��������棬����ֻ��ͣ�ڷ��� */}
              {isActive && kind === "video" && !playUrl && !!err && (
                <div className="absolute inset-0 z-30 flex items-center justify-center">
                  <div className="rounded-xl p-5 flex flex-col items-center gap-3 text-[13px] hg-ink-2" style={{ background: "rgba(0,0,0,.74)" }}>
                    <span>��Ƶ��ʱ�޷�����</span>
                    <span className="text-[10.5px] hg-ink-4 max-w-[240px] text-center break-all">{err}</span>
                    <button className="px-4 py-1.5 rounded-full hg-chip-strong hg-link text-[12.5px] font-semibold pressable"
                      onClick={() => { setErr(""); setWaiting(true); setPlayTry((n) => n + 1); }}>
                      ���¼���
                    </button>
                  </div>
                </div>
              )}

              {/* ͼ������û����Ƶ�͸���������� */}
              {isActive && kind === "post" && !!post && !post.video_url && (
                <div className="absolute inset-0 z-10 flex items-center justify-center">
                  <button type="button" onClick={() => setPanel("article")}
                    className="flex items-center gap-2 h-11 px-5 rounded-full text-[13.5px] font-semibold pressable elev-3"
                    style={{ background: "rgba(255,255,255,.94)", color: "#0b0e15" }}>
                    <IFileText size={17} />�鿴ͼ������
                  </button>
                </div>
              )}

              {/* ����ѹ������֤���ֿɶ�������ģʽ�²���ѹ�����֣�ֻ��ʾ����Ƶ���ݣ� */}
              {!fs && !clean && (
                <div className="absolute inset-0 pointer-events-none"
                  style={{ background: "linear-gradient(0deg, rgba(8,11,15,.86) 0, rgba(11,14,20,.18) 26%, transparent 48%)" }} />
              )}

              {/* �����¹ۿ�������Ƶ����ݡ��Ŵ����� / ������ʾ / ȫ����������˫ָ���Ÿ�λ���� */}
              {isActive && !fs && !clean && !isDesktop && (isLandscapeVideo || zoom.scale > 1.05) && (
                <div
                  className="absolute left-1/2 -translate-x-1/2 z-20 flex items-center gap-2"
                  style={{ top: "64%" }}>
                  {isLandscapeVideo && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          if (zoom.scale > 1.05) {
                            setZoom({ scale: 1, x: 0, y: 0, gesturing: false });
                            setPortraitFit("contain");
                          } else {
                            setPortraitFit((f) => (f === "contain" ? "cover" : "contain"));
                          }
                        }}
                        className="hg-chip-strong backdrop-blur-md px-3 h-7 rounded-full text-[11.5px] font-semibold flex items-center gap-1.5 pressable elev-1">
                        {zoom.scale > 1.05
                          ? `��ԭ���� (${zoom.scale.toFixed(1)}x)`
                          : portraitFit === "contain"
                            ? "�Ŵ�����"
                            : "������Ӧ"}
                      </button>
                      <button
                        type="button"
                        onClick={enterFs}
                        className="hg-chip-strong backdrop-blur-md px-3 h-7 rounded-full text-[11.5px] font-semibold flex items-center gap-1 pressable elev-1">
                        <IExpand size={12} />����ȫ��
                      </button>
                    </>
                  )}
                  {!isLandscapeVideo && zoom.scale > 1.05 && (
                    <button
                      type="button"
                      onClick={() => setZoom({ scale: 1, x: 0, y: 0, gesturing: false })}
                      className="hg-chip-strong backdrop-blur-md px-3 h-7 rounded-full text-[11.5px] font-semibold flex items-center gap-1 pressable elev-1">
                      ��ԭ���� ({zoom.scale.toFixed(1)}x)
                    </button>
                  )}
                </div>
              )}

              {/* ���� */}
              {!fs && !clean && mode === "context" ? (
                isDesktop ? (
                  <div className="desktop-context-header">
                    <button onClick={onBack} aria-label="����"><IBack size={17} /></button>
                    <span>{title}</span>
                    <small>{index + 1} / {videoIds.length}</small>
                  </div>
                ) : (
                  <div className="absolute inset-x-0 z-20 flex items-center gap-2 px-2.5" style={{ top: "calc(var(--sat, 0px) + 8px)", paddingRight: 148 }}>
                    <button onClick={onBack} aria-label="����" className="hg-chip w-9 h-9 rounded-full flex items-center justify-center pressable elev-1"><IBack size={20} /></button>
                    <span className="text-[14.5px] font-semibold hg-ink hg-ov-shadow truncate">{title}</span>
                    <span className="ml-auto px-2 py-0.5 rounded-full hg-chip text-[11px] font-semibold" style={{ color: "rgba(255,255,255,.9)" }}>{index + 1} / {videoIds.length}</span>
                  </div>
                )
              ) : null}

              {/* �Ҳ���������ƶ��ˣ����ղ� / ���� / ȫ�� / ����
                  ��ɫд�����������ߣ�ǳɫ��������Щ�ֱ������ǰ�ɫ */}
              {!fs && !clean && !isDesktop && (
                <div className="absolute right-3 z-20 flex flex-col items-center gap-[16px]"
                  style={{ bottom: `calc(var(--sab, 0px) + ${bottomInset + 92}px)` }}>
                  <button onClick={onFav} className="flex flex-col items-center gap-1 pressable" aria-pressed={isFav(curId)} aria-label="�ղ�">
                    {isFav(curId) ? <IStarF size={27} className="hg-gold" /> : <IStar size={27} className="hg-ink hg-ov-shadow" />}
                    <span className="text-[10.5px] hg-ink-2 hg-ov-shadow">�ղ�</span>
                  </button>
                  <button onClick={() => setPanel("comments")} className="flex flex-col items-center gap-1 pressable" aria-label="����">
                    <ICommentF size={26} className="hg-ink hg-ov-shadow" />
                    <span className="text-[10.5px] hg-ink-2 hg-ov-shadow">����</span>
                  </button>
                  <button onClick={enterFs} className="flex flex-col items-center gap-1 pressable" aria-label="ȫ��">
                    <IExpand size={26} className="hg-ink hg-ov-shadow" />
                    <span className="text-[10.5px] hg-ink-2 hg-ov-shadow">ȫ��</span>
                  </button>
                  <button onClick={shareLink} className="flex flex-col items-center gap-1 pressable" aria-label="����">
                    <ILink size={25} className="hg-ink hg-ov-shadow" />
                    <span className="text-[10.5px] hg-ink-2 hg-ov-shadow">����</span>
                  </button>
                </div>
              )}

              {/* �Ҳ�����������棩 */}
              {!fs && isDesktop && (
              <div className="absolute z-20 flex flex-col items-center desktop-social">
                <div className="desktop-browse-inline">
                  <button onClick={() => go(-1)} disabled={index === 0} aria-label="��һ��" title="��һ�� ��">
                    <IChevronUp size={19} strokeWidth={1.8} />
                  </button>
                  <button onClick={() => go(1)} disabled={index >= videoIds.length - 1} aria-label="��һ��" title="��һ�� ��">
                    <IChevronDown size={19} strokeWidth={1.8} />
                  </button>
                  <small>{String(index + 1).padStart(2, "0")} / {String(videoIds.length).padStart(2, "0")}</small>
                </div>

                {kind === "video" && (
                  <>
                    <button onClick={onLike} className="flex flex-col items-center gap-1 pressable" aria-pressed={isLiked(curId)}>
                      <span key={heartBurst} className={heartBurst ? "a-pop" : ""}>
                        {isLiked(curId) ? <IHeartF size={30} className="text-neon" /> : <IHeart size={30} className="text-white tsh" />}
                      </span>
                      <span className="text-[10.5px] text-white/90 tabular-nums">{fmt(likeCount)}</span>
                    </button>

                    <button onClick={() => setPanel("comments")} className="flex flex-col items-center gap-1 pressable">
                      <ICommentF size={27} className="text-white tsh" />
                      <span className="text-[10.5px] text-white/90 tabular-nums">{fmt(meta.comment)}</span>
                    </button>

                    <button onClick={onFav} className="flex flex-col items-center gap-1 pressable" aria-pressed={isFav(curId)}>
                      {isFav(curId) ? <IStarF size={27} className="hg-gold" /> : <IStar size={27} className="hg-ink hg-ov-shadow" />}
                      <span className="text-[10.5px] text-white/90 tabular-nums">{fmt(meta.collect)}</span>
                    </button>

                    <button onClick={() => setPanel("episodes")} className="flex flex-col items-center gap-1 pressable">
                      <IList size={26} className="text-white tsh" />
                      <span className="text-[10.5px] text-white/90">ѡ��</span>
                    </button>
                  </>
                )}

                <button onClick={shareLink} className="flex flex-col items-center gap-1 pressable">
                  <ILink size={25} className="text-white tsh" />
                  <span className="text-[10.5px] text-white/90">����</span>
                </button>
              </div>
              )}

              {/* ���棺������Ϣ */}
              {!fs && isDesktop && (
              <div className="desktop-video-meta">
                <div className="flex items-center gap-2">
                  <span className="text-[15px] font-bold text-white tsh truncate">@{meta.author}</span>
                  {episodes.length > 0 && (
                    <span className="shrink-0 px-1.5 py-px rounded-md text-[10px] font-bold text-white"
                      style={{ background: "rgba(255,255,255,.16)" }}>
                      �� {curEp}/{episodes.length} ��
                    </span>
                  )}
                  {!!meta.score && (
                    <span className="shrink-0 text-[11px] font-bold hg-gold hg-ov-shadow">{meta.score.toFixed(1)} ��</span>
                  )}
                </div>

                <p className="mt-1 text-[13.5px] leading-snug hg-ink-2 hg-ov-shadow clamp-2">{meta.title}</p>

                {/* ���������У��㿪չ���� */}
                <button onClick={() => setDescOpen((v) => !v)} className="mt-1 text-left w-full pressable group">
                  <p className={`text-[11.5px] leading-relaxed hg-ink-4 ${descOpen ? "" : "clamp-1"}`}>
                    {meta.desc || "���޼��"}
                  </p>
                  <span className="text-[10.5px] hg-link font-semibold">{descOpen ? "����" : "չ�����"}</span>
                </button>
              </div>
              )}

              {/* �ƶ��ˣ����� + �����ǩ + �����ߣ����� clean ģʽ�����أ� */}
              {!fs && !clean && !isDesktop && (
                <div className="absolute inset-x-0 z-20" style={{ bottom: `calc(var(--sab, 0px) + ${bottomInset}px)` }}>
                  <div className="absolute inset-x-0 bottom-0 h-[190px] pointer-events-none"
                    style={{ background: "linear-gradient(0deg, rgba(0,0,0,.82) 0%, rgba(0,0,0,.42) 45%, transparent 100%)" }} />
                  <p className="relative px-4 pb-2 text-[14px] font-semibold leading-snug hg-ink hg-ov-shadow clamp-2">{meta.title}</p>
                  <div className="relative pt-1.5 pb-2">
                    <button onClick={() => setPanel("detail")}
                      className="px-4 flex items-center gap-0.5 text-[10.5px] font-medium hg-ink hg-ov-shadow pressable">
                      ���� �� �� {curEp} ��<IChevR size={11} />
                    </button>
                    {isActive && (
                      <div className="mx-4 mt-1.5 relative" style={{ height: 22, touchAction: "none" }}
                        onPointerDown={onBarDown} onPointerMove={onBarMove} onPointerUp={onBarUp} onPointerCancel={onBarUp}>
                        <div className={`absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-full transition-all ${barPct !== null ? "h-[5px]" : "h-[2.5px]"}`}
                          style={{ background: "rgba(255,255,255,.3)" }}>
                          <div className="h-full rounded-full bg-white"
                            style={{ width: `${barProgress * 100}%`, transition: barPct !== null ? "none" : "width .25s linear" }} />
                        </div>
                        {barPct !== null && (
                          <div className="absolute left-1/2 -translate-x-1/2 -top-8 px-2.5 py-1 rounded-md hg-chip-strong backdrop-blur-md text-[12px] font-bold tabular-nums whitespace-nowrap">
                            {fmtTime(barPct * (duration || 0))} / {fmtTime(duration)}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </section>
          );
        })}
      </div>

      {/* ��������� */}
      {isDesktop && (
        <PlayerControls
          paused={paused} time={time} duration={duration} buffered={buffered} rate={rate}
          muted={muted} volume={volume} theater={theater} fullscreen={fullscreen}
          visible={active && !idle}
          seekEnabled={active && !controlsLocked}
          seekKey={playKey}
          nextDisabled={!episodes.some((e) => e.ep_num === curEp + 1) && index >= videoIds.length - 1}
          nextTitle={episodes.some((e) => e.ep_num === curEp + 1) ? "��һ�� E" : "��һ�� ��"}
          onToggle={() => videoRef.current?.toggle()}
          onSeek={(t, source) => { videoRef.current?.seek(t, source); setTime(t); }}
          onSeekInteraction={(phase, input, target, pointerTarget) => videoRef.current?.trace(`seek.input.${phase}`, { input, target, pointer_target: pointerTarget })}
          onRate={(r) => { setRate(r); videoRef.current?.rate(r); }}
          onMute={() => setMuted((m) => !m)}
          onVolume={(v) => setVolume(v)}
          onPip={togglePip}
          onLock={lockControls}
          onTheater={() => setTheater((v) => !v)}
          onFullscreen={toggleFull}
          onNext={() => {
            const nx = episodes.find((e) => e.ep_num === curEp + 1);
            if (nx) pickEp(nx.ep_num);
            else go(1);
          }}
        />
      )}

      {/* ѡ�� / ���ۣ�����ͣ�����Ҳࣨ������λ�����ƶ��˵ײ����� */}
      {isDesktop ? (
        <div className={`desktop-dock-panel ${panel ? "is-open" : ""}`}>
          <div className="desktop-dock-inner">
            {panel === "episodes" ? (
              <EpisodesPanel videoId={curId} episodes={episodes} current={curEp} onPick={pickEp} onClose={() => setPanel(null)} />
            ) : panel === "comments" ? (
              <CommentsPanel videoId={curId} ep={curEp} total={meta.comment} kind={kind} onClose={() => setPanel(null)} />
            ) : null}
          </div>
        </div>
      ) : (
        <>
          {/* ���ۣ��ƶ��˵ײ����㣨�Ҳ�����������ۡ���ڣ� */}
          <Sheet open={panel === "comments"} onClose={() => setPanel(null)}>
            <div className="flex flex-col" style={{ height: "72vh" }}>
              <CommentsPanel videoId={curId} ep={curEp} total={meta.comment} kind={kind} onClose={() => setPanel(null)} />
            </div>
          </Sheet>

          {/* �Թ�ͼ������ */}
          <Sheet open={panel === "article"} onClose={() => setPanel(null)}>
            <div className="flex flex-col" style={{ height: "78vh" }}>
              <ArticlePanel title={meta.title} html={articleHtml} cover={meta.cover} hot={post?.hot} onClose={() => setPanel(null)} />
            </div>
          </Sheet>

          <Sheet open={panel === "detail" || panel === "episodes"} onClose={() => setPanel(null)}>
            <div className="flex flex-col" style={{ height: "72vh" }}>
              {/* ˫�����룺���� / ѡ�� */}
              <div className="shrink-0 flex items-center gap-2 px-4 pb-2">
                <div className="flex flex-1 bg-s3 rounded-(--r-ctl) p-1">
                  {([["detail", "����"], ["episodes", "ѡ��"]] as const).map(([k, l]) => (
                    <button key={k} onClick={() => setPanel(k)}
                      className={`flex-1 h-8 rounded-(--r-ctl) text-[12px] font-semibold pressable ${panel === k ? "text-on-sec" : "text-mut"}`}
                      style={panel === k ? { background: "var(--p-sec)", color: "var(--p-primary)" } : undefined}>{l}</button>
                  ))}
                </div>
                <button onClick={() => setPanel(null)} aria-label="�ر�"
                  className="w-8 h-8 rounded-full bg-s3 flex items-center justify-center text-mut pressable">
                  <IClose size={14} />
                </button>
              </div>

              <div className="flex-1 min-h-0">
                {panel === "episodes" ? (
                  <EpisodesPanel bare videoId={curId} episodes={episodes} current={curEp} onPick={pickEp} onClose={() => setPanel(null)} />
                ) : (
                  <div className="h-full scroll-y px-4 pb-5">
                    {/* ���� / ���� / ���� / ���� */}
                    <div className="flex gap-3">
                      <div className="relative w-[84px] shrink-0 rounded-(--r-sm) overflow-hidden bg-s3" style={{ aspectRatio: "3 / 4" }}>
                        <Img src={meta.cover} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13.5px] font-bold text-on leading-snug clamp-2">{meta.title}</div>
                        <div className="flex items-center gap-2 mt-1.5">
                          {!!meta.score && <span className="text-[12px] font-bold text-amber">{meta.score.toFixed(1)} ��</span>}
                          {episodes.length > 0 && <span className="text-[10.5px] text-mut">�� {episodes.length} ��</span>}
                        </div>
                        <div className="flex gap-3 mt-2 text-[10.5px] text-mut">
                          <span>���� {fmt(meta.like)}</span>
                          <span>�ղ� {fmt(meta.collect)}</span>
                          <span>���� {fmt(meta.comment)}</span>
                        </div>
                      </div>
                    </div>

                    {/* ���� + ��ע */}
                    <div className="mt-4 flex items-center gap-2.5 rounded-(--r-md) bg-s2 p-2.5">
                      <Avatar size={34} name={meta.author} hue={220} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[12.5px] font-semibold text-on truncate">{meta.author}</div>
                        <div className="text-[10px] text-mut">����</div>
                      </div>
                      {meta.authorId > 0 && (
                        <button onClick={onFollow}
                          className={`h-7 px-3 rounded-full text-[11px] font-semibold pressable ${store.follows.includes(meta.authorId) ? "bg-s3 text-mut" : "bg-primary text-on-primary"}`}>
                          {store.follows.includes(meta.authorId) ? "�ѹ�ע" : "+ ��ע"}
                        </button>
                      )}
                    </div>

                    {/* ��� */}
                    <div className="mt-4">
                      <div className="text-[11px] font-semibold text-dim mb-1.5">���</div>
                      <p className="text-[11.5px] leading-relaxed text-mut whitespace-pre-wrap">{meta.desc || "���޼��"}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </Sheet>
        </>
      )}
      </div>
      {!isDesktop && !fs && !clean && !controlsLocked && active && (
        <div className="absolute right-3 z-40 flex items-center gap-2" style={{ top: "calc(var(--sat, 0px) + 6px)" }}>
          <button onClick={() => setMuted(m => !m)} aria-label={muted ? "ȡ������" : "����"}
            className="hg-chip w-9 h-9 rounded-full flex items-center justify-center pressable elev-1">
            {muted ? <IVolMute size={17} /> : <IVol size={17} />}
          </button>
          <button onClick={lockControls} aria-label="�������ſ���" title="�������ſ���" aria-pressed={false}
            className="hg-chip w-9 h-9 rounded-full flex items-center justify-center pressable elev-1"><ILockF size={17} /></button>
          <button onClick={() => store.setTab("search")} aria-label="����"
            className="hg-chip w-9 h-9 rounded-full flex items-center justify-center pressable elev-1"><ISearch size={18} /></button>
        </div>
      )}
      {controlsLocked && <PlaybackLock active={active} onUnlock={() => { setControlsLocked(false); wake(); }} />}
    </div>
  );
}
