/**
 * Curated registry of lucide icons available for sidebar item customization.
 *
 * Why a curated subset (rather than the full ~1500 lucide icons): admins
 * pick from a small, recognizable set when renaming a tab; an open-ended
 * pick-any-icon UI is overwhelming and the long tail of icons doesn't fit
 * the app's vocabulary anyway. ~30 covers every reasonable nav use.
 *
 * Looking up by name (string) keeps the DB row small — we store the icon
 * name as text and resolve to the component on render. If a stored icon
 * name isn't in the registry (legacy or removed), the consumer should
 * fall back to the item's hardcoded default.
 */
import {
  ShoppingBag, Send, Inbox, Briefcase, Users, TrendingUp, Calculator, BookOpen,
  Settings, DollarSign, Building2, UserCircle, Mail, FileText, BarChart,
  PieChart, Layers, Folder, FolderOpen, Star, Heart, Zap, Target, Flag,
  CheckCircle, AlertCircle, Bell, Calendar, Clock, Globe, Home, Bookmark,
  ClipboardList, ListChecks, Package, Receipt, Wallet, LineChart,
  type LucideIcon,
} from 'lucide-react';

export const SIDEBAR_ICON_REGISTRY: Record<string, LucideIcon> = {
  ShoppingBag, Send, Inbox, Briefcase, Users, TrendingUp, Calculator, BookOpen,
  Settings, DollarSign, Building2, UserCircle, Mail, FileText, BarChart,
  PieChart, Layers, Folder, FolderOpen, Star, Heart, Zap, Target, Flag,
  CheckCircle, AlertCircle, Bell, Calendar, Clock, Globe, Home, Bookmark,
  ClipboardList, ListChecks, Package, Receipt, Wallet, LineChart,
};

/** Ordered list of icon names — used to populate the picker UI. */
export const SIDEBAR_ICON_NAMES: string[] = Object.keys(SIDEBAR_ICON_REGISTRY);

/**
 * Resolve an icon name to a Lucide component, falling back to the supplied
 * default when the name is empty or unknown.
 */
export function resolveIcon(
  name: string | null | undefined,
  fallback: LucideIcon
): LucideIcon {
  if (!name) return fallback;
  return SIDEBAR_ICON_REGISTRY[name] ?? fallback;
}
