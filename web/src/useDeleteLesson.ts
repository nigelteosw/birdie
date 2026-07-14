import type { Dispatch, SetStateAction } from 'react';
import { deleteLesson, type Lesson } from './api.js';

export function useDeleteLesson(
  setLessons: Dispatch<SetStateAction<Lesson[]>>,
  setMessage: (message: string) => void
): (lesson: Lesson) => Promise<void> {
  return async function handleDelete(lesson: Lesson) {
    try {
      await deleteLesson(lesson.id);
      setLessons((prev) => prev.filter((item) => item.id !== lesson.id));
    } catch (err) {
      setMessage(`Error: ${(err as Error).message}`);
    }
  };
}
