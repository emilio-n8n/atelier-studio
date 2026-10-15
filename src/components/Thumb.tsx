import clsx from "clsx";
import { AudioLines } from "lucide-react";
import { useStore } from "../store";

export function Thumb({ id, className }: { id: string; className?: string }) {
  const a = useStore((s) => s.assets.find((x) => x.id === id));
  if (!a) return <div className={clsx("bg-raised", className)} />;
  if (a.kind === "audio") {
    const peaks = (a.peaks ?? []).filter((_, i) => i % 10 === 0);
    return (
      <div className={clsx("flex items-center justify-center gap-[2px] bg-[#10201d] px-2", className)}>
        {peaks.length ? peaks.map((p, i) => <span key={i} className="w-[2px] rounded-full bg-audio" style={{ height: `${Math.max(6, p * 70)}%` }} />) : <AudioLines className="text-audio" size={18} />}
      </div>
    );
  }
  return (
    <div className={clsx("checker overflow-hidden", className)}>
      {a.thumb && <img src={a.thumb} alt="" draggable={false} className="size-full object-cover" />}
    </div>
  );
}
