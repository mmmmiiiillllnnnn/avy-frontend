"use client";

import * as React from "react";
import {
  Bot,
  CalendarClock,
  FileSearch,
  FileText,
  FileType,
  Image,
  LayoutGrid,
  Presentation,
  Sparkles,
  Table,
  Telescope,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

/** Иконка навыка.
 *
 *  Коробочный навык называет её сам (`icon:` во frontmatter SKILL.md — имя из
 *  lucide); у своего навыка поля нет, и иконка подбирается по категории. Имя
 *  из файла сверяется со списком здесь, а не импортируется динамически: набор
 *  иконок в бандле должен быть конечным, а опечатка в файле — не пустое место,
 *  а иконка категории.
 */
const BY_NAME: Record<string, LucideIcon> = {
  Bot,
  CalendarClock,
  FileSearch,
  FileText,
  FileType,
  Image,
  LayoutGrid,
  Presentation,
  Sparkles,
  Table,
  Telescope,
  Wrench,
  Zap,
};

const BY_CATEGORY: Record<string, LucideIcon> = {
  documents: FileText,
  presentations: Presentation,
  spreadsheets: Table,
  media: Image,
  research: Telescope,
  automation: Zap,
};

export function skillIcon(icon?: string | null, category?: string | null): LucideIcon {
  return (
    (icon && BY_NAME[icon]) ||
    (category && BY_CATEGORY[category.trim().toLowerCase()]) ||
    Wrench
  );
}

export function SkillIcon({
  icon,
  category,
  className,
}: {
  icon?: string | null;
  category?: string | null;
  className?: string;
}) {
  // createElement, а не <Icon />: компонент выбирается по данным в рендере,
  // и линтер React Compiler принимает JSX от переменной за создание
  // компонента на лету. Здесь это выбор из константной таблицы.
  return React.createElement(skillIcon(icon, category), {
    className: cn("shrink-0 text-muted-foreground", className),
    "aria-hidden": true,
  });
}
