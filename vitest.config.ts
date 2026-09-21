import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Юнит-тесты логики клиента (стор стрима, карточки задач) — без DOM и без
// Next: модули под src/lib чистые, им хватает node. Алиас @/ — как в tsconfig.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
