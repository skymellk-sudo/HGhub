import { invoke as nativeInvoke, addPluginListener as nativeListener, isTauri } from "@tauri-apps/api/core";

export const native = isTauri() || "__TAURI_INTERNALS__" in window;
export async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (native || "__TAURI_INTERNALS__" in window) return nativeInvoke<T>(command, args);
  if (command === "set_orientation") return undefined as T;
  if (command === "open_url") {
    const url = new URL(String(args?.url));
    if (!["https:", "http:"].includes(url.protocol)) throw new Error("����Э����Ч");
    window.open(url.href, "_blank", "noopener,noreferrer");
    return undefined as T;
  }
  if (command === "plugin:app|exit") return undefined as T;
  const response = await fetch("/rpc", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command, args: args ?? {} }),
  });
  const data = await response.json();
  if (!response.ok) throw String(data.error || "����������ʧ��");
  return data.result as T;
}
export const addPluginListener: typeof nativeListener = (...args) => native || "__TAURI_INTERNALS__" in window
  ? nativeListener(...args)
  : Promise.resolve({ plugin: args[0], event: args[1], channelId: 0, unregister: async () => {} });
