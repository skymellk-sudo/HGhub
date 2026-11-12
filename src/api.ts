import { invoke, native } from "./runtime";
import type {
  CommentPage, Detail, Paged, PlayInfo, Post, RankItem, User, VideoCard,
} from "./types";

/* ���� ���л��� ������������������������������������������������������������������������������������������ */

/** Ӧ�ð汾������ʱ�� vite.config.ts �� package.json ע�룩 */
export const APP_VERSION = __APP_VERSION__;

const ua = navigator.userAgent;
/** iPhone �� UA Ҳ����like Mac OS X������������ macOS �жϣ�iPadOS Ĭ��αװ�� Mac���ô��������֡� */
export const isIos =
  /iPhone|iPad|iPod/i.test(ua) ||
  (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) ||
  (typeof navigator.platform === "string" && navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
export const isAndroid = /Android/i.test(ua);
export const isMacos = !isIos && /Macintosh|Mac OS X/i.test(ua);
export const isLinux = !isAndroid && !isIos && /Linux/i.test(ua);
export const platform: "android" | "ios" | "windows" | "macos" | "linux" =
  isAndroid ? "android" : isIos ? "ios" : isMacos ? "macos" : isLinux ? "linux" : "windows";
/** �ƶ��ˣ���׿ / iOS�����ô������� */
export const isMobile = isAndroid || isIos;

/** �Զ���Э���ַ��ƽ̨��ͬ���� tauri `register_asynchronous_uri_scheme_protocol` �ĵ�����
 *  Windows / Android �� `http://<scheme>.localhost`
 *  macOS / iOS / Linux �� `<scheme>://localhost`
 *  Rust �� `src-tauri/src/lib.rs` ���д m3u8 �õ� scheme �������һ�¡� */
export const LOCAL = !native ? "/media" : isMacos || isIos || isLinux ? "hg://localhost" : "http://hg.localhost";

/** src �Ƿ����Ǳ���Э���ַ������������ҳ�Ѵ�����ַ�ٰ�һ�㣩 */
export const isLocalMedia = (src: string) => src.startsWith(`${LOCAL}/`);

/** ���棺������Э����ܣ�վ������� AES ���ģ��� */
export const cover = (url?: string, _w = 480) =>
  url ? `${LOCAL}/img?u=${encodeURIComponent(url)}` : "";

/** �����б���������Э���д��Ƭ��ַ����� CORS ��������� */
export const playlist = (url: string) => `${LOCAL}/hls?u=${encodeURIComponent(url)}`;

/* ���� ���÷�װ ������������������������������������������������������������������������������������������ */

/** дһ�е�Ӧ������Ŀ¼ debug.log���û��������򲻿���ʱҪ�ľ������� */
export const logLine = (msg: string) => invoke("debug_log", { msg }).catch(() => {});

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return (await invoke(cmd, args)) as T;
  } catch (e) {
    const msg = typeof e === "string" ? e : "����ʧ�ܣ���������";
    // ����������������dns error / connection refused / ֤����󡭣���toast ֻ��ʾ�ضϰ�
    logLine(`[api] ${cmd} �� ${msg}`);
    const status = /^HTTP (\d{3})\b/.exec(msg)?.[1];
    if (status) {
      throw new Error(`����������ʧ�ܣ�HTTP ${status}�������Ժ����Ի����������л���·`);
    }
    throw new Error(msg.length > 140 ? `${msg.slice(0, 140)}��` : msg);
  }
}

/* ���� �ӿ� �������������������������������������������������������������������������������������������������� */

export const api = {
  boot: () =>
    call<{
      user: User | null;
      logged_in: boolean;
      base: string;
      strict_security?: boolean;
      cli_relaxed?: boolean;
    }>("app_boot"),
  securitySet: (strict: boolean) => call<boolean>("security_set", { strict }),
  login: (username: string, password: string) =>
    call<{ user: User }>("api_login", { username, password }),
  register: (username: string, password: string, email = "") =>
    call<{ user: User }>("api_register", { username, password, email }),
  logout: () => call<{ ok: boolean }>("api_logout"),
  me: () => call<User>("api_me"),

  feed: (page = 1, size = 20) => call<Paged<VideoCard>>("api_feed", { page, size }),
  category: (cate: string, page = 1, size = 20) =>
    call<Paged<VideoCard>>("api_category", { cate, page, size }),
  rank: (kind: "hot" | "recommend" | "potential") =>
    call<{ type: string; items: RankItem[] }>("api_rank", { kind }),
  search: (q: string, page = 1, size = 20) =>
    call<{ items: VideoCard[]; pagination: Paged<VideoCard>["pagination"]; keyword: string }>(
      "api_search", { q, page, size },
    ),
  posts: (page = 1, size = 20) => call<Paged<Post>>("api_posts", { page, size }),
  post: (id: number) => call<Post & { content?: string; video_url?: string }>("api_post", { id }),

  video: (id: number) => call<Detail>("api_video", { id }),
  play: (id: number, ep: number) => call<PlayInfo>("api_play", { id, ep }),

  comments: (id: number, ep: number, page = 1, size = 20) =>
    call<CommentPage>("api_comments", { id, ep, page, size }),
  commentSend: (id: number, ep: number, text: string, replyId?: number) =>
    call<unknown>("api_comment_send", { id, ep, text, replyId: replyId ?? null }),

  clearCache: () => invoke<void>("cache_clear"),
  netDiag: () => invoke<Record<string, unknown>>("net_diag"),
  postLike: (id: number, on: boolean) => invoke<unknown>("api_post_like", { id, on }),
  postCollect: (id: number, on: boolean) => invoke<unknown>("api_post_collect", { id, on }),
  postComments: (id: number, page: number, size: number) => call<CommentPage>("api_post_comments", { id, page, size }),
  like: (id: number, ep: number, on: boolean) => call<unknown>("api_like", { id, ep, on }),
  collect: (id: number, on: boolean) => call<unknown>("api_collect", { id, on }),
  follow: (uid: number, on: boolean) => call<unknown>("api_follow", { uid, on }),

  /* ��·������Դ�����̶���·д���� Rust �࣬������·����ӵ�ַ����ҳ��ȡ */
  lineState: () => call<LineState>("line_state"),
  lineSet: (url: string) => call<string>("line_set", { url }),
  lineMirrors: () => call<LineMirrors>("line_mirrors"),
  lineProbe: (urls: string[]) => call<LineProbe[]>("line_probe", { urls }),

  /* ���¼�飺�Ա� GitHub Release �� tag */
  checkUpdate: () => call<UpdateInfo>("check_update"),
  openUrl: (url: string) => call<void>("open_url", { url }),
};

/* ���� ���¼�� ������������������������������������������������������������������������������������������ */

export type UpdateInfo = {
  current: string;
  latest: string;
  tag?: string;
  has_update: boolean;
  url: string;
  name?: string;
  published_at?: string;
  notes?: string;
};

/* ���� ��·������Դ�� ������������������������������������������������������������������������������ */

export type LineItem = { name?: string; url: string; host?: string };
export type LineState = { base: string; default: string; fixed: LineItem[] };
export type LineMirrors = { source: string; script?: string; items: LineItem[] };
export type LineProbe = { url: string; ok: boolean; status?: number; ms: number; error?: string };

/** `https://a.b/c` �� `a.b`����·չʾ�ã� */
export const hostOf = (url: string) => {
  try { return new URL(url).host; } catch { return url.replace(/^https?:\/\//, "").replace(/\/.*$/, ""); }
};

/* ���� �Լ죺��֤ webview �� ����Э�� �� ���� ��ȡ����· ������������������ */
export async function selfTest(): Promise<string> {
  const steps: string[] = [];
  try {
    const info = await api.play(117, 3);
    steps.push(`play:${info?.video_url ? "ok" : "empty"}`);
    const hlsUrl = `${LOCAL}/hls?u=${encodeURIComponent(info.video_url)}`;
    const r1 = await fetch(hlsUrl);
    const txt = await r1.text();
    steps.push(`hls:${r1.status}/${txt.length}/${txt.startsWith("#EXTM3U") ? "m3u8" : "bad"}`);
    const keyLine = txt.split("\n").find((l) => l.startsWith("#EXT-X-KEY"));
    if (keyLine) {
      const m = keyLine.match(/URI="([^"]+)"/);
      if (m) {
        const rustUrl = m[1];
        steps.push(`rustUrl:${rustUrl.slice(0, 60)}`);
        // A/B���� JS ���±���ͬһ�����ε�ַ
        const inner = decodeURIComponent(rustUrl.split("?u=")[1] || "");
        steps.push(`inner:${inner.slice(0, 50)}`);
        try {
          const rk = await fetch(rustUrl);
          const bk = await rk.arrayBuffer();
          steps.push(`keyRust:${rk.status}/${bk.byteLength}`);
        } catch (e) { steps.push(`keyRust:throw:${(e as Error).message.slice(0, 30)}`); }
        try {
          const rk2 = await fetch(`${LOCAL}/seg?u=${encodeURIComponent(inner)}`);
          const bk2 = await rk2.arrayBuffer();
          steps.push(`keyJs:${rk2.status}/${bk2.byteLength}`);
        } catch (e) { steps.push(`keyJs:throw:${(e as Error).message.slice(0, 30)}`); }
      }
    }
    const segLine = txt.split("\n").find((l) => l && !l.startsWith("#") && l.includes("/seg?u="));
    if (segLine) {
      try {
        const r2 = await fetch(segLine.trim());
        const buf = await r2.arrayBuffer();
        steps.push(`seg:${r2.status}/${buf.byteLength}`);
      } catch (e) { steps.push(`seg:throw:${(e as Error).message.slice(0, 40)}`); }
    } else steps.push("seg:no-line");
  } catch (e) {
    steps.push(`err:${(e as Error).message.slice(0, 60)}`);
  }
  return steps.join(" | ");
}

/* ���� ��ʽ�� ���������������������������������������������������������������������������������������������� */

export const fmt = (n: number | undefined) => {
  const v = Number(n) || 0;
  if (v >= 100_000_000) return `${(v / 100_000_000).toFixed(1).replace(/\.0$/, "")}��`;
  if (v >= 10_000) return `${(v / 10_000).toFixed(1).replace(/\.0$/, "")}��`;
  return String(v);
};

export const fmtTime = (s: number) => {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${m}:${ss.toString().padStart(2, "0")}`;
};

export const dur = (s?: number | string) => {
  const n = Number(s) || 0;
  if (n <= 0) return "";
  const m = Math.floor(n / 60);
  const ss = n % 60;
  return `${m}:${String(ss).padStart(2, "0")}`;
};

/** �� m3u8 ý�壨mp4 �ȣ��� /seg ԭ��͸�� */
export function directMedia(url: string): string {
  return `${LOCAL}/seg?u=${encodeURIComponent(url)}`;
}

/** ����չ��ѡ�������ʽ��m3u8 �� �����б���д������ �� ԭ��͸�� */
export function mediaUrl(url: string): string {
  return /\.m3u8(\?|$)/i.test(url) ? playlist(url) : directMedia(url);
}
