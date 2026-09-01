import { clsx } from "../utils/format";

const palette = [
  "linear-gradient(135deg,#2c3e6b,#1b2440)",
  "linear-gradient(135deg,#3a2c5e,#211735)",
  "linear-gradient(135deg,#264a3d,#132720)",
  "linear-gradient(135deg,#4a2c2c,#251515)",
  "linear-gradient(135deg,#243b42,#111d22)",
];

interface ThumbnailProps {
  icon: string;
  index?: number;
  size?: "sm" | "md" | "lg";
}

export function Thumbnail({ icon, index = 0, size = "md" }: ThumbnailProps) {
  const sizeClass = size === "sm" ? "h-9 w-9 text-base" : size === "lg" ? "h-[52px] w-[52px] text-2xl" : "";
  return (
    <div className={clsx("thumb", sizeClass)} style={{ background: palette[index % palette.length] }}>
      {icon}
    </div>
  );
}
