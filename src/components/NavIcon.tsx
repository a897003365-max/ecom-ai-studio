import {
  ChartNoAxesCombined,
  Images,
  LayoutDashboard,
  ListChecks,
  PackageSearch,
  Radar,
  Settings,
  Tags,
  UsersRound,
  WandSparkles,
} from "lucide-react";
import type { PageId } from "../types";

const icons = {
  dashboard: LayoutDashboard,
  assets: PackageSearch,
  content: WandSparkles,
  images: Images,
  analytics: ChartNoAxesCombined,
  intelligence: Radar,
  tasks: ListChecks,
  products: Tags,
  settings: Settings,
  access: UsersRound,
} satisfies Record<PageId, typeof LayoutDashboard>;

export function NavIcon({ page, size = 16 }: { page: PageId; size?: number }) {
  const Icon = icons[page];
  return <Icon aria-hidden="true" size={size} strokeWidth={1.8} />;
}
