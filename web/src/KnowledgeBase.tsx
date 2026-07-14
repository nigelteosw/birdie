import { useEffect, useState } from 'react';
import { listLessons, type Lesson } from './api.js';
import PromotedLessonCard from './PromotedLessonCard.js';
import { useDeleteLesson } from './useDeleteLesson.js';

export default function KnowledgeBase() {
  const [keyword, setKeyword] = useState('');
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const handleDelete = useDeleteLesson(setLessons, setMessage);

  useEffect(() => {
    listLessons({ status: 'promoted', q: keyword.trim() || undefined })
      .then((result) => {
        setLessons(result);
        setMessage(null);
      })
      .catch((err) => setMessage((err as Error).message));
  }, [keyword]);

  return (
    <section className="panel">
      <h2>Knowledge base</h2>
      <div className="search-row">
        <input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder="Search quote, what changed, why it matters"
        />
      </div>
      {message && <p className="status">{message}</p>}
      {lessons.length === 0 && !message && <p className="empty">No promoted lessons match yet.</p>}
      <div className="lesson-list">
        {lessons.map((lesson) => (
          <PromotedLessonCard key={lesson.id} lesson={lesson} onDelete={handleDelete} />
        ))}
      </div>
    </section>
  );
}
