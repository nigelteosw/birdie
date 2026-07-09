import { useState } from 'react';
import CaptureForm from './CaptureForm.js';
import ReviewList from './ReviewList.js';

export default function App() {
  const [refreshSignal, setRefreshSignal] = useState(0);

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <h1>Birdie</h1>
          <p>Capture examples. Review lessons. Add only confirmed guidance to the shared library.</p>
        </div>
      </header>
      <CaptureForm onCaptured={() => setRefreshSignal((value) => value + 1)} />
      <ReviewList refreshSignal={refreshSignal} />
    </main>
  );
}
