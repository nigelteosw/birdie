import { useEffect, useState } from 'react';
import { getDomainProfile, listLessons, type Lesson } from './api.js';
import PromotedLessonCard from './PromotedLessonCard.js';

export default function SharedPool() {
  const [keyword, setKeyword] = useState('');
  const [typology, setTypology] = useState('');
  const [typologies, setTypologies] = useState<string[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    getDomainProfile()
      .then((profile) => setTypologies(profile.typology_categories))
      .catch((err) => setMessage((err as Error).message));
  }, []);

  useEffect(() => {
    listLessons({ status: 'promoted', q: keyword.trim() || undefined, typology: typology || undefined })
      .then((result) => {
        setLessons(result);
        setMessage(null);
      })
      .catch((err) => setMessage((err as Error).message));
  }, [keyword, typology]);

  return (
    <section className="panel">
      <h2>Shared pool</h2>
      <div className="search-row">
        <input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder="Search quote, what changed, why it matters"
        />
        <select value={typology} onChange={(event) => setTypology(event.target.value)}>
          <option value="">All categories</option>
          {typologies.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </div>
      {message && <p className="status">{message}</p>}
      {lessons.length === 0 && !message && <p className="empty">No promoted lessons match yet.</p>}
      <div className="lesson-list">
        {lessons.map((lesson) => (
          <PromotedLessonCard key={lesson.id} lesson={lesson} />
        ))}
      </div>
    </section>
  );
}
