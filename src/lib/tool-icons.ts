import {
  Terminal,
  FileText,
  FilePen,
  Wrench,
  Globe,
  Download,
  Bot,
  CloudSun,
  type LucideIcon,
} from "lucide-react";

/**
 * Иконка инструмента по имени. Отдельный модуль (а не константа в tool-steps),
 * потому что иконки нужны и цепочке шагов, и свёрнутой панели рассуждений —
 * импорт панели из tool-steps дал бы цикл (tool-steps → panel → tool-steps).
 */
const TOOL_ICONS: Record<string, LucideIcon> = {
  bash: Terminal,
  read_file: FileText,
  write_file: FilePen,
  edit_file: FilePen,
  ls: FileText,
  glob: FileText,
  grep: FileText,
  web_search: Globe,
  web_fetch: Download,
  get_weather: CloudSun,
  task: Bot,
};

export function toolIcon(name: string): LucideIcon {
  return TOOL_ICONS[name] ?? Wrench;
}
