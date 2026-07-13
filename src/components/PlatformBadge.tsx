import type { Platform } from "../types";
import { clsx } from "../utils/format";
import { platformClass } from "../utils/status";

interface PlatformBadgeProps {
  platform: Platform;
}

export function PlatformBadge({ platform }: PlatformBadgeProps) {
  return (
    <span className={clsx("inline-flex rounded px-1.5 py-0.5 text-[10.5px] font-bold text-white", platformClass(platform))}>
      {platform}
    </span>
  );
}
