import type { Lesson } from './api.js';

interface Props {
  lesson: Lesson;
}

export default function PromotedLessonCard({ lesson }: Props) {
  return (
    <article className="lesson-card lesson-card--readonly">
      <div className="meta">
        <span className="tag">{lesson.typology}</span>
        <span>Submitted by: {lesson.submitted_by}</span>
        {lesson.reviewer && <span>Reviewed by: {lesson.reviewer}</span>}
        {lesson.playbook_ref && <span>Playbook: {lesson.playbook_ref}</span>}
      </div>
      <blockquote className="quote">{lesson.quote}</blockquote>
      <p className="what-changed">{lesson.what_changed}</p>
      <p className="why-it-matters">{lesson.why_it_matters}</p>
    </article>
  );
}
