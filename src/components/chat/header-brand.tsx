"use client";

import { AnimatePresence, motion } from "motion/react";
import { useSidebar } from "@/components/ui/sidebar";
import { Logo } from "@/components/ui/logo";

/**
 * Знак в правом углу шапки. Появляется, только когда сайдбар свёрнут (марка
 * в его шапке уже не видна), и плавно выезжает из-за правого края экрана.
 * Когда сайдбар развёрнут — уезжает обратно за край.
 *
 * Только знак, без надписи «Avy Chat» (решение владельца 26.09): название
 * теперь живёт текстом в шапке сайдбара, а здесь достаточно логотипа.
 */
export function HeaderBrand() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";

  return (
    <AnimatePresence>
      {collapsed && (
        <motion.div
          key="header-brand"
          // overflow-hidden у родителя обрезает блок за краем — эффект «из-за экрана».
          initial={{ x: 48, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 48, opacity: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 30 }}
        >
          <Logo size={28} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
