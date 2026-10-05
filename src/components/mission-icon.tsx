import { Building2, Flame, Star, Stethoscope, type LucideIcon } from "lucide-react";

const ICONS: LucideIcon[] = [Flame, Stethoscope, Building2, Star];

/** Missions are configurable, so icons are assigned by position. */
export function missionIconAt(index: number): LucideIcon {
  return ICONS[Math.max(0, index) % ICONS.length];
}
