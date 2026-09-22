import { setTaskSecret, uploadTaskInputs, type TaskUpload } from "@/lib/api";

/** Секрет, набранный в форме СОЗДАНИЯ задачи: задачи ещё нет, привязать не к чему. */
export type PendingSecret = { key: string; value: string };

/** Что форма создания копит у себя до сохранения. */
export type TaskExtras = { secrets: PendingSecret[]; files: TaskUpload[] };

export const EMPTY_EXTRAS: TaskExtras = { secrets: [], files: [] };

/**
 * Привязать к СОЗДАННОЙ задаче то, что форма набрала до сохранения.
 *
 * Черновиков больше нет: задача рождается при сохранении, а секреты и вложения
 * едут следом. Каждый — своя попытка: один неудавшийся секрет не мешает
 * остальным, и всё, что не прикрепилось, возвращается списком — форма покажет
 * его человеку, а задача при этом уже существует и её можно дополнить.
 */
export async function attachTaskExtras(
  taskId: string,
  extras: TaskExtras,
): Promise<string[]> {
  const problems: string[] = [];
  for (const s of extras.secrets) {
    try {
      await setTaskSecret(taskId, s.key, s.value);
    } catch (e) {
      problems.push(`${s.key}: ${(e as Error)?.message?.trim() || "error"}`);
    }
  }
  if (extras.files.length > 0) {
    try {
      const res = await uploadTaskInputs(taskId, extras.files);
      for (const err of res.errors ?? []) problems.push(`${err.name}: ${err.error}`);
    } catch (e) {
      const names = extras.files.map((f) => f.relPath).join(", ");
      problems.push(`${names}: ${(e as Error)?.message?.trim() || "error"}`);
    }
  }
  return problems;
}
