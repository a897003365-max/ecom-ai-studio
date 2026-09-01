import type { Platform } from "../types";
import "./PlatformBadge.css";
import { platformBrand, type PlatformBrand } from "./platformBrand";

interface PlatformBadgeProps {
  platform: Platform | string;
}

export function PlatformBrandIcon({ brand }: { brand: PlatformBrand }) {
  const common = { "aria-hidden": true, viewBox: "0 0 24 24" } as const;
  let icon;

  switch (brand.icon) {
    case "tmall-cat":
      icon = <svg {...common}><path d="M5 8.2 7.8 4.7 10 7h4l2.2-2.3L19 8.2v8.1c0 1.7-1.2 2.7-3 2.7H8c-1.8 0-3-1-3-2.7V8.2Z" fill="currentColor" /><path d="M8 12.2h2M14 12.2h2M9.2 15.4c1.8 1.2 3.8 1.2 5.6 0" fill="none" stroke="#ff0036" strokeLinecap="round" strokeWidth="1.35" /></svg>;
      break;
    case "jd-monogram":
      icon = <svg {...common}><text fontSize="9.2" letterSpacing="-0.7" textAnchor="middle" x="12" y="15.4">JD</text></svg>;
      break;
    case "douyin-note":
    case "tiktok-note":
      icon = <svg {...common}><path d="M13.7 4.4v9.1a3.7 3.7 0 1 1-3.2-3.7" fill="none" stroke="#25f4ee" strokeLinecap="round" strokeWidth="3.2" transform="translate(-1 1)" /><path d="M13.7 4.4c.9 2.1 2.5 3.2 4.9 3.4" fill="none" stroke="#fe2c55" strokeLinecap="round" strokeWidth="3.2" transform="translate(1 -1)" /><path d="M13.7 4.4v9.1a3.7 3.7 0 1 1-3.2-3.7M13.7 4.4c.9 2.1 2.5 3.2 4.9 3.4" fill="none" stroke="#fff" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" /></svg>;
      break;
    case "pinduoduo-heart":
      icon = <svg {...common}><path d="M12 18.5 6.2 13A3.7 3.7 0 0 1 11.5 7.8l.5.6.5-.6a3.7 3.7 0 0 1 5.3 5.2L12 18.5Z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" /><path d="M9.1 10.3h2v2h-2zM12.9 10.3h2v2h-2zM11 13.4h2v2h-2z" fill="currentColor" /></svg>;
      break;
    case "vipshop-monogram":
      icon = <svg {...common}><text fontSize="12.5" textAnchor="middle" x="12" y="16.2">唯</text></svg>;
      break;
    case "kuaishou-camera":
      icon = <svg {...common}><path d="M7.4 5.4a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm9.2 0a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM6.8 13h10.4v5.6H6.8z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" /></svg>;
      break;
    case "xiaohongshu-mark":
      icon = <svg {...common}><text fontSize="7.2" letterSpacing="-0.4" textAnchor="middle" x="12" y="14.5">RED</text></svg>;
      break;
    case "taobao-monogram":
      icon = <svg {...common}><text fontSize="12.5" textAnchor="middle" x="12" y="16.2">淘</text></svg>;
      break;
    default:
      icon = <svg {...common}><path d="M5 9h14l-1-4H6L5 9Zm1 0v10h12V9M9 19v-5h6v5" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" /></svg>;
  }

  return <span className="platform-brand-icon" data-brand={brand.brand} style={{ "--platform-color": brand.tone } as React.CSSProperties}>{icon}</span>;
}

export function PlatformBadge({ platform }: PlatformBadgeProps) {
  const brand = platformBrand(platform);
  return (
    <span aria-label={`${brand.platform}渠道`} className="platform-brand-badge" data-platform={brand.platform} data-testid="platform-badge" title={`${brand.platform}渠道`}>
      <PlatformBrandIcon brand={brand} />
      <span className="platform-brand-name">{brand.platform}</span>
    </span>
  );
}
