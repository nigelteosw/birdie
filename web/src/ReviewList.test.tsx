// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from './api.js';
import ReviewList from './ReviewList.js';

vi.mock('./api.js', () => ({
  findSimilarLessons: vi.fn(),
  listLessons: vi.fn(),
  mergeLesson: vi.fn(),
  promoteLesson: vi.fn(),
  reviewLesson: vi.fn(),
}));

const candidate: api.Lesson = {
  id: 'candidate',
  trace_id: 'trace-candidate',
  submitted_by: 'Alex',
  submitted_by_user_id: 'user-alex',
  quote: 'Send it soon.',
  quote_verified: true,
  what_changed: 'Use a concrete deadline.',
  why_it_matters: 'Concrete deadlines make follow-up clear.',
  status: 'pending_review',
  reviewer: null,
  reviewer_user_id: null,
  reviewed_at: null,
  promoted_at: null,
  merged_into_lesson_id: null,
  created_at: '2026-07-16T00:00:00.000Z',
};

const existing: api.Lesson = {
  ...candidate,
  id: 'existing',
  trace_id: 'trace-existing',
  status: 'promoted',
  reviewer: 'Morgan',
  reviewer_user_id: 'user-morgan',
  reviewed_at: '2026-07-16T00:00:00.000Z',
  promoted_at: '2026-07-16T00:00:00.000Z',
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ReviewList', () => {
  it('edits the three approved fields and merges only after an explicit choice', async () => {
    vi.mocked(api.listLessons).mockResolvedValue([candidate]);
    vi.mocked(api.findSimilarLessons).mockResolvedValue([existing]);
    vi.mocked(api.mergeLesson).mockResolvedValue({
      ...candidate,
      status: 'rejected',
      merged_into_lesson_id: existing.id,
    });

    render(<ReviewList refreshSignal={0} onCapture={() => undefined} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText('What was initially wrong')).toBeInTheDocument();
    expect(screen.getByLabelText('What to do instead')).toBeInTheDocument();
    expect(screen.getByLabelText('Why it matters')).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: 'Merge into this lesson' }));

    await waitFor(() => expect(api.mergeLesson).toHaveBeenCalledWith(candidate.id, existing.id));
  });
});
