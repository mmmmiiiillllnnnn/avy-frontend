"use client";

import { MeshGradient } from "@paper-design/shaders-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Logo } from "@/components/ui/logo";

// Палитра mesh-градиента под «графит» (globals.css): только серые нейтрали
// темы, светлое пятно вместо цветного. Параметры distortion/swirl/speed/
// offsetX — прежние (подобраны для варианта «Mesh» на website).
const DARK_COLORS = ["#0b0b0b", "#121212", "#3a3a3a", "#e4e4e4", "#565656", "#1b1b1b"];
const LIGHT_COLORS = ["#333333", "#8f8f8f", "#565656", "#333333", "#cccccc", "#ededed"];

/**
 * Правый блок экранов входа/регистрации: живой mesh-градиент (WebGL-шейдер) во
 * всю высоту, поверх по центру — логотип и «Avy Chat». Палитра следует теме
 * (next-themes). До монтирования тема неизвестна (SSR) — рисуем тёмный набор по
 * умолчанию, чтобы не мигало.
 */
export function MeshHero() {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const colors = mounted && resolvedTheme === "light" ? LIGHT_COLORS : DARK_COLORS;

  return (
    <div className="relative h-full w-full overflow-hidden">
      <MeshGradient
        className="absolute inset-0 h-full w-full"
        colors={colors}
        distortion={0.8}
        swirl={0.6}
        grainMixer={0}
        grainOverlay={0}
        speed={0.42}
        offsetX={0.08}
      />
      {/* Лёгкая вуаль для контраста подписи поверх шейдера. */}
      <div className="pointer-events-none absolute inset-0 bg-black/15" />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
        <Logo size={72} className="drop-shadow-lg" />
        <span className="text-3xl font-semibold tracking-tight text-white drop-shadow-md">
          Avy Chat
        </span>
      </div>
    </div>
  );
}
