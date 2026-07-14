import { useEffect, useState } from 'react';
import { listLessons, type Lesson } from './api.js';
import PromotedLessonCard from './PromotedLessonCard.js';
import { useDeleteLesson } from './useDeleteLesson.js';

const NAME_KEY = 'birdie.myName';

export default function MyLessons() {
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? '');
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const handleDelete = useDeleteLesson(setLessons, setMessage);

  useEffect(() => {
    localStorage.setItem(NAME_KEY, name);
    const trimmed = name.trim();
    if (!trimmed) {
      setLessons([]);
      setMessage(null);
      return;
    }
    listLessons({ status: 'promoted', submitted_by: trimmed })
      .then((result) => {
        setLessons(result);
        setMessage(null);
      })
      .catch((err) => setMessage((err as Error).message));
  }, [name]);

  return (
    <section className="panel">
      <h2>My lessons</h2>
      <label className="wide">
        Your name
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Jane" />
      </label>
      {message && <p className="status">{message}</p>}
      {!name.trim() && <p className="empty">Enter your name to see your promoted lessons.</p>}
      {name.trim() && lessons.length === 0 && !message && <p className="empty">No promoted lessons for that name yet.</p>}
      <div className="lesson-list">
        {lessons.map((lesson) => (
          <PromotedLessonCard key={lesson.id} lesson={lesson} onDelete={handleDelete} />
        ))}
      </div>
    </section>
  );
}
