import { useState } from 'react';
import CaptureForm from './CaptureForm.js';
import ReviewList from './ReviewList.js';
import MyLessons from './MyLessons.js';
import SharedPool from './SharedPool.js';

type Tab = 'review' | 'mine' | 'shared';

export default function App() {
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [tab, setTab] = useState<Tab>('review');

  return (
    <main className="shell">
      <header className="topbar">
        <img src="/birdie-mascot.png" alt="Birdie" className="mascot" />
        <div>
          <h1>Birdie</h1>
          <p>Capture examples. Review lessons. Add only confirmed guidance to the shared library.</p>
        </div>
      </header>
      <nav className="tabs">
        <button type="button" className={tab === 'review' ? 'tab tab--active' : 'tab'} onClick={() => setTab('review')}>
          Review
        </button>
        <button type="button" className={tab === 'mine' ? 'tab tab--active' : 'tab'} onClick={() => setTab('mine')}>
          My Lessons
        </button>
        <button type="button" className={tab === 'shared' ? 'tab tab--active' : 'tab'} onClick={() => setTab('shared')}>
          Shared Pool
        </button>
      </nav>
      {tab === 'review' && (
        <>
          <CaptureForm onCaptured={() => setRefreshSignal((value) => value + 1)} />
          <ReviewList refreshSignal={refreshSignal} />
        </>
      )}
      {tab === 'mine' && <MyLessons />}
      {tab === 'shared' && <SharedPool />}
    </main>
  );
}
