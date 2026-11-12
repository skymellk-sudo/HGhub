import { getCurrentWindow } from "@tauri-apps/api/window";

import { native } from "../runtime";

const MAP: [string, string][] = [
  ["n", "North"], ["s", "South"], ["e", "East"], ["w", "West"],
  ["ne", "NorthEast"], ["nw", "NorthWest"], ["se", "SouthEast"], ["sw", "SouthWest"],
];

/** �ޱ߿򴰿ڵı�Ե��ק���ţ�Windows���� */
export default function ResizeHandles() {
  if (!native) return null;
  const win = getCurrentWindow();
  return (
    <div className="pointer-events-none absolute inset-0 z-[70]">
      {MAP.map(([edge, dir]) => (
        <div key={edge}
          className={`win-resize win-resize-${edge} pointer-events-auto`}
          onPointerDown={(e) => {
            e.preventDefault();
            // ResizeDirection �����Ͱ���δ���������ַ�������
            (win.startResizeDragging as unknown as (d: string) => Promise<void>)(dir).catch(() => {});
          }}
        />
      ))}
    </div>
  );
}